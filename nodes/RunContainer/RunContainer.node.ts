import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeOperationError,
} from 'n8n-workflow';

import { mainProperties } from './Description';
import {
    processEnvironmentVariables,
    validateDockerImageName,
    formatDockerError,
    isDockerConnectionError
} from './GenericFunctions';
import { executeContainer, ContainerExecutionConfig } from './ContainerHelpers';
import { detectDockerSocket } from './utils/socketDetector';

export class RunContainer implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Run Container',
        name: 'runContainer',
        icon: { light: 'file:img/runContainer.svg', dark: 'file:img/runContainer.dark.svg' },
        group: ['transform'],
        version: 1,
        description: 'Runs a Docker container',
        defaults: {
            name: 'Run Container',
        },
        inputs: ['main'],
        outputs: ['main'],
        properties: mainProperties,
        usableAsTool: true,
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                // Get socket path with auto-detection
                let socketPath = this.getNodeParameter('socketPath', itemIndex, '/var/run/docker.sock') as string;

                // Auto-detect Docker socket if using default path
                if (socketPath === '/var/run/docker.sock') {
                    const socketDetection = detectDockerSocket();
                    socketPath = socketDetection.path;
                }

                // Get container parameters
                const image = this.getNodeParameter('image', itemIndex) as string;
                const entrypoint = this.getNodeParameter('entrypoint', itemIndex, '') as string;
                const command = this.getNodeParameter('command', itemIndex, '') as string;

                // Validate image name
                const imageValidation = validateDockerImageName(image);
                if (!imageValidation.valid) {
                    throw new NodeOperationError(
                        this.getNode(),
                        `Invalid Docker image: ${imageValidation.errors.join(', ')}`,
                        { itemIndex }
                    );
                }

                // Process environment variables
                const envResult = await processEnvironmentVariables.call(this, itemIndex);

                // Build container configuration
                const containerConfig: ContainerExecutionConfig = {
                    image,
                    entrypoint: entrypoint || undefined,
                    command: command || undefined,
                    environmentVariables: envResult.variables,
                    socketPath,
                    autoRemove: true,
                    pullPolicy: 'missing' // Only pull if image doesn't exist locally
                };

                // Execute container
                const result = await executeContainer(
                    containerConfig,
                    (progress) => {
                        // Optional: Log pull progress for debugging
                        // This could be enhanced to send progress to n8n UI in the future
                        if (progress.status && progress.status !== 'Downloading') {
                            // console.log(`Docker pull progress: ${progress.status}`);
                        }
                    }
                );

                returnData.push({
                    json: {
                        stdout: result.stdout,
                        stderr: result.stderr,
                        exitCode: result.exitCode,
                        success: result.success,
                        hasOutput: result.hasOutput,
                        container: {
                            image,
                            command: containerConfig.command,
                            entrypoint: containerConfig.entrypoint,
                            environmentVariablesCount: envResult.count,
                            socketPath
                        }
                    },
                    pairedItem: {
                        item: itemIndex,
                    },
                });

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
                        `Image: ${this.getNodeParameter('image', itemIndex, 'unknown')}`
                    );
                }

                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            error: errorMessage,
                            success: false,
                            exitCode: -1,
                            stdout: '',
                            stderr: errorMessage
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    });
                } else {
                    throw new NodeOperationError(this.getNode(), errorMessage, {
                        itemIndex,
                    });
                }
            }
        }

        return [returnData];
    }
}

// Export the runContainer function for backward compatibility and reuse by RunContainerTool
export async function runContainer(
    socketPath: string,
    image: string,
    entrypoint: string,
    command: string,
    envVars: string[],
): Promise<{ stdout: Buffer; stderr: Buffer; statusCode: number }> {
    // Use the new container execution system for backward compatibility
    const containerConfig: ContainerExecutionConfig = {
        image,
        entrypoint: entrypoint || undefined,
        command: command || undefined,
        environmentVariables: envVars,
        socketPath,
        autoRemove: true,
        pullPolicy: 'missing'
    };

    const result = await executeContainer(containerConfig);

    // Convert back to the expected format for backward compatibility
    return {
        stdout: Buffer.from(result.stdout),
        stderr: Buffer.from(result.stderr),
        statusCode: result.exitCode
    };
}