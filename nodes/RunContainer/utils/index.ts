import type {
    ToolParameter,
    SendIn,
} from '../interfaces';

const extractPlaceholders = (text: string): string[] => {
    const placeholder = /(\{[a-zA-Z0-9_-]+\})/g;
    const returnData: string[] = [];

    const matches = text.matchAll(placeholder);

    for (const match of matches) {
        returnData.push(match[0].replace(/{|}/g, ''));
    }

    return returnData;
};

export const extractParametersFromText = (
    text: string,
    sendIn: SendIn,
    key?: string,
): ToolParameter[] => {
    if (typeof text !== 'string') return [];

    const parameters = extractPlaceholders(text);
    const result: ToolParameter[] = [];

    if (parameters.length) {
        // Deduplicate parameters by name
        const uniqueParams = Array.from(new Set(parameters));

        for (const paramName of uniqueParams) {
            const parameter: ToolParameter = {
                name: paramName,
                required: true, // Placeholders in text are always required
                type: 'string',
                description: `Parameter: ${paramName}`,
                sendIn,
            };

            if (key) {
                parameter.key = key;
            }

            result.push(parameter);
        }
    }

    return result;
};


