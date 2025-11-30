export const mockClaudeResponses = {
    success: {
        type: 'result',
        subtype: 'success',
        result: 'I can help you with that task!'
    },
    error: {
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['API rate limit exceeded']
    },
    maxTurns: {
        type: 'result',
        subtype: 'error_max_turns',
        errors: ['Maximum number of turns exceeded']
    }
};

export const mockAnthropicModel = {
    constructor: { name: 'ChatAnthropic' },
    model: 'claude-3-sonnet-20240229',
    anthropicApiKey: 'test-api-key-12345',
    apiUrl: 'https://api.anthropic.com'
};

export const mockOpenAIModel = {
    constructor: { name: 'ChatOpenAI' },
    model: 'gpt-4',
    apiKey: 'test-openai-key'
};

export const mockNodeParameters = {
    minimal: {
        text: 'Hello, how can you help me?',
        options: {}
    },
    withSystemMessage: {
        text: 'What is the capital of France?',
        options: {
            systemMessage: 'You are a helpful geography assistant.',
            maxTurns: 5,
            verbose: false
        }
    },
    withVerbose: {
        text: 'Explain quantum computing',
        options: {
            verbose: true,
            maxTurns: 20
        }
    },
    withWorkingDirectory: {
        text: 'List files in current directory',
        options: {
            workingDirectory: '/home/user/project',
            maxTurns: 10
        }
    },
    fullOptions: {
        text: 'Complex task requiring multiple steps',
        options: {
            systemMessage: 'You are an expert assistant.',
            maxTurns: 30,
            verbose: true,
            workingDirectory: '/workspace'
        }
    }
};

export const mockSdkMessages = [
    { type: 'start', timestamp: '2024-01-01T00:00:00Z' },
    { type: 'tool_use', tool: 'bash', input: 'echo "hello"' },
    { type: 'tool_result', tool: 'bash', output: 'hello' },
    { type: 'result', subtype: 'success', result: 'Task completed successfully' }
];

export const mockEnvironmentVariables = {
    valid: [
        { name: 'NODE_ENV', value: 'production' },
        { name: 'API_KEY', value: 'secret123' },
        { name: 'DEBUG', value: 'true' }
    ],
    json: '{"NODE_ENV": "production", "API_KEY": "secret123"}'
};

export const mockMemoryMessages = {
    empty: [],
    simple: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
    ],
    complex: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '2+2 = 4' },
        { role: 'user', content: 'What is 3+3?' },
        { role: 'assistant', content: '3+3 = 6' }
    ]
};

export const mockTools = {
    single: [
        {
            name: 'bash',
            description: 'Run bash commands',
            inputSchema: { type: 'object' }
        }
    ],
    multiple: [
        {
            name: 'bash',
            description: 'Run bash commands',
            inputSchema: { type: 'object' }
        },
        {
            name: 'web_search',
            description: 'Search the web',
            inputSchema: { type: 'object' }
        }
    ],
    toolkit: {
        tools: [
            { name: 'file_read', description: 'Read files' },
            { name: 'file_write', description: 'Write files' }
        ]
    }
};