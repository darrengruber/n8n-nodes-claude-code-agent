"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeCodeAgent = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const claude_agent_sdk_1 = require("@anthropic-ai/claude-agent-sdk");
class ClaudeCodeAgent {
    constructor() {
        this.description = {
            displayName: 'Claude Code Agent',
            name: 'claudeCodeAgent',
            icon: { light: 'file:claudeCodeAgent.svg', dark: 'file:claudeCodeAgent.dark.svg' },
            group: ['transform'],
            version: 1,
            description: 'Agent powered by Claude Code SDK',
            defaults: {
                name: 'Claude Code Agent',
            },
            inputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            credentials: [
                {
                    name: 'anthropicApi',
                    required: true,
                },
            ],
            properties: [
                {
                    displayName: 'Text',
                    name: 'text',
                    type: 'string',
                    default: '',
                    placeholder: 'What would you like the agent to do?',
                    description: 'The instruction for the agent',
                    typeOptions: {
                        rows: 4,
                    },
                },
                {
                    displayName: 'Model',
                    name: 'model',
                    type: 'options',
                    typeOptions: {
                        loadOptionsMethod: 'getModels',
                    },
                    default: 'claude-3-5-sonnet-20241022',
                    description: 'The model to use',
                    options: [],
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
                        },
                        {
                            displayName: 'Verbose',
                            name: 'verbose',
                            type: 'boolean',
                            default: false,
                            description: 'Whether to return detailed execution logs',
                        },
                    ],
                },
            ],
        };
        this.methods = {
            loadOptions: {
                async getModels() {
                    const credentials = await this.getCredentials('anthropicApi');
                    const apiKey = credentials.apiKey;
                    const baseUrl = credentials.baseUrl || credentials.url || 'https://api.anthropic.com';
                    try {
                        const response = await this.helpers.request({
                            method: 'GET',
                            url: `${baseUrl}/v1/models`,
                            headers: {
                                'x-api-key': apiKey,
                                'anthropic-version': '2023-06-01',
                            },
                            json: true,
                        });
                        return response.data.map((model) => ({
                            name: model.display_name || model.id,
                            value: model.id,
                        }));
                    }
                    catch (error) {
                        return [
                            { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                            { name: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
                            { name: 'Claude 3 Haiku', value: 'claude-3-haiku-20240307' },
                        ];
                    }
                },
            },
        };
    }
    async execute() {
        var _a;
        const items = this.getInputData();
        const returnData = [];
        const credentials = await this.getCredentials('anthropicApi');
        if (credentials === null || credentials === void 0 ? void 0 : credentials.apiKey) {
            process.env.ANTHROPIC_API_KEY = credentials.apiKey;
        }
        if (credentials === null || credentials === void 0 ? void 0 : credentials.baseUrl) {
            process.env.ANTHROPIC_BASE_URL = credentials.baseUrl;
        }
        else if (credentials === null || credentials === void 0 ? void 0 : credentials.url) {
            process.env.ANTHROPIC_BASE_URL = credentials.url;
        }
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                const prompt = this.getNodeParameter('text', itemIndex, '');
                const model = this.getNodeParameter('model', itemIndex, 'claude-3-5-sonnet-20241022');
                const options = this.getNodeParameter('options', itemIndex, {});
                const generator = (0, claude_agent_sdk_1.query)({
                    prompt,
                    options: {
                        model,
                        systemPrompt: options.systemMessage,
                        permissionMode: 'bypassPermissions',
                    },
                });
                let finalResult;
                const logs = [];
                for await (const message of generator) {
                    if (options.verbose) {
                        logs.push(JSON.stringify(message));
                    }
                    if (message.type === 'result') {
                        if (message.subtype === 'success') {
                            finalResult = message.result;
                        }
                        else if (message.subtype === 'error_during_execution' || message.subtype === 'error_max_turns' || message.subtype === 'error_max_budget_usd' || message.subtype === 'error_max_structured_output_retries') {
                            throw new Error(`Claude Code Agent failed: ${message.subtype}. Errors: ${(_a = message.errors) === null || _a === void 0 ? void 0 : _a.join(', ')}`);
                        }
                    }
                }
                if (finalResult === undefined) {
                    throw new Error('Claude Code Agent finished without a result.');
                }
                const jsonResult = {
                    result: finalResult,
                };
                if (options.verbose) {
                    jsonResult.logs = logs;
                }
                returnData.push({
                    json: jsonResult,
                    pairedItem: {
                        item: itemIndex,
                    },
                });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({ json: { error: error.message }, error, pairedItem: itemIndex });
                }
                else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                        itemIndex,
                    });
                }
            }
        }
        return [returnData];
    }
}
exports.ClaudeCodeAgent = ClaudeCodeAgent;
//# sourceMappingURL=ClaudeCodeAgent.node.js.map