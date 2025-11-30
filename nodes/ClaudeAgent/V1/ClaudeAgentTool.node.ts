import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionTypes,
    ISupplyDataFunctions,
} from 'n8n-workflow';
import { claudeAgentExecute } from '../ClaudeAgentExecute';

export class ClaudeAgentTool implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Claude Agent Tool',
        name: 'claudeAgentTool',
        icon: 'file:img/claudeAgent.v2.svg',
        group: ['transform'],
        version: 1,
        description: 'Runs a Claude AI agent as a tool with access to tools and memory',
        defaults: {
            name: 'Claude Agent Tool',
        },
        inputs: [
            {
                displayName: 'Chat Model',
                type: NodeConnectionTypes.AiLanguageModel,
                required: true,
                maxConnections: 1,
                filter: {
                    nodes: ['@n8n/n8n-nodes-langchain.lmChatAnthropic'],
                },
            },
            {
                displayName: 'Memory',
                type: NodeConnectionTypes.AiMemory,
            },
            {
                displayName: 'Tools',
                type: NodeConnectionTypes.AiTool,
            },
            {
                displayName: 'Output Parser',
                type: NodeConnectionTypes.AiOutputParser,
                maxConnections: 1,
            },
        ],
        outputs: [NodeConnectionTypes.AiTool],
        properties: [
            {
                displayName: 'Tool Description',
                name: 'toolDescription',
                type: 'string',
                default: 'Runs a Claude AI agent with access to tools and memory. Use this tool to execute complex tasks that require AI reasoning, tool usage, and context awareness. Provide a clear prompt describing what you want the agent to do.',
                description: 'Explain to LLM what this tool does and when to use it',
                typeOptions: {
                    rows: 3,
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
                        description: 'Enable verbose logging for debugging',
                    },
                    {
                        displayName: 'Working Directory',
                        name: 'workingDirectory',
                        type: 'string',
                        default: '',
                        description: 'Working directory for the agent',
                    },
                ],
            },
        ],
    };

    // When used as a tool, n8n will automatically wrap this node as a tool
    // The execute method will be called with tool args as input data
    async execute(this: IExecuteFunctions | ISupplyDataFunctions): Promise<INodeExecutionData[][]> {
        // Delegate to the shared execute function
        return await claudeAgentExecute.call(this);
    }
}
