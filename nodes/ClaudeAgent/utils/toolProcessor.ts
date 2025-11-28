import {
    IExecuteFunctions,
    ISupplyDataFunctions,
    NodeConnectionTypes,
} from 'n8n-workflow';
import { DebugLogger } from './debugLogger';
import { processToolsForAgent } from './mcpAdapter';
import { ToolProcessingResult } from '../interfaces';

/**
 * Processes tools connected to the node
 */
export async function processConnectedTools(
    context: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    verbose: boolean,
    logger: DebugLogger
): Promise<ToolProcessingResult & { toolsCount: number }> {
    logger.logSection('Tool Processing');
    let mcpServers: Record<string, any> = {};
    let disallowedTools: string[] = ['Bash', 'WebFetch']; // Default disallowed
    let toolsCount = 0;

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

        const result = await processToolsForAgent(tools, { verbose }, logger);
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
        toolsCount
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