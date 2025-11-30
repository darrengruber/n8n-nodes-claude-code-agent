import {
    IExecuteFunctions,
    INodeExecutionData,
    NodeConnectionTypes,
    ISupplyDataFunctions,
} from 'n8n-workflow';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { DebugLogger } from './utils/debugLogger';
import { BinaryArtifact } from './interfaces';
import { ClaudeAgentOptions, SdkConfiguration, ClaudeAgentResultData } from './interfaces';
import {
    getConnectedModel,
    setupSdkEnvironment,
    validatePrompt,
    processWorkingDirectory,
    buildSdkConfiguration,
    logConfiguration,
    throwEnhancedError,
    canContinueOnFail,
    processOutputParser,
} from './GenericFunctions';
import { buildPromptWithMemory, addOutputParserInstructions } from './utils';
import { processSdkMessages, saveMemoryContextSafe, formatOutputResult } from './utils/outputFormatter';

import { processConnectedTools } from './utils/toolProcessor';
import { cleanupBinaryInput } from './utils/binaryInputProcessor';
import { initializeDockerClient, removeVolume, getWorkspaceVolumeName } from '../RunContainer/ContainerHelpers';

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
        const logger = new DebugLogger(true); // Always enable for debugging

        console.log('[ClaudeAgent] Logger created, log path:', logger.getLogPath());
        logger.logSection(`Processing Item ${itemIndex}`);

        let binaryInputResult: any = undefined; // Declare outside try block

        try {
            // Get and validate basic parameters
            const prompt = this.getNodeParameter('text', itemIndex, '') as string;
            const options = this.getNodeParameter('options', itemIndex, {}) as ClaudeAgentOptions;

            validatePrompt(prompt, this.getNode());

            // Get and validate connected model
            const { model, apiKey, baseURL } = await getConnectedModel(this, itemIndex);

            // Set up SDK environment
            setupSdkEnvironment(apiKey, baseURL);

            logger.log('Retrieved model from Chat Model input', {
                model,
                hasApiKey: !!apiKey,
                hasBaseURL: !!baseURL,
                baseURL: baseURL || 'default',
            });

            logger.log('Retrieved parameters', {
                promptLength: prompt.length,
                promptPreview: prompt.length > 0 ? prompt.substring(0, 100) + '...' : '[EMPTY]',
                model,
                options
            });

            // Build prompt with memory context
            let finalPrompt = await buildPromptWithMemory.call(this, itemIndex, prompt, logger);

            // Handle output parser
            let outputParser: any;
            try {
                outputParser = (await this.getInputConnectionData(NodeConnectionTypes.AiOutputParser, itemIndex)) as any;
            } catch (error) {
                // Ignore if not connected
            }

            finalPrompt = addOutputParserInstructions(finalPrompt, outputParser, logger);

            // Initialize array to collect binary artifacts from tools
            const binaryArtifacts: BinaryArtifact[] = [];

            // Process connected tools with binary input processing
            const { mcpServers, disallowedTools, toolsCount, binaryInputResult: processedBinaryResult } = await processConnectedTools(
                this, itemIndex, !!options.verbose, logger, binaryArtifacts, options
            );
            
            binaryInputResult = processedBinaryResult; // Assign to outer scope variable

            // Process working directory
            const finalWorkingDirectory = processWorkingDirectory(options.workingDirectory);

            // Log configuration before execution
            logger.logSection('SDK Query Configuration');
            const config: SdkConfiguration = {
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
            logConfiguration(logger, config, !!options.verbose);

            // Build SDK configuration and execute
            logger.log('Starting SDK query...');
            const sdkConfiguration = buildSdkConfiguration(
                model, options, mcpServers, disallowedTools, finalWorkingDirectory
            );

            const generator = query({
                prompt: finalPrompt,
                options: sdkConfiguration,
            });

            // Process SDK messages
            const { result: finalResult, logs, messageCount } = await processSdkMessages(
                generator, !!options.verbose, logger
            );

            logger.log(`Processed ${messageCount} messages total`);

            // Generate the markdown log file
            logger.finalize();

            // Process output with parser if available
            let output = await processOutputParser(this, itemIndex, finalResult, logger);

            // Save context to memory if available
            await saveMemoryContextSafe(this, itemIndex, prompt, finalResult, logger);

            // Format final result
            const jsonResult = formatOutputResult(output, !!options.verbose, logs);

            // Cleanup workspace volume (session-based)
            try {
                const volumeName = getWorkspaceVolumeName(this);
                const docker = initializeDockerClient();
                await removeVolume(docker, volumeName);
                logger.log(`Cleaned up workspace volume: ${volumeName}`);
            } catch (cleanupError) {
                logger.logError('Failed to cleanup workspace volume', cleanupError);
            }

            // Cleanup binary input temporary directory
            try {
                await cleanupBinaryInput(binaryInputResult?.tempDirectory);
                if (binaryInputResult?.tempDirectory) {
                    logger.log(`Cleaned up binary input temp directory: ${binaryInputResult.tempDirectory}`);
                }
            } catch (cleanupError) {
                logger.logError('Failed to cleanup binary input temp directory', cleanupError);
            }

            const executionData: INodeExecutionData = {
                json: jsonResult as ClaudeAgentResultData,
                pairedItem: {
                    item: itemIndex,
                },
            };

            // Merge collected binary artifacts into execution data
            if (binaryArtifacts.length > 0) {
                logger.log(`Merging ${binaryArtifacts.length} binary artifacts into output`);
                console.log(`[ClaudeAgent] Merging ${binaryArtifacts.length} binary artifacts:`, binaryArtifacts.map(a => ({ fileName: a.fileName, mimeType: a.mimeType, size: a.data?.length })));
                executionData.binary = {};

                for (const artifact of binaryArtifacts) {
                    // Ensure unique key if multiple files have same name
                    let key = artifact.fileName;
                    let counter = 1;
                    while (executionData.binary[key]) {
                        key = `${artifact.fileName}_${counter++}`;
                    }

                    console.log(`[ClaudeAgent] Adding binary artifact: ${key} (${artifact.mimeType}, ${artifact.data?.length} bytes)`);
                    executionData.binary[key] = {
                        data: artifact.data,
                        mimeType: artifact.mimeType,
                        fileName: artifact.fileName,
                        fileSize: String(artifact.data.length), // Convert to string as per IBinaryData interface
                    };
                }
            } else {
                logger.log('No binary artifacts to merge');
                console.log('[ClaudeAgent] No binary artifacts collected during execution');
            }

            returnData.push(executionData);

        } catch (error) {
            logger.logError('Execution failed', error);

            // Cleanup binary input temporary directory even on error
            try {
                await cleanupBinaryInput(binaryInputResult?.tempDirectory);
                if (binaryInputResult?.tempDirectory) {
                    logger.log(`Cleaned up binary input temp directory on error: ${binaryInputResult.tempDirectory}`);
                }
            } catch (cleanupError) {
                logger.logError('Failed to cleanup binary input temp directory on error', cleanupError);
            }

            if (canContinueOnFail(this) && this.continueOnFail()) {
                returnData.push({
                    json: {
                        error: error.message,
                        details: createEnhancedError(error, itemIndex, 0, logger)
                    },
                    error,
                    pairedItem: itemIndex
                });
            } else {
                throwEnhancedError(error, this.getNode(), itemIndex, 0, logger);
            }
        }
    }

    return [returnData];
}

// Helper function for continueOnFail case
function createEnhancedError(
    error: Error,
    itemIndex: number,
    toolsCount: number,
    logger: DebugLogger
) {
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

