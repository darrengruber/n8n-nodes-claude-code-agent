import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionTypes,
    NodeOperationError,
} from 'n8n-workflow';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { processToolsForAgent } from './McpToolAdapter';
import { DebugLogger } from './DebugLogger';

// Cache busting: Increment the node version when you want to force icon reload
// n8n uses the version property to handle caching internally
export class ClaudeAgent implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Claude Agent',
        name: 'claudeAgent',
        icon: 'file:img/claudeAgent.v2.svg',
        group: ['transform'],
        version: 2,
        description: 'Use the Claude Code SDK to run an AI agent',
        defaults: {
            name: 'Claude Agent',
        },
        inputs: [
            {
                displayName: '',
                type: NodeConnectionTypes.Main,
            },
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
        ],
        outputs: [NodeConnectionTypes.Main],
        properties: [
            {
                displayName: 'Source for Prompt (User Message)',
                name: 'promptType',
                type: 'options',
                options: [
                    {
                        name: 'Connected Chat Trigger Node',
                        value: 'auto',
                        description:
                            "Looks for an input field called 'chatInput' that is coming from a directly connected Chat Trigger",
                    },
                    {
                        name: 'Connected Guardrails Node',
                        value: 'guardrails',
                        description:
                            "Looks for an input field called 'guardrailsInput' that is coming from a directly connected Guardrails Node",
                    },
                    {
                        name: 'Define below',
                        value: 'define',
                        description: 'Use an expression to reference data in previous nodes or enter static text',
                    },
                ],
                default: 'auto',
            },
            {
                displayName: 'Prompt (User Message)',
                name: 'text',
                type: 'string',
                required: true,
                default: '={{ $json.chatInput }}',
                typeOptions: {
                    rows: 2,
                },
                displayOptions: {
                    show: {
                        promptType: ['auto'],
                    },
                },
            },
            {
                displayName: 'Prompt (User Message)',
                name: 'text',
                type: 'string',
                required: true,
                default: '={{ $json.guardrailsInput }}',
                typeOptions: {
                    rows: 2,
                },
                displayOptions: {
                    show: {
                        promptType: ['guardrails'],
                    },
                },
            },
            {
                displayName: 'Prompt (User Message)',
                name: 'text',
                type: 'string',
                required: true,
                default: '',
                placeholder: 'e.g. Hello, how can you help me?',
                typeOptions: {
                    rows: 2,
                },
                displayOptions: {
                    show: {
                        promptType: ['define'],
                    },
                },
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                options: [
                    {
                        displayName: 'System Message',
                        name: 'systemMessage',
                        type: 'string',
                        default: '',
                        description: 'System message to send to the agent',
                        typeOptions: {
                            rows: 4,
                        },
                    },
                    {
                        displayName: 'Max Turns',
                        name: 'maxTurns',
                        type: 'number',
                        default: 30,
                        description: 'Maximum number of conversational turns the agent can take',
                    },
                    {
                        displayName: 'Verbose',
                        name: 'verbose',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to return detailed execution logs',
                    },
                    {
                        displayName: 'Working Directory',
                        name: 'workingDirectory',
                        type: 'string',
                        default: '',
                        placeholder: '/path/to/project or leave empty for current directory',
                        description: 'The starting directory for the agent (optional, defaults to current directory)',
                    },
                ],
            },
        ],
    };



    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            let toolsCount = 0;
            const logger = new DebugLogger(true); // Always enable for debugging

            console.log('[ClaudeAgent] Logger created, log path:', logger.getLogPath());
            logger.logSection(`Processing Item ${itemIndex}`);

            try {
                const prompt = this.getNodeParameter('text', itemIndex, '') as string;


                // Retrieve the model from the AI Language Model input
                const connectedModel = (await this.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, itemIndex)) as any;

                if (!connectedModel) {
                    throw new NodeOperationError(
                        this.getNode(),
                        'Please connect an Anthropic Chat Model to the Chat Model input'
                    );
                }

                // Validate that it's an Anthropic model by checking the class type
                // ChatAnthropic models will have the constructor name 'ChatAnthropic'
                const isAnthropic = connectedModel.constructor?.name === 'ChatAnthropic' ||
                    connectedModel._llmType?.() === 'anthropic';

                if (!isAnthropic) {
                    throw new NodeOperationError(
                        this.getNode(),
                        'Only Anthropic Chat Models are supported. Please connect an Anthropic Chat Model node.'
                    );
                }

                // Extract configuration from the connected ChatAnthropic instance
                // Based on debug output, the ChatAnthropic LangChain class uses:
                // - anthropicApiKey: the API key from credentials
                // - apiUrl: the base URL from credentials  
                // - model: the model name
                const model = connectedModel.model;
                const apiKey = connectedModel.anthropicApiKey;
                const baseURL = connectedModel.apiUrl;

                // Set environment variables for the SDK
                // The SDK will use these to authenticate requests
                if (apiKey) {
                    process.env.ANTHROPIC_API_KEY = apiKey;
                }
                if (baseURL) {
                    process.env.ANTHROPIC_BASE_URL = baseURL;
                }

                logger.log('Retrieved model from Chat Model input', {
                    model,
                    modelType: connectedModel.constructor?.name,
                    isAnthropic,
                    hasApiKey: !!apiKey,
                    hasBaseURL: !!baseURL,
                    baseURL: baseURL || 'default',
                });

                const options = this.getNodeParameter('options', itemIndex, {}) as {
                    systemMessage?: string;
                    maxTurns?: number;
                    verbose?: boolean;
                    workingDirectory?: string;
                };

                logger.log('Retrieved parameters', {
                    promptLength: prompt.length,
                    promptPreview: prompt.length > 0 ? prompt.substring(0, 100) + '...' : '[EMPTY]',
                    model,
                    options
                });

                // Validate prompt is not empty
                if (!prompt || prompt.trim().length === 0) {
                    throw new NodeOperationError(
                        this.getNode(),
                        'The "Text" parameter is required and cannot be empty. Please provide a prompt for the agent.'
                    );
                }

                // Handle Memory
                let finalPrompt = prompt;
                try {
                    const memory = (await this.getInputConnectionData(NodeConnectionTypes.AiMemory, itemIndex)) as any;
                    if (memory && typeof memory.getMessages === 'function') {
                        const messages = await memory.getMessages();
                        if (Array.isArray(messages) && messages.length > 0) {
                            const history = messages.map((m: any) => {
                                // Attempt to determine role (human/ai/system)
                                let role = 'User';
                                if (m._getType) {
                                    const type = m._getType();
                                    if (type === 'ai') role = 'Assistant';
                                    else if (type === 'system') role = 'System';
                                } else if (m.type) {
                                    if (m.type === 'ai') role = 'Assistant';
                                    else if (m.type === 'system') role = 'System';
                                }
                                return `${role}: ${m.content}`;
                            }).join('\n');

                            if (history) {
                                finalPrompt = `Here is the conversation history:\n${history}\n\nCurrent request:\n${prompt}`;
                            }
                        }
                    }
                } catch (error) {
                    // Ignore memory errors and proceed with just the prompt
                    console.warn('Failed to retrieve or process memory:', error);
                }

                // Handle Tools
                logger.logSection('Tool Processing');
                let mcpServers: Record<string, any> = {};
                let disallowedTools: string[] = ['Bash', 'WebFetch']; // Default disallowed

                try {
                    const rawTools = (await this.getInputConnectionData(NodeConnectionTypes.AiTool, itemIndex)) as any[];

                    // Flatten tools (handle Toolkits)
                    const tools: any[] = [];
                    if (rawTools && rawTools.length > 0) {
                        for (const item of rawTools) {
                            if (item.tools && Array.isArray(item.tools)) {
                                logger.log(`Unwrapping toolkit with ${item.tools.length} tools`);
                                tools.push(...item.tools);
                            } else {
                                tools.push(item);
                            }
                        }
                    }

                    const result = await processToolsForAgent(tools, { verbose: !!options.verbose }, logger);
                    mcpServers = result.mcpServers;
                    disallowedTools = result.disallowedTools;

                    // Count total tools across all servers
                    toolsCount = tools.length;

                } catch (error) {
                    console.warn('Failed to process tools:', error);
                    logger.logError('Tool processing failed', error);
                }

                // Process working directory
                let finalWorkingDirectory: string | undefined;
                if (options.workingDirectory && options.workingDirectory.trim()) {
                    finalWorkingDirectory = options.workingDirectory.trim();
                    // Validate that the working directory exists (optional validation)
                    try {
                        // Simple validation - check if it looks like a path
                        if (!finalWorkingDirectory.startsWith('/')) {
                            logger.log('Working directory should be an absolute path');
                        }
                    } catch (error) {
                        logger.log('Working directory validation failed:', error);
                    }
                }


                // Log configuration before execution
                logger.logSection('SDK Query Configuration');
                const config = {
                    model,
                    systemPrompt: options.systemMessage ? 'Set' : 'Not set',
                    maxTurns: options.maxTurns,
                    mcpServerCount: Object.keys(mcpServers).length,
                    mcpServerNames: Object.keys(mcpServers),
                    toolsCount,
                    apiKeyPresent: !!process.env.ANTHROPIC_API_KEY,
                    baseUrl: process.env.ANTHROPIC_BASE_URL,
                    promptLength: finalPrompt.length,
                    workingDirectory: finalWorkingDirectory || 'Default (current directory)',
                };
                logger.log('Configuration', config);

                if (options.verbose) {
                    console.log('[ClaudeAgent] Configuration:', config);
                }

                // Execute the Claude Agent
                logger.log('Starting SDK query...');
                const sdkOptions: any = {
                    model,
                    systemPrompt: options.systemMessage,
                    maxTurns: options.maxTurns,
                    // Using bypassPermissions to allow automation without interaction
                    permissionMode: 'bypassPermissions',
                    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
                    // Always disable the default Bash and WebFetch tools.
                    // If nodes are connected, we've provided our own 'Bash' and 'WebFetch' tools above.
                    disallowedTools: disallowedTools,
                };

                // Add working directory if specified
                if (finalWorkingDirectory) {
                    sdkOptions.workingDirectory = finalWorkingDirectory;
                }

                const generator = query({
                    prompt: finalPrompt,
                    options: sdkOptions,
                });

                let finalResult: string | undefined;
                const logs: string[] = [];
                let messageCount = 0;

                logger.logSection('Processing SDK Messages');

                for await (const message of generator) {
                    messageCount++;
                    // Use logTurn to capture the message for markdown generation
                    logger.logTurn(message);

                    if (options.verbose) {
                        logs.push(JSON.stringify(message));
                    }

                    if (message.type === 'result') {
                        if (message.subtype === 'success') {
                            finalResult = message.result;
                        } else if (message.subtype === 'error_during_execution' || message.subtype === 'error_max_turns' || message.subtype === 'error_max_budget_usd' || message.subtype === 'error_max_structured_output_retries') {
                            throw new Error(`Claude Agent failed: ${message.subtype}. Errors: ${message.errors?.join(', ')}`);
                        }
                    }
                }

                logger.log(`Processed ${messageCount} messages total`);

                // Generate the markdown log file
                logger.finalize();

                if (finalResult === undefined) {
                    logger.logError('No result received', new Error('Agent finished without result'));
                    throw new Error('Claude Agent finished without a result.');
                }

                const jsonResult: { output: string; logs?: string[] } = {
                    output: finalResult,
                };

                if (options.verbose) {
                    jsonResult.logs = logs;
                }

                returnData.push({
                    json: jsonResult,
                    pairedItem: {
                        item: itemIndex,
                    },
                });

            } catch (error) {
                // Enhanced Error Logging
                logger.logError('Execution failed', error);

                const errorDetails = {
                    message: error.message,
                    stack: error.stack,
                    code: error.code,
                    context: error.context,
                    apiKeyPresent: !!process.env.ANTHROPIC_API_KEY,
                    baseUrl: process.env.ANTHROPIC_BASE_URL,
                    toolsCount,
                    logFile: logger.getLogPath(),
                };
                console.error('[ClaudeAgent] Execution Error:', JSON.stringify(errorDetails, null, 2));

                if (this.continueOnFail()) {
                    returnData.push({ json: { error: error.message, details: errorDetails }, error, pairedItem: itemIndex });
                } else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    // Include more details in the thrown error
                    const enhancedError = new Error(`Claude Agent failed: ${error.message}. Check n8n logs for details.`);
                    enhancedError.stack = error.stack;

                    throw new NodeOperationError(this.getNode(), enhancedError, {
                        itemIndex,
                    });
                }
            }
        }

        return [returnData];
    }
}
