import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionTypes,
    ISupplyDataFunctions,
} from 'n8n-workflow';
import { mainProperties } from './Description';

export class RunContainerTool implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Run Container Tool',
        name: 'runContainerTool',
        icon: { light: 'file:img/runContainer.svg', dark: 'file:img/runContainer.dark.svg' },
        group: ['transform'],
        version: 1,
        description: 'Runs a Docker container as a tool with access to additional interfaces',
        defaults: {
            name: 'Run Container Tool',
        },
        inputs: [
            {
                displayName: 'Chat Model',
                type: NodeConnectionTypes.AiLanguageModel,
                required: true,
                maxConnections: 1,
                filter: {
                    nodes: ['@n8n/n8n-nodes-langchain.lmChatAnthropic'],
                },
            },
            {
                displayName: 'Memory',
                type: NodeConnectionTypes.AiMemory,
            },
            {
                displayName: 'Tools',
                type: NodeConnectionTypes.AiTool,
            },
            {
                displayName: 'Output Parser',
                type: NodeConnectionTypes.AiOutputParser,
                maxConnections: 1,
            },
        ],
        outputs: [NodeConnectionTypes.AiTool],
        properties: mainProperties,
    };

    // When used as a tool, n8n will automatically wrap this node as a tool
    // The execute method will be called with tool args as input data
    async execute(this: IExecuteFunctions | ISupplyDataFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                // Extract the tool arguments from the input data
                const toolArgs = items[itemIndex].json;

                // Get Docker socket path with auto-detection logic
                let socketPath = this.getNodeParameter('socketPath', itemIndex) as string || '/var/run/docker.sock';

                // Auto-detect Docker socket if default path doesn't exist
                if (socketPath === '/var/run/docker.sock') {
                    const fs = require('fs');
                    const path = require('path');
                    const os = require('os');

                    if (!fs.existsSync(socketPath)) {
                        // Try Colima path on macOS
                        if (os.platform() === 'darwin') {
                            const colimaPath = path.join(os.homedir(), '.colima', 'default', 'docker.sock');
                            if (fs.existsSync(colimaPath)) {
                                socketPath = colimaPath;
                            }
                        }
                    }
                }

                // Get container parameters from tool args or node parameters
                const image = toolArgs.image || this.getNodeParameter('image', itemIndex) as string;
                const executionMode = toolArgs.executionMode || this.getNodeParameter('executionMode', itemIndex, 'simple') as string;
                const entrypoint = toolArgs.entrypoint || this.getNodeParameter('entrypoint', itemIndex, '') as string;
                const command = toolArgs.command || this.getNodeParameter('command', itemIndex, '') as string;

                // Handle environment variables from tool args or node parameters
                let envVars: string[] = [];
                const sendEnv = this.getNodeParameter('sendEnv', itemIndex, false) as boolean;

                if (toolArgs.environmentVariables) {
                    // Environment variables from tool args take precedence
                    const envData = toolArgs.environmentVariables;
                    if (typeof envData === 'object' && envData !== null) {
                        for (const [key, val] of Object.entries(envData)) {
                            envVars.push(`${key}=${val}`);
                        }
                    }
                } else if (sendEnv) {
                    // Fall back to node parameter environment variables
                    const specifyEnv = this.getNodeParameter('specifyEnv', itemIndex, 'keypair') as string;

                    if (specifyEnv === 'json') {
                        const jsonEnv = this.getNodeParameter('jsonEnv', itemIndex, '') as string;
                        try {
                            const { jsonParse } = require('n8n-workflow');
                            const envData = jsonParse(jsonEnv) as Record<string, any>;
                            for (const [key, val] of Object.entries(envData)) {
                                envVars.push(`${key}=${val}`);
                            }
                        } catch (error) {
                            const { NodeOperationError } = require('n8n-workflow');
                            throw new NodeOperationError(
                                this.getNode(),
                                `Failed to parse JSON environment variables: ${error.message}`,
                                { itemIndex },
                            );
                        }
                    } else if (specifyEnv === 'keypair') {
                        const envCollection = this.getNodeParameter('parametersEnv', itemIndex, {}) as {
                            values: Array<{ name: string; value?: string }>;
                        };

                        for (const envVar of envCollection.values || []) {
                            if (envVar.name && envVar.value !== undefined) {
                                envVars.push(`${envVar.name}=${envVar.value}`);
                            }
                        }
                    }
                }

                if (!image) {
                    const { NodeOperationError } = require('n8n-workflow');
                    throw new NodeOperationError(
                        this.getNode(),
                        'The "Image" parameter is required',
                        { itemIndex },
                    );
                }

                // Extract binary parameters from tool args, falling back to node parameters
                // Note: LLM might not pass these complex objects, so we rely on node config mostly
                // but we check toolArgs just in case
                const binaryDataInput = toolArgs.binaryDataInput !== undefined
                    ? toolArgs.binaryDataInput
                    : this.getNodeParameter('binaryDataInput', itemIndex, false) as boolean;

                const binaryDataOutput = toolArgs.binaryDataOutput !== undefined
                    ? toolArgs.binaryDataOutput
                    : this.getNodeParameter('binaryDataOutput', itemIndex, false) as boolean;

                // For binary mappings, we primarily rely on node config as it's complex for LLM
                // But if LLM passes a structure that matches, we use it
                let binaryFileMappings = { mappings: [] as Array<{ binaryPropertyName: string; containerPath: string }> };
                if (toolArgs.binaryFileMappings && typeof toolArgs.binaryFileMappings === 'object') {
                    binaryFileMappings = toolArgs.binaryFileMappings as any;
                } else {
                    binaryFileMappings = this.getNodeParameter(
                        'binaryFileMappings',
                        itemIndex,
                        { mappings: [] },
                    ) as { mappings: Array<{ binaryPropertyName: string; containerPath: string }> };
                }

                const outputFilePattern = toolArgs.outputFilePattern || this.getNodeParameter('outputFilePattern', itemIndex, '*') as string;
                const outputDirectory = toolArgs.outputDirectory || this.getNodeParameter('outputDirectory', itemIndex, '/agent/workspace/output') as string;

                const workspaceMountPath = toolArgs.workspaceMountPath || this.getNodeParameter('workspaceMountPath', itemIndex, '/agent/workspace') as string;
                const binaryInputPath = toolArgs.binaryInputPath || this.getNodeParameter('binaryInputPath', itemIndex, '/agent/workspace/input') as string;

                // Import the executeContainerWithBinary function
                const { executeContainerWithBinary } = require('./RunContainerLogic');

                const result = await executeContainerWithBinary(this, itemIndex, {
                    image,
                    entrypoint,
                    command,
                    socketPath,
                    envVars,
                    executionMode,
                    binaryDataInput,
                    binaryDataOutput,
                    binaryFileMappings,
                    outputFilePattern,
                    workspaceMountPath,
                    binaryInputPath,
                    outputDirectory,
                });

                // Debug: Log the structure of the result being returned
                console.log('[RunContainerTool] Result structure:', {
                    hasBinary: !!result.binary,
                    hasJson: !!result.json,
                    binaryKeys: result.binary ? Object.keys(result.binary) : [],
                    jsonKeys: result.json ? Object.keys(result.json) : [],
                    fullStructure: JSON.stringify(result, null, 2)
                });

                // For AI tool execution, we need to manually include binary data in the JSON
                // because n8n serializes tool results to JSON, losing binary data
                if (result.binary && Object.keys(result.binary).length > 0) {
                    const resultWithBinary = {
                        ...result.json,
                        binary: result.binary
                    };
                    console.log('[RunContainerTool] Including binary data in JSON result:', {
                        binaryKeys: Object.keys(result.binary)
                    });
                    returnData.push({
                        json: resultWithBinary
                    });
                } else {
                    returnData.push(result);
                }

            } catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            error: error.message,
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    });
                } else {
                    const { NodeOperationError } = require('n8n-workflow');
                    throw new NodeOperationError(this.getNode(), error, {
                        itemIndex,
                    });
                }
            }
        }

        return [returnData];
    }
}