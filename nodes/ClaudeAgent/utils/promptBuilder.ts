import {
    IExecuteFunctions,
    ISupplyDataFunctions,
} from 'n8n-workflow';
import { DebugLogger } from './debugLogger';
import { getMemoryMessages, formatMemoryMessages } from './memoryProcessor';

/**
 * Builds the prompt with memory context if available
 */
export async function buildPromptWithMemory(
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
 * Adds output parser instructions to the prompt if available
 */
export function addOutputParserInstructions(
    prompt: string,
    outputParser: any,
    logger: DebugLogger
): string {
    if (outputParser) {
        const formatInstructions = outputParser.getFormatInstructions();
        if (formatInstructions) {
            const finalPrompt = prompt + `\n\n${formatInstructions}`;
            logger.log('Added output parser instructions to prompt');
            return finalPrompt;
        }
    }
    return prompt;
}