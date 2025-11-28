import { IExecuteFunctions, ISupplyDataFunctions } from 'n8n-workflow';
import { DebugLogger } from './debugLogger';
import { ClaudeAgentResult } from '../interfaces';

/**
 * Formats the final result for output
 */
export function formatOutputResult(
    output: any,
    verbose: boolean,
    logs?: string[]
): ClaudeAgentResult {
    const result: ClaudeAgentResult = {
        output: output,
    };

    if (verbose && logs) {
        result.logs = logs;
    }

    return result;
}

/**
 * Processes SDK messages and extracts the final result
 */
export async function processSdkMessages(
    generator: AsyncIterable<any>,
    verbose: boolean,
    logger: DebugLogger
): Promise<{ result: string; logs: string[]; messageCount: number }> {
    let finalResult: string | undefined;
    const logs: string[] = [];
    let messageCount = 0;

    logger.logSection('Processing SDK Messages');

    for await (const message of generator) {
        messageCount++;
        // Use logTurn to capture the message for markdown generation
        logger.logTurn(message);

        if (verbose) {
            logs.push(JSON.stringify(message));
        }

        if (message.type === 'result') {
            if (message.subtype === 'success') {
                finalResult = message.result;
            } else if (
                message.subtype === 'error_during_execution' ||
                message.subtype === 'error_max_turns' ||
                message.subtype === 'error_max_budget_usd' ||
                message.subtype === 'error_max_structured_output_retries'
            ) {
                throw new Error(`Claude Agent failed: ${message.subtype}. Errors: ${message.errors?.join(', ')}`);
            }
        }
    }

    logger.log(`Processed ${messageCount} messages total`);

    if (finalResult === undefined) {
        logger.logError('No result received', new Error('Agent finished without result'));
        throw new Error('Claude Agent finished without a result.');
    }

    return {
        result: finalResult,
        logs,
        messageCount
    };
}

/**
 * Saves context to memory if available (with error handling)
 */
export async function saveMemoryContextSafe(
    context: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    prompt: string,
    result: string,
    logger: DebugLogger
): Promise<void> {
    try {
        const { saveMemoryContext } = await import('./memoryProcessor');
        await saveMemoryContext(context, itemIndex, prompt, result, logger);
        logger.log('Memory context saved successfully');
    } catch (error) {
        logger.logError('Failed to save memory context', error);
        // Don't throw error for memory saving failures
    }
}