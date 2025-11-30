import {
    IExecuteFunctions,
    ISupplyDataFunctions,
    NodeConnectionTypes,
} from 'n8n-workflow';
import { DebugLogger } from './debugLogger';
import { BinaryArtifact } from '../interfaces';
import { processToolsForAgent } from './mcpAdapter';
import { ToolProcessingResult, ClaudeAgentOptions } from '../interfaces';
import { processBinaryInput, cleanupBinaryInput } from './binaryInputProcessor';

/**
 * Processes tools connected to the node
 */
export async function processConnectedTools(
    context: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    verbose: boolean,
    logger: DebugLogger,
    binaryArtifacts?: BinaryArtifact[],
    options?: ClaudeAgentOptions
): Promise<ToolProcessingResult & { toolsCount: number; binaryInputResult?: any }> {
    logger.logSection('Tool Processing');
    let mcpServers: Record<string, any> = {};
    let disallowedTools: string[] = ['Bash', 'WebFetch']; // Default disallowed
    let toolsCount = 0;
    let binaryInputResult: any = undefined;

    try {
        const rawTools = (await context.getInputConnectionData(NodeConnectionTypes.AiTool, itemIndex)) as any[];

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

        // Process binary input data if options are provided
        if (options) {
            binaryInputResult = await processBinaryInput(context, itemIndex, options, logger);
        }

        // Enrich tools with current item's binary data for dynamic descriptions
        const currentItem = context.getInputData()[itemIndex];
        if (currentItem) {
            tools.forEach(tool => {
                if (!tool.metadata) {
                    tool.metadata = {};
                }
                tool.metadata.currentItem = currentItem;
                
                // Add binary input metadata to tool
                if (binaryInputResult) {
                    tool.metadata.binaryInput = binaryInputResult;
                }

                // For RunContainer tools, try to get the workspaceInstructions parameter
                // This is a bit tricky since we don't have direct access to the tool node's parameters
                // The tool object might have a reference to its configuration
                // For now, we'll rely on the fallback in mcpAdapter
            });

            logger.log('Enriched tools with current item data', {
                hasBinaryData: !!currentItem.binary,
                binaryKeys: currentItem.binary ? Object.keys(currentItem.binary) : [],
                binaryInputProcessed: !!binaryInputResult,
                binaryInputFiles: binaryInputResult?.metadata?.length || 0
            });
        }

        const result = await processToolsForAgent(tools, { verbose }, logger, binaryArtifacts);
        mcpServers = result.mcpServers;
        disallowedTools = result.disallowedTools;

        // Count total tools across all servers
        toolsCount = tools.length;

        logger.log('Tool processing completed', {
            toolsCount,
            mcpServerCount: Object.keys(mcpServers).length,
            disallowedToolsCount: disallowedTools.length
        });

    } catch (error) {
        console.warn('Failed to process tools:', error);
        logger.logError('Tool processing failed', error);
    }

    return {
        mcpServers,
        disallowedTools,
        toolsCount,
        binaryInputResult
    };
}

/**
 * Logs tool processing results
 */
export function logToolResults(
    logger: DebugLogger,
    result: { mcpServers: Record<string, any>; disallowedTools: string[]; toolsCount: number }
): void {
    logger.log('Tools processed', {
        totalTools: result.toolsCount,
        mcpServers: Object.keys(result.mcpServers).length,
        mcpServerNames: Object.keys(result.mcpServers),
        disallowedTools: result.disallowedTools
    });
}

/**
 * Cleanup binary input resources
 */
export async function cleanupToolProcessing(binaryInputResult: any): Promise<void> {
    if (binaryInputResult?.tempDirectory) {
        await cleanupBinaryInput(binaryInputResult.tempDirectory);
    }
}