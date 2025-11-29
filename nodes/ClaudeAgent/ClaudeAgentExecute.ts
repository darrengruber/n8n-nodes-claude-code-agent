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
import { getMemoryMessages, formatMemoryMessages, saveMemoryContext } from './ClaudeMemory';
async function buildPromptWithMemory(
    this: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    prompt: string,
    logger: DebugLogger,
): Promise<string> {
    const messages = await getMemoryMessages(this, itemIndex, logger);

    if (!messages) {
        return prompt;
    }

    if (typeof messages === 'string') {
        logger.log('Injecting string chat history into prompt');
        return `Here is the conversation history:\n${messages}\n\nCurrent request:\n${prompt}`;
    }

    if (Array.isArray(messages) && messages.length > 0) {
        // Log the first message structure for debugging
        logger.log('First memory message structure', {
            keys: Object.keys(messages[0]),
            sample: messages[0]
        });

        const history = formatMemoryMessages(messages);
        if (history) {
            logger.log('Injecting structured chat history into prompt', {
                length: history.length,
                preview: history.substring(0, 2000) + '...'
            });
            return `Here is the conversation history:\n${history}\n\nCurrent request:\n${prompt}`;
        } else {
            logger.log('Formatted history was empty');
        }
    } else {
        logger.log('Messages array was empty or invalid');
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
            let finalPrompt = await buildPromptWithMemory.call(this, itemIndex, prompt, logger);

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
            let allowedTools: string[] = [];

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
                allowedTools = result.allowedTools;

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
                allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
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

            // Save context to memory if available
            await saveMemoryContext(this, itemIndex, prompt, finalResult, logger);

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

