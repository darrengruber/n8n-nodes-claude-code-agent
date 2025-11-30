import {
    IExecuteFunctions,
    ISupplyDataFunctions,
    NodeConnectionTypes,
    NodeOperationError,
} from 'n8n-workflow';
import { ClaudeAgentConfiguration, ClaudeAgentOptions, SdkConfiguration, ExecutionErrorDetails } from './interfaces';
import { DebugLogger } from './utils/debugLogger';

/**
 * Validates that the connected model is an Anthropic Chat Model
 */
export function validateAnthropicModel(connectedModel: any, node: any): { model: string; apiKey: string; baseURL?: string } {
    // Validate that it's an Anthropic model by checking the class type
    const isAnthropic = connectedModel.constructor?.name === 'ChatAnthropic' ||
        connectedModel._llmType?.() === 'anthropic';

    if (!isAnthropic) {
        throw new NodeOperationError(
            node,
            'Only Anthropic Chat Models are supported. Please connect an Anthropic Chat Model node.'
        );
    }

    // Extract configuration from the connected ChatAnthropic instance
    const model = connectedModel.model;
    const apiKey = connectedModel.anthropicApiKey;
    const baseURL = connectedModel.apiUrl;

    return { model, apiKey, baseURL };
}

/**
 * Sets up environment variables for the Claude SDK
 */
export function setupSdkEnvironment(apiKey?: string, baseURL?: string): void {
    if (apiKey) {
        process.env.ANTHROPIC_API_KEY = apiKey;
    }
    if (baseURL) {
        process.env.ANTHROPIC_BASE_URL = baseURL;
    }
}

/**
 * Validates the user prompt is not empty
 */
export function validatePrompt(prompt: string, node: any): void {
    if (!prompt || prompt.trim().length === 0) {
        throw new NodeOperationError(
            node,
            'The "Text" parameter is required and cannot be empty. Please provide a prompt for the agent.'
        );
    }
}

/**
 * Processes and validates the working directory
 */
export function processWorkingDirectory(workingDirectory?: string): string | undefined {
    if (!workingDirectory || !workingDirectory.trim()) {
        return undefined;
    }

    const cleanedDirectory = workingDirectory.trim();

    // Basic validation - it should be an absolute path
    if (!cleanedDirectory.startsWith('/')) {
        console.warn('[ClaudeAgent] Working directory should be an absolute path for best results');
    }

    return cleanedDirectory;
}

/**
 * Builds the SDK configuration object
 */
export function buildSdkConfiguration(
    model: string,
    options: ClaudeAgentOptions,
    mcpServers: Record<string, any>,
    disallowedTools: string[],
    workingDirectory?: string
): ClaudeAgentConfiguration {
    const config: ClaudeAgentConfiguration = {
        model,
        systemPrompt: options.systemMessage,
        maxTurns: options.maxTurns,
        permissionMode: 'bypassPermissions',
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
        disallowedTools,
    };

    if (workingDirectory) {
        config.workingDirectory = workingDirectory;
    }

    return config;
}

/**
 * Logs the configuration before execution
 */
export function logConfiguration(
    logger: DebugLogger,
    config: SdkConfiguration,
    verbose: boolean
): void {
    logger.log('Configuration', config);

    if (verbose) {
        console.log('[ClaudeAgent] Configuration:', config);
    }
}

/**
 * Creates an enhanced error object with context details
 */
export function createEnhancedError(
    error: Error,
    itemIndex: number,
    toolsCount: number,
    logger: DebugLogger
): ExecutionErrorDetails {
    return {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
        context: (error as any).context,
        apiKeyPresent: !!process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        toolsCount,
        logFile: logger.getLogPath(),
    };
}

/**
 * Formats and throws an enhanced error
 */
export function throwEnhancedError(
    error: Error,
    node: any,
    itemIndex: number,
    toolsCount: number,
    logger: DebugLogger
): never {
    const errorDetails = createEnhancedError(error, itemIndex, toolsCount, logger);
    console.error('[ClaudeAgent] Execution Error:', JSON.stringify(errorDetails, null, 2));

    const enhancedError = new Error(`Claude Agent failed: ${error.message}. Check n8n logs for details.`);
    enhancedError.stack = error.stack;

    const errorWithContext = error as any;
    if (errorWithContext.context) {
        errorWithContext.context.itemIndex = itemIndex;
        throw error;
    }

    throw new NodeOperationError(node, enhancedError, {
        itemIndex,
    });
}

/**
 * Checks if the context supports continueOnFail (IExecuteFunctions)
 */
export function canContinueOnFail(context: IExecuteFunctions | ISupplyDataFunctions): context is IExecuteFunctions {
    return 'continueOnFail' in context;
}

/**
 * Processes output parser if connected
 */
export async function processOutputParser(
    context: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    result: string,
    logger: DebugLogger
): Promise<any> {
    let outputParser: any;
    try {
        outputParser = (await context.getInputConnectionData(NodeConnectionTypes.AiOutputParser, itemIndex)) as any;
    } catch (error) {
        // Ignore if not connected
    }

    if (outputParser) {
        try {
            logger.log('Parsing output with connected parser');
            const parsed = await outputParser.parse(result);
            logger.log('Output parsed successfully');
            return parsed;
        } catch (error) {
            logger.logError('Output parsing failed', error);
            throw new NodeOperationError(
                context.getNode(),
                `Output parsing failed: ${error.message}`
            );
        }
    }

    return result;
}

/**
 * Gets the connected AI language model with validation
 */
export async function getConnectedModel(
    context: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number
): Promise<{ model: string; apiKey: string; baseURL?: string }> {
    // Retrieve the model from the AI Language Model input
    const connectedModel = (await context.getInputConnectionData(
        NodeConnectionTypes.AiLanguageModel,
        itemIndex
    )) as any;

    if (!connectedModel) {
        throw new NodeOperationError(
            context.getNode(),
            'Please connect an Anthropic Chat Model to the Chat Model input'
        );
    }

    return validateAnthropicModel(connectedModel, context.getNode());
}