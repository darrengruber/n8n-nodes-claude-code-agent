/**
 * Docker container management helpers
 * High-level container operations and lifecycle management
 */

import Docker from 'dockerode';
import { parseCommand } from './utils/commandParser';
import { detectDockerSocket } from './utils/socketDetector';
import { parseContainerResult, formatContainerResult, parseDockerLogs, separateLogStreams } from './utils/logParser';

/**
 * Container execution configuration
 */
export interface ContainerExecutionConfig {
    image: string;
    entrypoint?: string;
    command?: string;
    executionMode?: string;
    environmentVariables?: string[];
    socketPath?: string;
    workingDir?: string;
    autoRemove?: boolean;
    pullPolicy?: 'always' | 'missing' | 'never';
    volumes?: string[]; // Docker volume mounts (format: "host:container:mode")
    memory?: number; // Memory limit in bytes
    cpuQuota?: number; // CPU quota (100000 = 100%)
    timeout?: number; // Execution timeout in milliseconds
    readOnlyRootfs?: boolean; // Mount root filesystem as read-only
    noNewPrivileges?: boolean; // Prevent privilege escalation
}

/**
 * Container execution options
 */
export interface ContainerOptions {
    Tty?: boolean;
    AttachStdout?: boolean;
    AttachStderr?: boolean;
    WorkingDir?: string;
    HostConfig?: {
        AutoRemove?: boolean;
        Memory?: number;
        CpuQuota?: number;
        NetworkMode?: string;
    };
}

/**
 * Pull progress information
 */
export interface PullProgress {
    status: string;
    progress?: string;
    progressDetail?: {
        current?: number;
        total?: number;
    };
    id?: string;
}

/**
 * Initialize Docker client with socket detection
 *
 * @param preferredSocketPath - Preferred Docker socket path
 * @returns Initialized Docker client
 */
export function initializeDockerClient(preferredSocketPath?: string): Docker {
    const socketDetection = detectDockerSocket(preferredSocketPath);
    const socketPath = socketDetection.path;

    return new Docker({ socketPath });
}

/**
 * Check if Docker image exists locally
 *
 * @param docker - Docker client instance
 * @param imageName - Image name to check
 * @returns True if image exists locally
 */
export async function checkImageExists(docker: Docker, imageName: string): Promise<boolean> {
    try {
        const image = docker.getImage(imageName);
        await image.inspect();
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Pull Docker image with progress reporting
 *
 * @param docker - Docker client instance
 * @param imageName - Image name to pull
 * @param onProgress - Optional progress callback
 * @returns Promise that resolves when pull completes
 */
export async function pullDockerImage(
    docker: Docker,
    imageName: string,
    onProgress?: (progress: PullProgress) => void
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream | null) => {
            if (err) {
                reject(new Error(`Failed to pull image ${imageName}: ${err.message}`));
                return;
            }

            if (!stream) {
                reject(new Error(`Failed to pull image ${imageName}: No stream returned`));
                return;
            }

            docker.modem.followProgress(stream, (err: Error | null, output?: PullProgress[]) => {
                if (err) {
                    reject(new Error(`Failed to pull image ${imageName}: ${err.message}`));
                } else {
                    if (onProgress && output) {
                        // Report final progress
                        const lastProgress = output[output.length - 1];
                        if (lastProgress) {
                            onProgress(lastProgress);
                        }
                    }
                    resolve();
                }
            }, (event: PullProgress) => {
                if (onProgress) {
                    onProgress(event);
                }
            });
        });
    });
}

/**
 * Ensure Docker image is available (pull if needed)
 *
 * @param docker - Docker client instance
 * @param imageName - Image name to ensure
 * @param pullPolicy - Pull policy ('always', 'missing', 'never')
 * @param onProgress - Optional progress callback
 * @returns Promise that resolves when image is available
 */
export async function ensureImageAvailable(
    docker: Docker,
    imageName: string,
    pullPolicy: 'always' | 'missing' | 'never' = 'missing',
    onProgress?: (progress: PullProgress) => void
): Promise<void> {
    switch (pullPolicy) {
        case 'never':
            // Don//t pull, just check if exists
            const exists = await checkImageExists(docker, imageName);
            if (!exists) {
                throw new Error(`Image ${imageName} not found and pull policy is 'never'`);
            }
            break;

        case 'always':
            // Always pull the image
            await pullDockerImage(docker, imageName, onProgress);
            break;

        case 'missing':
        default:
            // Pull only if missing
            if (!(await checkImageExists(docker, imageName))) {
                await pullDockerImage(docker, imageName, onProgress);
            }
            break;
    }
}

/**
 * Create container with specified configuration
 *
 * @param docker - Docker client instance
 * @param config - Container execution configuration
 * @returns Created Docker container
 */
/**
 * Check if a command needs shell interpretation (contains shell operators)
 * @param cmd - Command string to check
 * @returns True if command needs shell interpretation
 */
export function needsShellInterpretation(cmd: string): boolean {
    if (!cmd) return false;
    // Check for common shell operators that need interpretation
    const shellOperators = ['>', '>>', '<', '|', '&&', '||', ';', '`', '$('];
    return shellOperators.some(op => cmd.includes(op));
}

export async function createContainer(
    docker: Docker,
    config: ContainerExecutionConfig,
): Promise<Docker.Container> {
    // Parse entrypoint and command
    let entrypointArray = config.entrypoint ? parseCommand(config.entrypoint) : undefined;
    let commandArray = config.command ? parseCommand(config.command) : [];

    // Handle simple mode: always use bash -c for the command
    if (config.executionMode === 'simple' && config.command) {
        entrypointArray = ['bash'];
        commandArray = ['-c', config.command];
    }
    // Handle advanced mode: use original logic for shell interpretation
    else if (config.command && needsShellInterpretation(config.command) && !config.entrypoint) {
        // Wrap the entire command in sh -c
        entrypointArray = ['/bin/sh'];
        commandArray = ['-c', config.command];
    }

    // Build container options
    const createOptions: any = {
        Image: config.image,
        Env: config.environmentVariables || [],
        Tty: false,
        AttachStdout: true,
        AttachStderr: true,
        HostConfig: {
            AutoRemove: false, // Disable auto-remove to prevent 409 log errors
        },
    };

    // Set entrypoint if provided
    if (entrypointArray && entrypointArray.length > 0) {
        createOptions.Entrypoint = entrypointArray;
    }

    // Set command if provided
    if (commandArray.length > 0) {
        createOptions.Cmd = commandArray;
    }

    // Set working directory if provided
    if (config.workingDir) {
        createOptions.WorkingDir = config.workingDir;
    }

    // Add volume binds if provided
    if (config.volumes && config.volumes.length > 0) {
        createOptions.HostConfig.Binds = config.volumes;
    }

    // Add resource limits if provided
    if (config.memory) {
        createOptions.HostConfig.Memory = config.memory;
    }

    if (config.cpuQuota) {
        createOptions.HostConfig.CpuQuota = config.cpuQuota;
        createOptions.HostConfig.CpuPeriod = 100000; // Standard period
    }

    // Security options
    if (config.readOnlyRootfs) {
        createOptions.HostConfig.ReadonlyRootfs = true;
    }

    if (config.noNewPrivileges) {
        createOptions.HostConfig.SecurityOpt = ['no-new-privileges'];
    }

    return await docker.createContainer(createOptions);
}

/**
 * Start a container and wait for completion
 *
 * @param container - Docker container instance
 * @returns Container wait result with exit code
 */
export async function startAndWaitForContainer(container: Docker.Container): Promise<{ StatusCode: number }> {
    // Start the container
    await container.start();

    // Wait for container to finish
    const waitResult = await container.wait();
    return waitResult;
}

/**
 * Get logs from a container
 *
 * @param container - Docker container instance
 * @returns Raw Docker logs buffer
 */

export async function getContainerLogs(container: Docker.Container): Promise<Buffer> {
    try {
        // Try to get logs as a buffer (original approach)
        const logsBuffer = await container.logs({
            stdout: true,
            stderr: true,
            timestamps: false // Don't include timestamps to match original behavior
        });

        // dockerode v3+ returns a buffer directly in some cases
        if (Buffer.isBuffer(logsBuffer)) {
            return logsBuffer;
        }

        // If it's a stream, convert to buffer
        const chunks: Buffer[] = [];
        const stream = logsBuffer as NodeJS.ReadableStream;

        return new Promise((resolve, reject) => {
            stream.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });

            stream.on('end', () => {
                resolve(Buffer.concat(chunks));
            });

            stream.on('error', (error) => {
                reject(new Error(`Failed to read container logs: ${error.message}`));
            });
        });
    } catch (error) {
        throw new Error(`Failed to get container logs: ${error.message}`);
    }
}

/**
 * Execute a container with full lifecycle management
 *
 * @param config - Container execution configuration
 * @param onProgress - Optional pull progress callback
 * @returns Formatted container execution result
 */
export async function executeContainer(
    config: ContainerExecutionConfig,
    onProgress?: (progress: PullProgress) => void
): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    success: boolean;
    hasOutput: boolean;
}> {
    // Initialize Docker client
    const docker = initializeDockerClient(config.socketPath);

    // Ensure image is available
    await ensureImageAvailable(docker, config.image, config.pullPolicy, onProgress);

    // Create container
    const container = await createContainer(docker, config);

    try {
        // Start container and wait for completion
        const waitResult = await startAndWaitForContainer(container);
        const exitCode = waitResult.StatusCode;

        // Get container logs - AutoRemove is disabled, so container still exists
        const logsBuffer = await getContainerLogs(container);

        // Parse and format results
        const parsedResult = parseContainerResult(logsBuffer, exitCode);
        return formatContainerResult(parsedResult);
    } finally {
        // Clean up container manually since auto-remove is disabled
        try {
            await container.remove({ v: true });
        } catch (error) {
            // Ignore removal errors
        }
    }
}

/**
 * Get information about available Docker images
 *
 * @param docker - Docker client instance
 * @returns Array of image information
 */
export async function listDockerImages(docker?: Docker): Promise<Array<{
    Id: string;
    RepoTags: string[];
    Size: number;
    Created: number;
}>> {
    if (!docker) {
        docker = initializeDockerClient();
    }

    const images = await docker.listImages();
    return images.map(image => ({
        Id: image.Id,
        RepoTags: image.RepoTags || [],
        Size: image.Size,
        Created: image.Created
    }));
}

/**
 * Validate container configuration
 *
 * @param config - Container execution configuration
 * @returns Validation result
 */
export function validateContainerConfig(config: ContainerExecutionConfig): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!config.image || config.image.trim().length === 0) {
        errors.push('Image name is required');
    }

    // Validate image name format
    if (config.image && !isValidImageName(config.image)) {
        errors.push('Invalid image name format');
    }

    // Validate entrypoint if provided
    if (config.entrypoint && config.entrypoint.trim().length === 0) {
        errors.push('Entrypoint cannot be empty if specified');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Check if image name follows Docker naming conventions
 *
 * @param imageName - Image name to validate
 * @returns True if valid
 */
function isValidImageName(imageName: string): boolean {
    // Basic validation for Docker image names
    // This is a simplified check - Docker has more complex naming rules
    const imageRegex = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?:@[a-fA-F0-9]+)?$/;
    return imageRegex.test(imageName) || imageName.includes('/') || imageName.includes(':');
}

/**
 * Get container resource usage statistics
 *
 * @param container - Docker container instance
 * @returns Container statistics
 */
export async function getContainerStats(container: Docker.Container): Promise<{
    cpuUsage: number;
    memoryUsage: number;
    networkIO?: {
        rxBytes: number;
        txBytes: number;
    };
}> {
    try {
        const stats = await container.stats({ stream: false });

        // Calculate CPU usage percentage
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuUsage = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

        // Get memory usage
        const memoryUsage = stats.memory_stats.usage || 0;

        // Get network I/O if available
        let networkIO;
        if (stats.networks && Object.keys(stats.networks).length > 0) {
            const networks = Object.values(stats.networks);
            networkIO = {
                rxBytes: networks.reduce((sum, net) => sum + net.rx_bytes, 0),
                txBytes: networks.reduce((sum, net) => sum + net.tx_bytes, 0)
            };
        }

        return {
            cpuUsage,
            memoryUsage,
            networkIO
        };
    } catch (error) {
        // Return default values if stats are not available
        return {
            cpuUsage: 0,
            memoryUsage: 0
        };
    }
}

/**
 * Ensure a Docker volume exists
 *
 * @param docker - Docker client instance
 * @param volumeName - Name of the volume
 * @returns Promise that resolves when volume is ready
 */
export async function ensureVolume(docker: Docker, volumeName: string): Promise<void> {
    try {
        const volume = docker.getVolume(volumeName);
        await volume.inspect();
    } catch (error) {
        // Volume doesn't exist, create it
        await docker.createVolume({
            Name: volumeName,
            Labels: {
                'managed-by': 'n8n-run-container',
            },
        });
    }
}

/**
 * Remove a Docker volume
 *
 * @param docker - Docker client instance
 * @param volumeName - Name of the volume
 * @returns Promise that resolves when volume is removed
 */
export async function removeVolume(docker: Docker, volumeName: string): Promise<void> {
    try {
        const volume = docker.getVolume(volumeName);
        await volume.remove();
    } catch (error) {
        // Ignore if volume doesn't exist
    }
}

/**
 * Copy files from container to host directory
 *
 * @param container - Docker container instance
 * @param containerPath - Path in container to copy from
 * @param hostPath - Path on host to copy to
 * @returns Promise that resolves when copy is complete
 */
export async function copyFilesFromContainer(
    container: Docker.Container,
    containerPath: string,
    hostPath: string
): Promise<void> {
    try {
        const tarStream = await container.getArchive({ path: containerPath });

        // We need to extract the tar stream to the host path
        // Since we can't easily use tar in this environment without adding dependencies,
        // we'll use a simpler approach: use 'docker cp' command if available, 
        // or rely on the fact that we might be running in a node environment where we can use 'tar-fs' or similar if installed.
        // But we don't want to add dependencies if possible.

        // Alternative: Use 'docker cp' via exec if we are on the host?
        // But we are using dockerode.

        // Let's use the 'tar' package if available, or just stream it to a file?
        // No, we need to extract it.

        // Actually, since we are in n8n, we might not have 'tar' npm package.
        // Let's try to use the docker CLI 'cp' command as a fallback if we can't handle the stream easily.
        // But we should try to use the stream.

        // For now, let's assume we can use the 'tar' command line tool if available on the system.
        const fs = require('fs');
        const path = require('path');
        const child_process = require('child_process');

        // Create a temporary tar file
        const tempTarFile = path.join(hostPath, `extract-${Date.now()}.tar`);
        const fileStream = fs.createWriteStream(tempTarFile);

        await new Promise((resolve, reject) => {
            tarStream.pipe(fileStream);
            tarStream.on('end', resolve);
            tarStream.on('error', reject);
            fileStream.on('error', reject);
        });

        // Extract using tar command
        try {
            child_process.execSync(`tar -xf "${tempTarFile}" -C "${hostPath}"`);
        } catch (error) {
            // If tar fails (e.g. windows), we might need another way.
            // But for now, assuming Linux/Mac environment for n8n.
            console.error('Failed to extract tar:', error);
        } finally {
            // Cleanup tar file
            if (fs.existsSync(tempTarFile)) {
                fs.unlinkSync(tempTarFile);
            }
        }

    } catch (error) {
        throw new Error(`Failed to copy files from container: ${error.message}`);
    }
}

/**
 * Copy files from a Docker volume to host directory using dockerode
 * Creates a temporary container, mounts the volume, and uses getArchive to extract files
 *
 * @param docker - Docker client instance
 * @param volumeName - Name of the Docker volume
 * @param volumeMountPath - Path where volume is mounted in container
 * @param sourcePath - Path inside the volume to copy from (relative to volumeMountPath)
 * @param hostPath - Path on host to copy to
 * @param socketPath - Docker socket path
 * @returns Promise that resolves when copy is complete
 */
export async function copyFilesFromVolume(
    docker: Docker,
    volumeName: string,
    volumeMountPath: string,
    sourcePath: string,
    hostPath: string,
    socketPath?: string
): Promise<{ tarContents?: string[]; extractedFiles?: string[]; tarFileSize?: number }> {
    let tempContainer: Docker.Container | null = null;

    try {
        // Create a temporary container that mounts the volume
        // Use alpine:latest as it's small and has basic tools
        const containerConfig: ContainerExecutionConfig = {
            image: 'alpine:latest',
            command: 'sleep infinity', // Keep container running so we can copy from it
            socketPath,
            volumes: [`${volumeName}:${volumeMountPath}:ro`],
            autoRemove: false, // We'll remove it manually
        };

        tempContainer = await createContainer(docker, containerConfig);

        // Start the container
        await tempContainer.start();

        // Wait a moment for container to fully start
        await new Promise(resolve => setTimeout(resolve, 500));

        // Construct the full path inside the container
        // If sourcePath is absolute and starts with volumeMountPath, use it directly
        // Otherwise, construct relative to volumeMountPath
        let containerPath: string;
        if (sourcePath.startsWith('/')) {
            if (sourcePath.startsWith(volumeMountPath)) {
                // Absolute path inside the volume mount - use as-is
                containerPath = sourcePath;
            } else {
                // Absolute path but not in volume mount - still try it (user specified it)
                containerPath = sourcePath;
            }
        } else {
            // Relative path - construct full path
            containerPath = `${volumeMountPath}/${sourcePath}`;
        }

        console.log(`[copyFilesFromVolume] Attempting to copy from container path: ${containerPath}`);

        // First, list the directory contents using dockerode exec (no docker CLI needed)
        let filesInDir: string[] = [];
        try {
            const exec = await tempContainer.exec({
                Cmd: ['sh', '-c', `find "${containerPath}" -type f -maxdepth 1 2>/dev/null | sed 's|${containerPath}/||' || ls -1 "${containerPath}" 2>/dev/null | grep -v '^$' || echo ""`],
                AttachStdout: true,
                AttachStderr: true,
            });

            const stream = await exec.start({ hijack: true, stdin: false });
            const chunks: Buffer[] = [];

            await new Promise<void>((resolve) => {
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', resolve);
                stream.on('error', () => resolve()); // Don't fail on error

                // Also wait for exec to finish
                setTimeout(() => resolve(), 2000); // Timeout after 2 seconds
            });

            const outputBuffer = Buffer.concat(chunks);

            // Parse multiplexed Docker logs to get clean stdout
            const logEntries = parseDockerLogs(outputBuffer);
            const { stdoutText } = separateLogStreams(logEntries);
            const output = stdoutText.trim();

            if (output) {
                filesInDir = output.split('\n').filter(f => f.trim() && !f.includes('Permission denied'));
                console.log(`[copyFilesFromVolume] Found ${filesInDir.length} files in directory:`, filesInDir);
            } else {
                console.warn(`[copyFilesFromVolume] Directory appears to be empty or doesn't exist`);
            }
        } catch (listError) {
            console.warn(`[copyFilesFromVolume] Could not list directory contents: ${listError}`);
        }

        // If we found files, copy them individually
        // Otherwise, try copying the directory as a whole
        let tarStream: NodeJS.ReadableStream;

        if (filesInDir.length > 0) {
            // Copy files individually and combine them
            console.log(`[copyFilesFromVolume] Copying ${filesInDir.length} files individually`);
            const fs = require('fs');
            const path = require('path');
            const child_process = require('child_process');

            // Ensure host path exists
            await fs.promises.mkdir(hostPath, { recursive: true });

            // Copy each file individually
            for (const fileName of filesInDir) {
                const filePath = `${containerPath}/${fileName}`;
                try {
                    const fileTarStream = await tempContainer.getArchive({ path: filePath });
                    const tempTarFile = path.join(hostPath, `file-${Date.now()}-${fileName.replace(/[^a-zA-Z0-9]/g, '_')}.tar`);
                    const fileStream = fs.createWriteStream(tempTarFile);

                    await new Promise<void>((resolve, reject) => {
                        fileTarStream.pipe(fileStream);
                        fileStream.on('finish', resolve);
                        fileTarStream.on('error', reject);
                        fileStream.on('error', reject);
                    });

                    // Verify tar file size
                    const tarStats = fs.statSync(tempTarFile);
                    console.log(`[copyFilesFromVolume] Temp tar file size: ${tarStats.size} bytes`);

                    // Extract the file tar
                    try {
                        // When extracting a single file from getArchive, it's at the root of the tar
                        // So we don't need to strip components
                        child_process.execSync(`tar -xf "${tempTarFile}" -C "${hostPath}"`, { stdio: 'pipe' });
                        console.log(`[copyFilesFromVolume] Extracted file: ${fileName}`);
                    } catch (extractError) {
                        console.warn(`[copyFilesFromVolume] Failed to extract ${fileName}: ${extractError}`);
                    }

                    // Cleanup temp tar file
                    try {
                        if (fs.existsSync(tempTarFile)) {
                            fs.unlinkSync(tempTarFile);
                        }
                    } catch (cleanupError) {
                        // Ignore
                    }
                } catch (fileError: any) {
                    console.warn(`[copyFilesFromVolume] Failed to copy file ${fileName}: ${fileError.message}`);
                }
            }

            // Return early since we've already extracted files
            let extractedFiles: string[] = [];
            try {
                extractedFiles = await fs.promises.readdir(hostPath);
                console.log(`[copyFilesFromVolume] Extracted files in ${hostPath}:`, extractedFiles);
            } catch (err) {
                console.warn(`[copyFilesFromVolume] Failed to list extracted files: ${err}`);
            }
            return { tarContents: filesInDir, extractedFiles, tarFileSize: 0 };
        }

        // If no files found via listing, try copying the directory as a whole
        try {
            tarStream = await tempContainer.getArchive({ path: containerPath });
        } catch (error: any) {
            // If directory copy fails, try with trailing slash
            try {
                console.log(`[copyFilesFromVolume] Retrying with trailing slash: ${containerPath}/`);
                tarStream = await tempContainer.getArchive({ path: `${containerPath}/` });
            } catch (slashError: any) {
                if (error.statusCode === 404 || error.message?.includes('No such file') || error.message?.includes('not found')) {
                    console.warn(`[copyFilesFromVolume] Path ${containerPath} does not exist in volume ${volumeName}`);
                    return { tarContents: [], extractedFiles: [], tarFileSize: 0 };
                }
                throw error;
            }
        }

        // Extract tar stream to host path
        const fs = require('fs');
        const path = require('path');
        const child_process = require('child_process');

        // Ensure host path exists
        await fs.promises.mkdir(hostPath, { recursive: true });

        // Create a temporary tar file
        const tempTarFile = path.join(hostPath, `extract-${Date.now()}.tar`);
        const fileStream = fs.createWriteStream(tempTarFile);

        let bytesWritten = 0;
        await new Promise<void>((resolve, reject) => {
            tarStream.on('data', (chunk: Buffer) => {
                bytesWritten += chunk.length;
            });
            tarStream.pipe(fileStream);
            tarStream.on('end', () => {
                console.log(`[copyFilesFromVolume] Tar stream ended, wrote ${bytesWritten} bytes`);
                resolve();
            });
            tarStream.on('error', reject);
            fileStream.on('error', reject);
        });

        // Verify file was written
        const finalStats = await fs.promises.stat(tempTarFile).catch(() => null);
        if (!finalStats || finalStats.size === 0) {
            console.error(`[copyFilesFromVolume] Tar file is empty after writing stream!`);
            return { tarContents: [], extractedFiles: [], tarFileSize: 0 };
        }
        console.log(`[copyFilesFromVolume] Tar file written: ${finalStats.size} bytes`);

        // Calculate number of path components to strip
        // Docker's getArchive includes the full path in the tar
        // For /agent/workspace/output, tar contains: agent/workspace/output/test.bin
        // We need to strip 3 components to get: test.bin
        const pathComponents = containerPath.split('/').filter(p => p.length > 0);
        const stripComponents = pathComponents.length;

        console.log(`[copyFilesFromVolume] Extracting tar with strip-components=${stripComponents} for path: ${containerPath}`);

        // List tar contents for debugging
        let tarContentsStr = '';
        let tarFileSize = 0;
        try {
            const stats = await fs.promises.stat(tempTarFile);
            tarFileSize = stats.size;
            console.log(`[copyFilesFromVolume] Tar file size: ${tarFileSize} bytes`);

            if (tarFileSize > 0) {
                tarContentsStr = child_process.execSync(`tar -tf "${tempTarFile}" 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                console.log(`[copyFilesFromVolume] Tar contents:\n${tarContentsStr}`);
            } else {
                console.warn(`[copyFilesFromVolume] Tar file is empty!`);
            }
        } catch (listError) {
            console.warn(`[copyFilesFromVolume] Could not list tar contents: ${listError}`);
            // Try to verify tar file exists and has content
            try {
                const stats = await fs.promises.stat(tempTarFile);
                tarFileSize = stats.size;
                console.log(`[copyFilesFromVolume] Tar file exists, size: ${tarFileSize} bytes`);
            } catch (statError) {
                console.error(`[copyFilesFromVolume] Tar file doesn't exist or can't be accessed`);
            }
        }

        // Store tar contents for debugging
        const debugInfo: { tarContents?: string[]; extractedFiles?: string[]; tarFileSize?: number } = {
            tarContents: tarContentsStr ? tarContentsStr.split('\n').filter((l: string) => l.trim()) : [],
            tarFileSize
        };

        // Extract using tar command with appropriate strip-components
        // First verify tar file is not empty
        if (tarFileSize === 0) {
            console.error(`[copyFilesFromVolume] Cannot extract: tar file is empty (${tarFileSize} bytes)`);
            return debugInfo;
        }

        // Try extraction - first without strip-components to see the structure
        let extractionSucceeded = false;
        try {
            // First, try extracting without strip-components to see what we get
            console.log(`[copyFilesFromVolume] Attempting extraction without strip-components first to inspect structure`);
            const extractOutput1 = child_process.execSync(
                `tar -xf "${tempTarFile}" -C "${hostPath}" 2>&1 || true`,
                { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
            );
            if (extractOutput1) {
                console.log(`[copyFilesFromVolume] Extract output (no strip): ${extractOutput1}`);
            }

            // Check what was extracted
            async function checkExtractedFiles(dir: string, baseDir: string = dir): Promise<string[]> {
                const files: string[] = [];
                try {
                    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        const relativePath = path.relative(baseDir, fullPath);
                        if (entry.isDirectory()) {
                            const subFiles = await checkExtractedFiles(fullPath, baseDir);
                            files.push(...subFiles);
                        } else if (entry.isFile()) {
                            files.push(relativePath);
                        }
                    }
                } catch (err) {
                    // Ignore errors
                }
                return files;
            }

            const filesAfterExtract = await checkExtractedFiles(hostPath);
            console.log(`[copyFilesFromVolume] Files after extraction (no strip):`, filesAfterExtract);

            if (filesAfterExtract.length > 0) {
                extractionSucceeded = true;
                debugInfo.extractedFiles = filesAfterExtract;

                // If files are in subdirectories, move them to root
                for (const file of filesAfterExtract) {
                    const sourcePath = path.join(hostPath, file);
                    const fileName = path.basename(file);
                    const targetPath = path.join(hostPath, fileName);

                    // Only move if it's not already at root
                    if (sourcePath !== targetPath && file !== fileName) {
                        try {
                            await fs.promises.copyFile(sourcePath, targetPath);
                            console.log(`[copyFilesFromVolume] Moved ${file} to ${fileName}`);
                        } catch (moveError) {
                            console.warn(`[copyFilesFromVolume] Failed to move ${file}: ${moveError}`);
                        }
                    }
                }
            } else {
                // No files found, try with strip-components
                console.log(`[copyFilesFromVolume] No files found, trying with --strip-components=${stripComponents}`);
                if (stripComponents > 0) {
                    // Clean up and try again with strip-components
                    try {
                        const entries = await fs.promises.readdir(hostPath, { withFileTypes: true });
                        for (const entry of entries) {
                            const fullPath = path.join(hostPath, entry.name);
                            if (entry.isDirectory()) {
                                await fs.promises.rm(fullPath, { recursive: true, force: true });
                            } else if (entry.isFile() && entry.name.endsWith('.tar')) {
                                // Keep tar file
                            } else {
                                await fs.promises.unlink(fullPath).catch(() => { });
                            }
                        }
                    } catch (cleanupError) {
                        // Ignore cleanup errors
                    }

                    const extractOutput2 = child_process.execSync(
                        `tar -xf "${tempTarFile}" -C "${hostPath}" --strip-components=${stripComponents} 2>&1 || true`,
                        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
                    );
                    if (extractOutput2) {
                        console.log(`[copyFilesFromVolume] Extract output (with strip): ${extractOutput2}`);
                    }

                    const filesAfterStrip = await checkExtractedFiles(hostPath);
                    console.log(`[copyFilesFromVolume] Files after extraction (with strip):`, filesAfterStrip);
                    if (filesAfterStrip.length > 0) {
                        extractionSucceeded = true;
                        debugInfo.extractedFiles = filesAfterStrip;
                    }
                }
            }

            if (extractionSucceeded) {
                console.log(`[copyFilesFromVolume] Successfully extracted tar to ${hostPath}`);
            } else {
                console.warn(`[copyFilesFromVolume] Extraction completed but no files found`);
                debugInfo.extractedFiles = [];
            }
        } catch (error: any) {
            console.error(`[copyFilesFromVolume] Extraction failed: ${error.message}`);
            console.error(`[copyFilesFromVolume] Tar contents were:\n${tarContentsStr}`);
            console.error(`[copyFilesFromVolume] Attempted to strip ${stripComponents} components from path: ${containerPath}`);

            // If stripping fails, try without strip-components (files will be in subdirectories)
            try {
                console.log(`[copyFilesFromVolume] Retrying extraction without strip-components`);
                child_process.execSync(`tar -xf "${tempTarFile}" -C "${hostPath}"`, { stdio: 'pipe' });
                console.warn(`[copyFilesFromVolume] Extracted without stripping - files may be in subdirectories`);

                // Check what was extracted (recursively)
                try {
                    async function findAllFiles(dir: string, baseDir: string = dir): Promise<string[]> {
                        const files: string[] = [];
                        try {
                            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                const fullPath = path.join(dir, entry.name);
                                const relativePath = path.relative(baseDir, fullPath);
                                if (entry.isDirectory()) {
                                    const subFiles = await findAllFiles(fullPath, baseDir);
                                    files.push(...subFiles);
                                } else if (entry.isFile()) {
                                    files.push(relativePath);
                                }
                            }
                        } catch (err) {
                            // Ignore errors
                        }
                        return files;
                    }

                    const extractedFiles = await findAllFiles(hostPath);
                    console.log(`[copyFilesFromVolume] Files after extraction (no strip, recursive):`, extractedFiles);
                    debugInfo.extractedFiles = extractedFiles;

                    // Move files from subdirectories to root
                    if (extractedFiles.length > 0) {
                        for (const file of extractedFiles) {
                            const sourcePath = path.join(hostPath, file);
                            const fileName = path.basename(file);
                            const targetPath = path.join(hostPath, fileName);

                            if (sourcePath !== targetPath && file !== fileName) {
                                try {
                                    await fs.promises.copyFile(sourcePath, targetPath);
                                    console.log(`[copyFilesFromVolume] Moved ${file} to ${fileName}`);
                                } catch (moveError) {
                                    console.warn(`[copyFilesFromVolume] Failed to move ${file}: ${moveError}`);
                                }
                            }
                        }
                    }
                } catch (listError) {
                    console.warn(`[copyFilesFromVolume] Could not list extracted files: ${listError}`);
                    debugInfo.extractedFiles = [];
                }
            } catch (innerError: any) {
                throw new Error(`Failed to extract tar archive: ${error.message}. Inner error: ${innerError.message}`);
            }
        } finally {
            // Cleanup tar file
            try {
                if (fs.existsSync(tempTarFile)) {
                    fs.unlinkSync(tempTarFile);
                }
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
        }

        // Return debug info
        return debugInfo;
    } catch (error) {
        throw new Error(`Failed to copy files from volume: ${error.message}`);
    } finally {
        // Clean up temporary container
        if (tempContainer) {
            try {
                await tempContainer.stop();
                await tempContainer.remove({ v: true });
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
        }
    }
}

// Session-based volume management for Claude Agent tool persistence

/**
 * Generate a session-based volume ID for Claude Agent workspace persistence
 * Uses a combination of workflow execution context and timestamp
 *
 * @param context - n8n execution context
 * @returns Session-based volume name
 */
export function generateSessionVolumeName(context?: any): string {
    // Try to get workflow ID from context
    let workflowId = 'unknown-workflow';

    if (context && typeof context.getWorkflowId === 'function') {
        try {
            workflowId = context.getWorkflowId();
        } catch (error) {
            console.warn('Could not get workflow ID for session volume:', error);
        }
    }

    // Use a fixed session identifier based on current date + workflow ID
    // This ensures all containers in the same Claude Agent session share the same volume
    const today = new Date();
    const sessionDate = today.toISOString().split('T')[0]; // YYYY-MM-DD

    // Create a hash from workflow ID and session date for consistency
    const sessionSeed = `${workflowId}-${sessionDate}`;
    const sessionHash = Buffer.from(sessionSeed).toString('base64').replace(/[+/=]/g, '').substring(0, 16);

    return `n8n-workspace-${sessionHash}`;
}

/**
 * Get the current workspace volume name
 *优先从环境变量或上下文中获取，否则生成新的
 *
 * @param context - n8n execution context
 * @returns Workspace volume name
 */
export function getWorkspaceVolumeName(context?: any): string {
    // Try to get from environment variable first (for Claude Agent session persistence)
    if (process.env.N8N_WORKSPACE_VOLUME) {
        return process.env.N8N_WORKSPACE_VOLUME;
    }

    // Try to get from context data
    if (context && context.getNode && typeof context.getNode === 'function') {
        try {
            const node = context.getNode();
            if (node && node.id) {
                // Use node ID as fallback for session identification
                return `n8n-workspace-${node.id}`;
            }
        } catch (error) {
            console.warn('Could not get node ID for workspace volume:', error);
        }
    }

    // Generate session-based volume name
    return generateSessionVolumeName(context);
}

/**
 * Set workspace volume name in environment for session persistence
 * Call this once at the beginning of a Claude Agent session
 *
 * @param context - n8n execution context
 */
export function setWorkspaceVolumeSession(context?: any): void {
    const volumeName = getWorkspaceVolumeName(context);
    process.env.N8N_WORKSPACE_VOLUME = volumeName;
    console.log(`[WorkspaceVolume] Set session volume: ${volumeName}`);
}