import { IExecuteFunctions, ISupplyDataFunctions, NodeConnectionTypes } from 'n8n-workflow';
import { DebugLogger } from './debugLogger';

export async function getMemoryMessages(
    execution: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    logger: DebugLogger,
): Promise<any[] | string | undefined> {
    try {
        let memory = (await execution.getInputConnectionData(NodeConnectionTypes.AiMemory, itemIndex)) as any;

        // Detailed memory debugging
        if (memory) {
            logger.log('Memory Input Analysis', {
                type: typeof memory,
                isArray: Array.isArray(memory),
                length: Array.isArray(memory) ? memory.length : 'N/A',
                keys: typeof memory === 'object' ? Object.keys(memory) : [],
                hasGetMessages: typeof memory.getMessages === 'function',
                hasLoadMemoryVariables: typeof memory.loadMemoryVariables === 'function',
                firstItemKeys: Array.isArray(memory) && memory.length > 0 ? Object.keys(memory[0]) : 'N/A',
                firstItemHasGetMessages: Array.isArray(memory) && memory.length > 0 ? typeof memory[0].getMessages === 'function' : 'N/A',
            });
        } else {
            logger.log('No memory input detected');
            return undefined;
        }

        // Unwrap array if it contains a single memory object (common in n8n execution data)
        if (Array.isArray(memory) && memory.length === 1 && (typeof memory[0].getMessages === 'function' || typeof memory[0].loadMemoryVariables === 'function')) {
            logger.log('Unwrapping memory object from array');
            memory = memory[0];
        }

        let messages: any[] | string | undefined;

        // Case 1: Standard LangChain Memory (getMessages)
        if (typeof memory.getMessages === 'function') {
            messages = await memory.getMessages();
            logger.log('Retrieved messages via getMessages', {
                count: Array.isArray(messages) ? messages.length : 'not-array'
            });
        }

        // Case 2: Memory Variables (loadMemoryVariables)
        if (messages === undefined && typeof memory.loadMemoryVariables === 'function') {
            const memoryVariables = await memory.loadMemoryVariables({});
            messages =
                memoryVariables?.chat_history ??
                memoryVariables?.history ??
                memoryVariables?.messages ??
                memoryVariables?.buffer;

            logger.log('Retrieved messages via loadMemoryVariables', {
                found: !!messages,
                keys: memoryVariables ? Object.keys(memoryVariables) : [],
                count: Array.isArray(messages) ? messages.length : 'not-array'
            });
        }

        // Case 3: Direct Array (Simple Memory)
        if (messages === undefined && Array.isArray(memory)) {
            messages = memory;
            logger.log('Using memory directly as array', {
                count: memory.length
            });
        }

        // Case 4: Object with messages property
        if (messages === undefined && memory.messages && Array.isArray(memory.messages)) {
            messages = memory.messages;
            logger.log('Using memory.messages property', {
                count: memory.messages.length
            });
        }

        if (!messages) {
            logger.log('No messages found in memory object');
            return undefined;
        }

        return messages;

    } catch (error) {
        console.warn('Failed to retrieve or process memory:', error);
        logger.logError('Failed to process memory', error as Error);
        return undefined;
    }
}

export function formatMemoryMessages(messages: any[]): string {
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
                    : message.type || message.role || message.json?.role || message.json?.type || 'user';

            const role = roleMap[type?.toLowerCase?.() ?? 'user'] || 'User';

            // Robust content extraction
            const rawContent =
                message.content ??
                message.text ??
                message.json?.content ??
                message.json?.text ??
                '';

            const content = normalizeMessageContent(rawContent);

            // Preserve tool/function names when available so Claude can follow
            // the same interface expectations as the LangChain Agent executor.
            const name = (message.name || message.tool || message.function_call || message.json?.name)?.toString?.();
            const prefix = name && role === 'Tool' ? `${role} (${name})` : role;

            return `${prefix}: ${content}`;
        })
        .join('\n');
}

function normalizeMessageContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((c) => {
                if (typeof c === 'string') return c;
                if (c?.text) return c.text;
                return JSON.stringify(c);
            })
            .join('\n');
    }
    return JSON.stringify(content);
}

export async function saveMemoryContext(
    execution: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    prompt: string,
    result: string,
    logger: DebugLogger,
): Promise<void> {
    try {
        let memory = (await execution.getInputConnectionData(NodeConnectionTypes.AiMemory, itemIndex)) as any;

        if (memory) {
            // Unwrap array if it contains a single memory object
            if (Array.isArray(memory) && memory.length === 1 && (typeof memory[0].saveContext === 'function' || typeof memory[0].addMessage === 'function')) {
                memory = memory[0];
            }

            if (typeof memory.saveContext === 'function') {
                logger.log('Saving context to memory via saveContext');
                await memory.saveContext(
                    { input: prompt },
                    { output: result }
                );
            } else if (typeof memory.addMessage === 'function') {
                logger.log('Saving context to memory via addMessage');
                // Some simple memories just take a message object
                await memory.addMessage({ role: 'user', content: prompt });
                await memory.addMessage({ role: 'assistant', content: result });
            } else {
                logger.log('Memory object detected but no save method found', {
                    keys: Object.keys(memory)
                });
            }
        }
    } catch (error) {
        logger.logError('Failed to save context to memory', error as Error);
        // Don't fail the execution if memory saving fails
    }
}
