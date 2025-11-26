import {
    IExecuteFunctions,
    INodeExecutionData,
    NodeConnectionTypes,
    NodeOperationError,
    ISupplyDataFunctions,
} from 'n8n-workflow';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { processToolsForAgent } from './McpToolAdapter';
import { DebugLogger } from './DebugLogger';

function normalizeMessageContent(content: any): string {
    if (content === undefined || content === null) return '';

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (typeof part === 'object' && part !== null) {
                    if (typeof part.text === 'string') return part.text;
                    if (typeof part.content === 'string') return part.content;
                }
                return JSON.stringify(part);
            })
            .filter(Boolean)
            .join(' ');
    }

    if (typeof content === 'object') {
        if (typeof (content as any).text === 'string') return (content as any).text;
        if (typeof (content as any).content === 'string') return (content as any).content;
    }

    return String(content);
}

function formatMemoryMessages(messages: any[]): string {
    // Claude's SDK only accepts a single prompt string; it does not have a native
    // structured "messages" parameter. We therefore flatten LangChain/n8n memory
    // messages into the User/Assistant/System/Tool format Claude expects.
    const roleMap: Record<string, string> = {
        human: 'User',
        user: 'User',
        ai: 'Assistant',
        assistant: 'Assistant',
        system: 'System',
        tool: 'Tool',
        function: 'Tool',
        function_call: 'Tool',
        generic: 'User',
    };

    return messages
        .map((message: any) => {
            // n8n memory nodes expose LangChain BaseMessage objects which use
            // _getType(), while some integrations provide a "role" or "type" key.
            const type =
                typeof message._getType === 'function'
                    ? message._getType()
                    : message.type || message.role || 'user';

            const role = roleMap[type?.toLowerCase?.() ?? 'user'] || 'User';
            const content = normalizeMessageContent(message.content ?? message.text ?? '');

            // Preserve tool/function names when available so Claude can follow
            // the same interface expectations as the LangChain Agent executor.
            const name = (message.name || message.tool || message.function_call)?.toString?.();
            const prefix = name && role === 'Tool' ? `${role} (${name})` : role;

            return `${prefix}: ${content}`;
        })
        .join('\n');
}

async function buildPromptWithMemory(
    this: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    prompt: string,
    logger: DebugLogger,
): Promise<string> {
    try {
        const memory = (await this.getInputConnectionData(NodeConnectionTypes.AiMemory, itemIndex)) as any;
        if (!memory) return prompt;

        let messages: any[] | string | undefined;

        if (typeof memory.getMessages === 'function') {
            messages = await memory.getMessages();
            logger.log('Retrieved messages via getMessages from memory node', {
                messageCount: Array.isArray(messages) ? messages.length : undefined,
            });
        }

        if (messages === undefined && typeof memory.loadMemoryVariables === 'function') {
            const memoryVariables = await memory.loadMemoryVariables({});
            messages =
                memoryVariables?.chat_history ??
                memoryVariables?.history ??
                memoryVariables?.messages ??
                memoryVariables?.buffer;
            logger.log('Retrieved messages via loadMemoryVariables from memory node', {
                keys: memoryVariables ? Object.keys(memoryVariables) : [],
                messageCount: Array.isArray(messages) ? messages.length : undefined,
            });
        }

        if (!messages) return prompt;

        if (typeof messages === 'string') {
            logger.log('Injecting string chat history into prompt');
            return `Here is the conversation history:\n${messages}\n\nCurrent request:\n${prompt}`;
        }

        if (Array.isArray(messages) && messages.length > 0) {
            const history = formatMemoryMessages(messages);
            if (history) {
                logger.log('Injecting structured chat history into prompt', {
                    roles: Array.from(
                        new Set(
                            messages.map((m) =>
                                typeof m._getType === 'function'
                                    ? m._getType()
                                    : m.type || m.role || 'user',
                            ),
                        ),
                    ),
                });
                return `Here is the conversation history:\n${history}\n\nCurrent request:\n${prompt}`;
            }
        }
    } catch (error) {
        console.warn('Failed to retrieve or process memory:', error);
        logger.logError('Failed to process memory', error as Error);
    }

    return prompt;
}

/**
 * Shared execute function for both ClaudeAgent and ClaudeAgentTool
 * Accepts both IExecuteFunctions and ISupplyDataFunctions contexts
 */
export async function claudeAgentExecute(
    this: IExecuteFunctions | ISupplyDataFunctions,
): Promise<INodeExecutionData[][]> {
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
            const isAnthropic = connectedModel.constructor?.name === 'ChatAnthropic' ||
                connectedModel._llmType?.() === 'anthropic';

            if (!isAnthropic) {
                throw new NodeOperationError(
                    this.getNode(),
                    'Only Anthropic Chat Models are supported. Please connect an Anthropic Chat Model node.'
                );
            }

            // Extract configuration from the connected ChatAnthropic instance
            const model = connectedModel.model;
            const apiKey = connectedModel.anthropicApiKey;
            const baseURL = connectedModel.apiUrl;

            // Set environment variables for the SDK
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
            const finalPrompt = await buildPromptWithMemory.call(this, itemIndex, prompt, logger);

            // Handle Output Parser
            let outputParser: any;
            try {
                outputParser = (await this.getInputConnectionData(NodeConnectionTypes.AiOutputParser, itemIndex)) as any;
            } catch (error) {
                // Ignore if not connected
            }

            if (outputParser) {
                const formatInstructions = outputParser.getFormatInstructions();
                if (formatInstructions) {
                    finalPrompt += `\n\n${formatInstructions}`;
                    logger.log('Added output parser instructions to prompt');
                }
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
                try {
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
                permissionMode: 'bypassPermissions',
                mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
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

            let output: any = finalResult;
            if (outputParser) {
                try {
                    logger.log('Parsing output with connected parser');
                    output = await outputParser.parse(finalResult);
                    logger.log('Output parsed successfully');
                } catch (error) {
                    logger.logError('Output parsing failed', error);
                    throw new NodeOperationError(this.getNode(), `Output parsing failed: ${error.message}`);
                }
            }

            const jsonResult: { output: any; logs?: string[] } = {
                output: output,
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

            // Check if continueOnFail is available (it's on IExecuteFunctions, not ISupplyDataFunctions)
            if ('continueOnFail' in this && this.continueOnFail()) {
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

