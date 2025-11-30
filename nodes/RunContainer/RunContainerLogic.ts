import {
    IExecuteFunctions,
    INodeExecutionData,
    NodeOperationError,
} from 'n8n-workflow';
import {
    validateDockerImageName,
    formatDockerError,
    isDockerConnectionError
} from './GenericFunctions';
import {
    executeContainer,
    ContainerExecutionConfig,
    initializeDockerClient,
    ensureVolume,
    getWorkspaceVolumeName,
    setWorkspaceVolumeSession,
    copyFilesFromVolume
} from './ContainerHelpers';
import { detectDockerSocket } from './utils/socketDetector';
import {
    prepareBinaryInputAuto,
    collectBinaryOutput,
    calculateResourceLimits,
    cleanupTempDirectory,
    createOutputDirectory,
} from './BinaryDataHelpers';

export interface RunContainerParams {
    image: string;
    entrypoint?: string;
    command?: string;
    executionMode: string;
    socketPath: string;
    envVars: string[];
    binaryDataInput: boolean;
    binaryDataOutput: boolean;
    binaryFileMappings: { mappings: Array<{ binaryPropertyName: string; containerPath: string }> };
    outputFilePattern: string;
    workspaceMountPath: string;
    binaryInputPath: string;
    outputDirectory?: string;
}

export async function executeContainerWithBinary(
    context: IExecuteFunctions,
    itemIndex: number,
    params: RunContainerParams
): Promise<INodeExecutionData> {
    let tempDir: string | null = null;
    const tempDirectories: string[] = [];

    try {
        // Validate and auto-detect Docker socket
        const socketDetection = detectDockerSocket(params.socketPath);
        const socketPath = socketDetection.path;

        // Validate image name
        const imageValidation = validateDockerImageName(params.image);
        if (!imageValidation.valid) {
            throw new NodeOperationError(
                context.getNode(),
                `Invalid Docker image: ${imageValidation.errors.join(', ')}`,
                { itemIndex }
            );
        }

        // Build container configuration based on execution mode
        let entrypoint: string | undefined;
        let command: string | undefined;
        
        if (params.executionMode === 'simple') {
            // Simple mode: use bash as entrypoint, command as argument to -c
            entrypoint = 'bash';
            command = params.command || '';
        } else {
            // Advanced mode: use provided entrypoint and command directly
            entrypoint = params.entrypoint || undefined;
            command = params.command || undefined;
        }
        
        const containerConfig: ContainerExecutionConfig = {
            image: params.image,
            entrypoint,
            command,
            executionMode: params.executionMode,
            environmentVariables: params.envVars,
            socketPath,
            autoRemove: true,
            pullPolicy: 'missing', // Only pull if image doesn't exist locally
            volumes: [],
        };

        // Set up session-based workspace volume for persistence across tool calls
        setWorkspaceVolumeSession(context);
        const volumeName = getWorkspaceVolumeName(context);
        const docker = initializeDockerClient(socketPath);
        await ensureVolume(docker, volumeName);
        containerConfig.volumes?.push(`${volumeName}:${params.workspaceMountPath}:rw`);

        // Prepare binary input if enabled
        if (params.binaryDataInput) {
            // Use automatic mode: extract all binary data and place in input directory
            const preparedBinary = await prepareBinaryInputAuto(
                context,
                itemIndex,
            );
            tempDir = preparedBinary.tempDir;
            tempDirectories.push(tempDir);

            // Mount the entire input directory to binaryInputPath
            const inputDir = preparedBinary.inputDir;
            containerConfig.volumes = [
                ...(containerConfig.volumes || []),
                `${inputDir}:${params.binaryInputPath}:ro`
            ];

            // Calculate resource limits based on file sizes
            if (preparedBinary.fileSizes.length > 0) {
                const resourceLimits = calculateResourceLimits(preparedBinary.fileSizes);
                containerConfig.memory = resourceLimits.memory;
                containerConfig.cpuQuota = resourceLimits.cpuQuota;
            }
        } else if (params.binaryDataOutput) {
            // Binary output without input - create temp dir for extraction later
            const fs = await import('fs/promises');
            const path = await import('path');
            const os = await import('os');
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8n-docker-output-'));
            tempDirectories.push(tempDir);

            // We don't mount this temp dir anymore for output, we use it for extraction
            await createOutputDirectory(tempDir);
        }

        // Execute container
        const result = await executeContainer(
            containerConfig,
            (progress) => {
                // Optional: Log pull progress
            }
        );

        // Prepare result
        const executionData: INodeExecutionData = {
            json: {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                success: result.success,
                hasOutput: result.hasOutput,
                container: {
                    image: params.image,
                    command: containerConfig.command,
                    entrypoint: containerConfig.entrypoint,
                    environmentVariablesCount: params.envVars.length,
                    socketPath,
                    binaryInput: params.binaryDataInput,
                    binaryOutput: params.binaryDataOutput,
                    // Add debug info immediately to see if code path is hit
                    binaryOutputDebug: {
                        binaryDataOutput: params.binaryDataOutput,
                        tempDir: tempDir || null,
                        willAttemptCollection: !!(params.binaryDataOutput && tempDir),
                    },
                },
            },
            pairedItem: {
                item: itemIndex,
            },
        };

        // Collect binary output if enabled
        if (params.binaryDataOutput && tempDir) {
            // Copy files from the workspace volume to temp directory
            // The workspace volume persists, so we can extract files even after the container is removed
            const outputDir = `${tempDir}/output`;
            
            // Ensure output directory exists
            const fs = await import('fs/promises');
            await fs.mkdir(outputDir, { recursive: true });

            // Determine source path inside the volume
            // copyFilesFromVolume can handle both absolute paths (starting with /) and relative paths
            let sourcePath: string;
            if (params.outputDirectory) {
                if (params.outputDirectory.startsWith('/')) {
                    // Absolute path - use as-is (copyFilesFromVolume will handle it)
                    sourcePath = params.outputDirectory;
                } else {
                    // Relative path - use as-is (will be resolved relative to volumeMountPath)
                    sourcePath = params.outputDirectory;
                }
            } else {
                // Default: output directory inside workspace (relative to workspaceMountPath)
                sourcePath = 'output';
            }

            // Add debug info to execution result
            (executionData.json.container as any).binaryOutputDebug = {
                volumeName,
                sourcePath,
                workspaceMountPath: params.workspaceMountPath,
                outputDir,
                tempDir,
            };

            try {
                // Use dockerode to copy files from volume (equivalent to docker cp)
                // sourcePath will be resolved relative to volumeMountPath in the container
                console.log(`[BinaryOutput] Copying files from volume: ${volumeName}, sourcePath: ${sourcePath}, workspaceMountPath: ${params.workspaceMountPath}, outputDir: ${outputDir}`);
                const copyDebugInfo = await copyFilesFromVolume(
                    docker,
                    volumeName,
                    params.workspaceMountPath,
                    sourcePath,
                    outputDir,
                    socketPath
                );
                console.log(`[BinaryOutput] Successfully copied files from volume to ${outputDir}`);
                (executionData.json.container as any).binaryOutputDebug.copySuccess = true;
                // Add tar and extraction debug info
                if (copyDebugInfo.tarContents) {
                    (executionData.json.container as any).binaryOutputDebug.tarContents = copyDebugInfo.tarContents;
                }
                if (copyDebugInfo.extractedFiles) {
                    (executionData.json.container as any).binaryOutputDebug.extractedFilesFromTar = copyDebugInfo.extractedFiles;
                }
                if (copyDebugInfo.tarFileSize !== undefined) {
                    (executionData.json.container as any).binaryOutputDebug.tarFileSize = copyDebugInfo.tarFileSize;
                }
            } catch (error: any) {
                // If copy fails, it might be because the directory doesn't exist or is empty
                // This is not necessarily an error - container may not produce output files
                console.warn(`[BinaryOutput] Failed to copy files from volume: ${error.message}`);
                (executionData.json.container as any).binaryOutputDebug.copyError = error.message;
                (executionData.json.container as any).binaryOutputDebug.copySuccess = false;
                // Don't throw - allow collectBinaryOutput to check if files exist anyway
            }

            // Collect binary output files
            console.log(`[BinaryOutput] Collecting binary output from ${outputDir} with pattern: ${params.outputFilePattern}`);
            
            // List files in output directory for debugging (recursively)
            let filesInOutputDir: string[] = [];
            try {
                const path = await import('path');
                
                // First try direct listing
                filesInOutputDir = await fs.readdir(outputDir);
                console.log(`[BinaryOutput] Files found in output directory (direct):`, filesInOutputDir);
                
                // If no files found, check recursively for subdirectories
                if (filesInOutputDir.length === 0) {
                    async function findFilesRecursive(dir: string, baseDir: string = dir): Promise<string[]> {
                        const files: string[] = [];
                        const entries = await fs.readdir(dir, { withFileTypes: true });
                        
                        for (const entry of entries) {
                            const fullPath = path.join(dir, entry.name);
                            const relativePath = path.relative(baseDir, fullPath);
                            
                            if (entry.isDirectory()) {
                                const subFiles = await findFilesRecursive(fullPath, baseDir);
                                files.push(...subFiles);
                            } else if (entry.isFile()) {
                                files.push(relativePath);
                            }
                        }
                        
                        return files;
                    }
                    
                    const recursiveFiles = await findFilesRecursive(outputDir);
                    console.log(`[BinaryOutput] Files found recursively:`, recursiveFiles);
                    filesInOutputDir = recursiveFiles;
                    
                    // If files are in subdirectories, move them to the root output directory
                    if (recursiveFiles.length > 0) {
                        console.log(`[BinaryOutput] Moving files from subdirectories to output root`);
                        for (const file of recursiveFiles) {
                            const sourcePath = path.join(outputDir, file);
                            const fileName = path.basename(file);
                            const targetPath = path.join(outputDir, fileName);
                            
                            // Only move if it's not already at the root
                            if (sourcePath !== targetPath) {
                                await fs.copyFile(sourcePath, targetPath);
                                console.log(`[BinaryOutput] Moved ${file} to ${fileName}`);
                            }
                        }
                    }
                }
                
                (executionData.json.container as any).binaryOutputDebug.filesInOutputDir = filesInOutputDir;
            } catch (error: any) {
                console.warn(`[BinaryOutput] Could not list files in output directory: ${error.message}`);
                (executionData.json.container as any).binaryOutputDebug.listError = error.message;
            }

            const outputBinary = await collectBinaryOutput(context, tempDir, params.outputFilePattern);
            console.log(`[BinaryOutput] Collected ${Object.keys(outputBinary).length} binary files:`, Object.keys(outputBinary));
            (executionData.json.container as any).binaryOutputDebug.collectedFilesCount = Object.keys(outputBinary).length;
            (executionData.json.container as any).binaryOutputDebug.collectedFileNames = Object.keys(outputBinary);

            if (Object.keys(outputBinary).length > 0) {
                executionData.binary = outputBinary;
                (executionData.json.container as any).outputFilesCount = Object.keys(outputBinary).length;
                console.log(`[BinaryOutput] Binary data attached to execution result`);
            } else {
                console.warn(`[BinaryOutput] No binary files collected - check if files exist in ${outputDir}`);
            }
        } else {
            // Debug: log why binary collection didn't run
            (executionData.json.container as any).binaryOutputDebug = {
                binaryDataOutput: params.binaryDataOutput,
                tempDir: tempDir || null,
                reason: !params.binaryDataOutput ? 'binaryDataOutput is false' : !tempDir ? 'tempDir is null' : 'unknown'
            };
        }

        return executionData;

    } catch (error) {
        // Handle different types of errors appropriately
        let errorMessage: string;

        if (isDockerConnectionError(error)) {
            errorMessage = formatDockerError(
                error,
                'connection',
                'Make sure Docker is running and accessible'
            );
        } else {
            errorMessage = formatDockerError(
                error,
                'container execution',
                `Image: ${params.image}`
            );
        }

        // Re-throw as NodeOperationError to be handled by caller (who checks continueOnFail)
        throw new NodeOperationError(
            context.getNode(),
            errorMessage,
            { itemIndex }
        );
    } finally {
        // Always cleanup temporary directories
        await Promise.allSettled(tempDirectories.map((dir) => cleanupTempDirectory(dir)));
    }
}
