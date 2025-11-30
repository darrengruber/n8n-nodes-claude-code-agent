import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionTypes,
} from 'n8n-workflow';
import { mainProperties } from './Description';
import { claudeAgentExecute } from './ClaudeAgentExecute';
import { ClaudeAgentTool } from './V1/ClaudeAgentTool.node';

// Cache busting: Increment the node version when you want to force icon reload
// n8n uses the version property to handle caching internally
export class ClaudeAgent implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Claude Agent',
        name: 'claudeAgent',
        icon: 'file:img/claudeAgent.v2.svg',
        group: ['transform'],
        version: 3,
        description: 'Use the Claude Code SDK to run an AI agent',
        defaults: {
            name: 'Claude Agent',
        },
        inputs: [
            {
                displayName: '',
                type: NodeConnectionTypes.Main,
            },
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
        outputs: [NodeConnectionTypes.Main],
        properties: mainProperties,
        usableAsTool: true,
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        return await claudeAgentExecute.call(this);
    }
}

// Export the tool version for backward compatibility
export { ClaudeAgentTool };
