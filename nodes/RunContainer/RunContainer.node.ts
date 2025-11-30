import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';

import { mainProperties } from './Description';
import { processEnvironmentVariables } from './GenericFunctions';
import { executeContainerWithBinary } from './RunContainerLogic';

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
                // Get socket path
                const socketPath = this.getNodeParameter('socketPath', itemIndex, '/var/run/docker.sock') as string;

                // Get container parameters
                const image = this.getNodeParameter('image', itemIndex) as string;
                const executionMode = this.getNodeParameter('executionMode', itemIndex, 'simple') as string;
                const entrypoint = this.getNodeParameter('entrypoint', itemIndex, '') as string;
                const command = this.getNodeParameter('command', itemIndex, '') as string;

                // Process environment variables
                const envResult = await processEnvironmentVariables.call(this, itemIndex);

                // Check if binary data input/output is enabled
                const binaryDataInput = this.getNodeParameter('binaryDataInput', itemIndex, false) as boolean;
                const binaryDataOutput = this.getNodeParameter('binaryDataOutput', itemIndex, false) as boolean;

                // Get binary file mappings
                const binaryFileMappings = this.getNodeParameter(
                    'binaryFileMappings',
                    itemIndex,
                    { mappings: [] },
                ) as { mappings: Array<{ binaryPropertyName: string; containerPath: string }> };

                // Get output file pattern and directory
                const outputFilePattern = this.getNodeParameter('outputFilePattern', itemIndex, '*') as string;
                const outputDirectory = this.getNodeParameter('outputDirectory', itemIndex, '/agent/workspace/output') as string;

                // Get workspace and binary input paths
                const workspaceMountPath = this.getNodeParameter('workspaceMountPath', itemIndex, '/agent/workspace') as string;
                const binaryInputPath = this.getNodeParameter('binaryInputPath', itemIndex, '/agent/workspace/input') as string;

                // Execute container using shared logic
                const result = await executeContainerWithBinary(this, itemIndex, {
                    image,
                    entrypoint,
                    command,
                    executionMode,
                    socketPath,
                    envVars: envResult.variables,
                    binaryDataInput,
                    binaryDataOutput,
                    binaryFileMappings,
                    outputFilePattern,
                    workspaceMountPath,
                    binaryInputPath,
                    outputDirectory,
                });

                returnData.push(result);

            } catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            error: error.message,
                            success: false,
                            exitCode: -1,
                            stdout: '',
                            stderr: error.message
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    });
                } else {
                    throw error;
                }
            }
        }

        return [returnData];
    }
}
