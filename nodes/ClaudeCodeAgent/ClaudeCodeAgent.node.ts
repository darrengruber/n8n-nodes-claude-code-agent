import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionTypes,
    ILoadOptionsFunctions,
    INodePropertyOptions,
    NodeOperationError,
} from 'n8n-workflow';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { adaptToMcpTools } from './McpToolAdapter';
import { DebugLogger } from './DebugLogger';

export class ClaudeCodeAgent implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Claude Code Agent',
        name: 'claudeCodeAgent',
        icon: 'file:claudeCodeAgent.svg',
        group: ['transform'],
        version: 1,
        description: 'Use the Claude Code SDK to run an AI agent',
        defaults: {
            name: 'Claude Code Agent',
        },
        inputs: [
            {
                displayName: '',
                type: NodeConnectionTypes.Main,
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
        credentials: [
            {
                name: 'anthropicApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Text',
                name: 'text',
                type: 'string',
                default: '',
                placeholder: 'What would you like the agent to do?',
                description: 'The instruction for the agent',
                typeOptions: {
                    rows: 4,
                },
            },
            {
                displayName: 'Model',
                name: 'model',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getModels',
                },
                default: 'claude-3-5-sonnet-20241022',
                description: 'The model to use',
                options: [],
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

    methods = {
        loadOptions: {
            async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
                const credentials = await this.getCredentials('anthropicApi');
                const apiKey = credentials.apiKey as string;
                const baseUrl = (credentials.baseUrl as string) || (credentials.url as string) || 'https://api.anthropic.com';

                try {
                    const response = await this.helpers.request({
                        method: 'GET',
                        url: `${baseUrl}/v1/models`,
                        headers: {
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01',
                        },
                        json: true,
                    });

                    return (response.data as Array<{ id: string; display_name?: string }>).map((model) => ({
                        name: model.display_name || model.id,
                        value: model.id,
                    }));
                } catch (error) {
                    // Fallback to default models if API call fails
                    return [
                        { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                        { name: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
                        { name: 'Claude 3 Haiku', value: 'claude-3-haiku-20240307' },
                    ];
                }
            },
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        // Retrieve credentials
        const credentials = await this.getCredentials('anthropicApi');

        if (credentials?.apiKey) {
            process.env.ANTHROPIC_API_KEY = credentials.apiKey as string;
        }

        if (credentials?.baseUrl) {
            process.env.ANTHROPIC_BASE_URL = credentials.baseUrl as string;
        } else if (credentials?.url) {
            // Fallback if credential uses 'url' instead of 'baseUrl'
            process.env.ANTHROPIC_BASE_URL = credentials.url as string;
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            throw new NodeOperationError(this.getNode(), 'Anthropic API Key is missing. Please check your credentials.');
        }

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            let toolsCount = 0;
            const logger = new DebugLogger(true); // Always enable for debugging

            console.log('[ClaudeCodeAgent] Logger created, log path:', logger.getLogPath());
            logger.logSection(`Processing Item ${itemIndex}`);

            try {
                const prompt = this.getNodeParameter('text', itemIndex, '') as string;
                const model = this.getNodeParameter('model', itemIndex, 'claude-3-5-sonnet-20241022') as string;
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
                const mcpServers: Record<string, any> = {};

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

                    if (tools && tools.length > 0) {
                        toolsCount = tools.length;
                        logger.log(`Found ${toolsCount} tools`, tools.map((t: any) => ({
                            name: t.name,
                            description: t.description,
                            source: t.metadata?.sourceNodeName
                        })));

                        // Group tools by source node to create distinct MCP servers
                        const toolsBySource: Record<string, any[]> = {};

                        for (const tool of tools) {
                            // Use sourceNodeName as the grouping key, fallback to 'n8n-tools'
                            // For MCP Client tools, this will group them by the client node name
                            const sourceName = tool.metadata?.sourceNodeName || 'n8n-tools';
                            if (!toolsBySource[sourceName]) {
                                toolsBySource[sourceName] = [];
                            }
                            toolsBySource[sourceName].push(tool);
                        }

                        logger.log('Grouped tools by source:', Object.keys(toolsBySource));

                        // Create an MCP server for each group
                        for (const [sourceName, sourceTools] of Object.entries(toolsBySource)) {
                            const sdkTools = await adaptToMcpTools(sourceTools, options.verbose, logger);

                            // Sanitize server name (alphanumeric and underscores only)
                            // e.g. "My MCP Client" -> "My_MCP_Client"
                            const serverName = sourceName.replace(/[^a-zA-Z0-9_]/g, '_');

                            logger.log(`Creating MCP server '${serverName}' with ${sdkTools.length} tools`);

                            mcpServers[serverName] = createSdkMcpServer({
                                name: serverName,
                                tools: sdkTools,
                            });
                        }

                        logger.log('MCP servers created successfully');
                    } else {
                        logger.log('No tools connected');
                    }
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
                    console.log('[ClaudeCodeAgent] Configuration:', config);
                }

                // Execute the Claude Code Agent
                logger.log('Starting SDK query...');
                const sdkOptions: any = {
                    model,
                    systemPrompt: options.systemMessage,
                    maxTurns: options.maxTurns,
                    // Using bypassPermissions to allow automation without interaction
                    permissionMode: 'bypassPermissions',
                    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
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
                    logger.log(`Message ${messageCount}:`, message);

                    if (options.verbose) {
                        logs.push(JSON.stringify(message));
                    }

                    if (message.type === 'result') {
                        if (message.subtype === 'success') {
                            finalResult = message.result;
                        } else if (message.subtype === 'error_during_execution' || message.subtype === 'error_max_turns' || message.subtype === 'error_max_budget_usd' || message.subtype === 'error_max_structured_output_retries') {
                            throw new Error(`Claude Code Agent failed: ${message.subtype}. Errors: ${message.errors?.join(', ')}`);
                        }
                    }
                }

                logger.log(`Processed ${messageCount} messages total`);

                if (finalResult === undefined) {
                    logger.logError('No result received', new Error('Agent finished without result'));
                    throw new Error('Claude Code Agent finished without a result.');
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
                console.error('[ClaudeCodeAgent] Execution Error:', JSON.stringify(errorDetails, null, 2));

                if (this.continueOnFail()) {
                    returnData.push({ json: { error: error.message, details: errorDetails }, error, pairedItem: itemIndex });
                } else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    // Include more details in the thrown error
                    const enhancedError = new Error(`Claude Code Agent failed: ${error.message}. Check n8n logs for details.`);
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
