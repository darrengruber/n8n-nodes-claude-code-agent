import type { INodeProperties } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export const mainProperties: INodeProperties[] = [
    {
        displayName: 'Tool Description',
        name: 'toolDescription',
        type: 'string',
        default: 'Runs a Claude AI agent with access to tools and memory. Use this tool to execute complex tasks that require AI reasoning, tool usage, and context awareness. Provide a clear prompt describing what you want the agent to do.',
        description: 'Explain to LLM what this tool does and when to use it',
        typeOptions: {
            rows: 3,
        },
        displayOptions: {
            show: {
                '@tool': [true],
            },
        },
    },
    {
        displayName: 'Source for Prompt (User Message)',
        name: 'promptType',
        type: 'options',
        options: [
            {
                name: 'Connected Chat Trigger Node',
                value: 'auto',
                description:
                    "Looks for an input field called 'chatInput' that is coming from a directly connected Chat Trigger",
            },
            {
                name: 'Connected Guardrails Node',
                value: 'guardrails',
                description:
                    "Looks for an input field called 'guardrailsInput' that is coming from a directly connected Guardrails Node",
            },
            {
                name: 'Define below',
                value: 'define',
                description: 'Use an expression to reference data in previous nodes or enter static text',
            },
        ],
        default: 'auto',
    },
    {
        displayName: 'Prompt (User Message)',
        name: 'text',
        type: 'string',
        required: true,
        default: '={{ $json.chatInput }}',
        typeOptions: {
            rows: 2,
        },
        displayOptions: {
            show: {
                promptType: ['auto'],
            },
        },
    },
    {
        displayName: 'Prompt (User Message)',
        name: 'text',
        type: 'string',
        required: true,
        default: '={{ $json.guardrailsInput }}',
        typeOptions: {
            rows: 2,
        },
        displayOptions: {
            show: {
                promptType: ['guardrails'],
            },
        },
    },
    {
        displayName: 'Prompt (User Message)',
        name: 'text',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. Hello, how can you help me?',
        typeOptions: {
            rows: 2,
        },
        displayOptions: {
            show: {
                promptType: ['define'],
                '@tool': [false],
            },
        },
    },
    {
        displayName: 'Prompt (User Message)',
        name: 'text',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'The prompt or question to send to the Claude agent',
        description: 'Describe what you want the agent to do',
        typeOptions: {
            rows: 2,
        },
        displayOptions: {
            show: {
                '@tool': [true],
            },
        },
    },
    {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
            {
                displayName: 'System Message',
                name: 'systemMessage',
                type: 'string',
                default: '',
                description: 'System message to send to the agent',
                typeOptions: {
                    rows: 4,
                },
            },
            {
                displayName: 'Max Turns',
                name: 'maxTurns',
                type: 'number',
                default: 30,
                description: 'Maximum number of conversational turns the agent can take',
            },
            {
                displayName: 'Verbose',
                name: 'verbose',
                type: 'boolean',
                default: false,
                description: 'Whether to return detailed execution logs',
            },
            {
                displayName: 'Working Directory',
                name: 'workingDirectory',
                type: 'string',
                default: '',
                placeholder: '/path/to/project or leave empty for current directory',
                description: 'The starting directory for the agent (optional, defaults to current directory)',
            },
            {
                displayName: 'Binary Input Handling',
                name: 'binaryInputMode',
                type: 'options',
                options: [
                    {
                        name: 'Disabled',
                        value: 'disabled',
                        description: 'Do not pass binary data to tools',
                    },
                    {
                        name: 'Automatic',
                        value: 'auto',
                        description: 'Automatically extract and mount binary files for tools',
                    },
                    {
                        name: 'Manual',
                        value: 'manual',
                        description: 'Pass binary metadata to tools but let them handle mounting',
                    },
                ],
                default: 'disabled',
                description: 'How to handle binary data from input items and make it available to tools',
            },
            {
                displayName: 'Max Binary File Size (MB)',
                name: 'maxBinaryFileSize',
                type: 'number',
                default: 100,
                typeOptions: {
                    minValue: 1,
                    maxValue: 1000,
                },
                description: 'Maximum size for individual binary files (in MB). Files larger than this will be skipped with a warning.',
                displayOptions: {
                    show: {
                        binaryInputMode: ['auto', 'manual'],
                    },
                },
            },
            {
                displayName: 'Binary File Types',
                name: 'allowedBinaryTypes',
                type: 'multiOptions',
                options: [
                    {
                        name: 'Images (png, jpg, gif, webp, svg)',
                        value: 'images',
                        description: 'Image files for visual processing',
                    },
                    {
                        name: 'Documents (pdf, doc, docx, txt)',
                        value: 'documents',
                        description: 'Document files for text extraction',
                    },
                    {
                        name: 'Data Files (json, csv, xml, yaml)',
                        value: 'data',
                        description: 'Structured data files',
                    },
                    {
                        name: 'Archives (zip, tar, gz)',
                        value: 'archives',
                        description: 'Compressed file archives',
                    },
                    {
                        name: 'Code Files (js, ts, py, java, etc)',
                        value: 'code',
                        description: 'Source code files',
                    },
                    {
                        name: 'All Files',
                        value: 'all',
                        description: 'Allow all file types',
                    },
                ],
                default: ['images', 'documents', 'data'],
                description: 'Types of binary files to process. Files with other types will be skipped.',
                displayOptions: {
                    show: {
                        binaryInputMode: ['auto', 'manual'],
                    },
                },
            },
        ],
    },
    {
        displayName: 'Require Specific Output Format',
        name: 'hasOutputParser',
        type: 'boolean',
        default: false,
        noDataExpression: true,
    },
    {
        displayName: `Connect an <a data-action='openSelectiveNodeCreator' data-action-parameter-connectiontype='${NodeConnectionTypes.AiOutputParser}'>output parser</a> on the canvas to specify the output format you require`,
        name: 'notice',
        type: 'notice',
        default: '',
        displayOptions: {
            show: {
                hasOutputParser: [true],
            },
        },
    },
];