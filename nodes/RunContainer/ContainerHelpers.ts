/**
 * Docker container management helpers
 * High-level container operations and lifecycle management
 */

import Docker from 'dockerode';
import { parseCommand } from './utils/commandParser';
import { detectDockerSocket } from './utils/socketDetector';
import { parseContainerResult, formatContainerResult } from './utils/logParser';

/**
 * Container execution configuration
 */
export interface ContainerExecutionConfig {
    image: string;
    entrypoint?: string;
    command?: string;
    environmentVariables?: string[];
    socketPath?: string;
    workingDir?: string;
    autoRemove?: boolean;
    pullPolicy?: 'always' | 'missing' | 'never';
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
            // Don't pull, just check if exists
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
export async function createContainer(
    docker: Docker,
    config: ContainerExecutionConfig
): Promise<Docker.Container> {
    // Parse entrypoint and command
    const entrypointArray = config.entrypoint ? parseCommand(config.entrypoint) : undefined;
    const commandArray = config.command ? parseCommand(config.command) : [];

    // Build container options
    const createOptions: any = {
        Image: config.image,
        Env: config.environmentVariables || [],
        Tty: false,
        AttachStdout: true,
        AttachStderr: true,
        HostConfig: {
            AutoRemove: config.autoRemove !== false // Default to true
        }
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

        // Get container logs
        const logsBuffer = await getContainerLogs(container);

        // Parse and format results
        const parsedResult = parseContainerResult(logsBuffer, exitCode);
        return formatContainerResult(parsedResult);
    } finally {
        // Clean up container if it wasn't auto-removed
        if (config.autoRemove !== false) {
            try {
                await container.remove({ v: true });
            } catch (error) {
                // Ignore removal errors (container might already be removed)
            }
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