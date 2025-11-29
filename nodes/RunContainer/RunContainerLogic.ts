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
    setWorkspaceVolumeSession
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
    entrypoint: string;
    command: string;
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

        // Build container configuration
        const containerConfig: ContainerExecutionConfig = {
            image: params.image,
            entrypoint: params.entrypoint || undefined,
            command: params.command || undefined,
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
                },
            },
            pairedItem: {
                item: itemIndex,
            },
        };

        // Collect binary output if enabled
        if (params.binaryDataOutput && tempDir) {
            // We need to copy files from the container to the temp dir
            // The container is still alive (autoRemove: false)
            // We copy from workspaceMountPath (or root?)
            // If the user specified a pattern like "*.png", we need to find those files.
            // Our copyFilesFromContainer uses 'docker cp' which takes a path.
            // If we want to support patterns, we might need to be smarter.
            // For now, let's assume we copy the entire workspace content or specific files?
            // The user said "extract the binary data".

            // Let's try to copy from workspaceMountPath.
            // But we need to put it in tempDir/output for collectBinaryOutput to work.
            const outputDir = `${tempDir}/output`;

            // We use the container instance from the result? 
            // Wait, executeContainer returns result but cleans up container if we are not careful.
            // In executeContainer, we have:
            // finally { await container.remove() }
            // So the container is GONE by now.

            // We need to modify executeContainer to NOT remove the container if we need to extract files?
            // Or we extract files inside executeContainer?
            // executeContainer is in ContainerHelpers.ts.

            // Actually, we can't extract here if the container is gone.
            // We need to change the architecture slightly.
            // But wait, the workspace volume PERSISTS.
            // So we can extract from the volume!
            // But we can't easily extract from a volume without a container.

            // So we should probably mount a helper container to extract?
            // Or, we can modify executeContainer to allow a callback before removal?
            // Or we can just use the volume.

            // If we use the volume, we can mount it to a temporary helper container and copy files out.
            // That seems robust.

            // Helper container to extract files
            // We copy from the configured output directory inside the workspace
            // If outputDirectory is absolute, we assume it's inside the workspace or we mount it?
            // But we only mount the workspace volume.
            // So the agent must write to the workspace volume.
            // The outputDirectory param is "Directory inside the container where output files will be collected from".
            // If the user sets it to "/agent/workspace/output", then we should copy from there.

            const sourcePath = params.outputDirectory || `${params.workspaceMountPath}/output`;

            const helperConfig: ContainerExecutionConfig = {
                image: 'alpine:latest',
                command: `sh -c "cp -r ${sourcePath}/* /output/ 2>/dev/null || true"`,
                volumes: [
                    `${volumeName}:${params.workspaceMountPath}:ro`,
                    `${outputDir}:/output:rw`
                ],
                autoRemove: true
            };

            await executeContainer(helperConfig);

            // Now files are in outputDir, collect them
            const outputBinary = await collectBinaryOutput(context, tempDir, params.outputFilePattern);

            if (Object.keys(outputBinary).length > 0) {
                executionData.binary = outputBinary;
                (executionData.json.container as any).outputFilesCount = Object.keys(outputBinary).length;
            }
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
