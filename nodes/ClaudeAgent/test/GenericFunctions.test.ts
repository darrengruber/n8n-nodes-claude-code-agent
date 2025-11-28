// @ts-nocheck
import {
    validateAnthropicModel,
    setupSdkEnvironment,
    validatePrompt,
    processWorkingDirectory,
    buildSdkConfiguration,
    canContinueOnFail,
    getConnectedModel,
} from '../GenericFunctions';
import { NodeOperationError } from 'n8n-workflow';

describe('ClaudeAgent > GenericFunctions', () => {
    let mockNode: any;
    let mockContext: any;

    beforeEach(() => {
        mockNode = { id: 'test-node', description: { name: 'Test Node' } };
        mockContext = {
            getNode: jest.fn().mockReturnValue(mockNode),
            getInputConnectionData: jest.fn(),
            getNodeParameter: jest.fn(),
            continueOnFail: jest.fn(),
        };
    });

    describe('validateAnthropicModel', () => {
        it('should validate Anthropic Chat Model successfully', () => {
            const anthropicModel = {
                constructor: { name: 'ChatAnthropic' },
                model: 'claude-3-sonnet-20240229',
                anthropicApiKey: 'test-key',
                apiUrl: 'https://api.anthropic.com'
            };

            const result = validateAnthropicModel(anthropicModel, mockNode);

            expect(result).toEqual({
                model: 'claude-3-sonnet-20240229',
                apiKey: 'test-key',
                baseURL: 'https://api.anthropic.com'
            });
        });

        it('should validate model using _llmType method', () => {
            const anthropicModel = {
                _llmType: () => 'anthropic',
                model: 'claude-3-haiku-20240307',
                anthropicApiKey: 'test-key'
            };

            const result = validateAnthropicModel(anthropicModel, mockNode);

            expect(result.model).toBe('claude-3-haiku-20240307');
            expect(result.apiKey).toBe('test-key');
        });

        it('should reject non-Anthropic models', () => {
            const openaiModel = {
                constructor: { name: 'ChatOpenAI' },
                model: 'gpt-4',
                apiKey: 'test-key'
            };

            expect(() => validateAnthropicModel(openaiModel, mockNode))
                .toThrow(NodeOperationError);
        });
    });

    describe('setupSdkEnvironment', () => {
        beforeEach(() => {
            delete process.env.ANTHROPIC_API_KEY;
            delete process.env.ANTHROPIC_BASE_URL;
        });

        it('should set API key environment variable', () => {
            setupSdkEnvironment('test-api-key', undefined);
            expect(process.env.ANTHROPIC_API_KEY).toBe('test-api-key');
        });

        it('should set base URL environment variable', () => {
            setupSdkEnvironment(undefined, 'https://custom.api.com');
            expect(process.env.ANTHROPIC_BASE_URL).toBe('https://custom.api.com');
        });

        it('should set both environment variables', () => {
            setupSdkEnvironment('test-key', 'https://api.com');
            expect(process.env.ANTHROPIC_API_KEY).toBe('test-key');
            expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.com');
        });

        it('should not set variables when undefined', () => {
            setupSdkEnvironment(undefined, undefined);
            expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
            expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
        });
    });

    describe('validatePrompt', () => {
        it('should accept valid prompts', () => {
            expect(() => validatePrompt('Hello, world!', mockNode)).not.toThrow();
        });

        it('should reject empty strings', () => {
            expect(() => validatePrompt('', mockNode)).toThrow(NodeOperationError);
        });

        it('should reject whitespace-only strings', () => {
            expect(() => validatePrompt('   ', mockNode)).toThrow(NodeOperationError);
        });

        it('should reject null/undefined', () => {
            expect(() => validatePrompt(null as any, mockNode)).toThrow(NodeOperationError);
            expect(() => validatePrompt(undefined as any, mockNode)).toThrow(NodeOperationError);
        });
    });

    describe('processWorkingDirectory', () => {
        it('should return undefined for empty input', () => {
            expect(processWorkingDirectory('')).toBeUndefined();
            expect(processWorkingDirectory('   ')).toBeUndefined();
            expect(processWorkingDirectory(undefined)).toBeUndefined();
        });

        it('should return cleaned directory path', () => {
            const result = processWorkingDirectory('  /home/user/project  ');
            expect(result).toBe('/home/user/project');
        });

        it('should handle relative paths', () => {
            const result = processWorkingDirectory('relative/path');
            expect(result).toBe('relative/path');
        });
    });

    describe('buildSdkConfiguration', () => {
        it('should build basic configuration', () => {
            const options = {
                systemMessage: 'You are helpful',
                maxTurns: 10
            };

            const config = buildSdkConfiguration(
                'claude-3-sonnet',
                options,
                {},
                ['Bash', 'WebFetch']
            );

            expect(config).toEqual({
                model: 'claude-3-sonnet',
                systemPrompt: 'You are helpful',
                maxTurns: 10,
                permissionMode: 'bypassPermissions',
                mcpServers: undefined,
                disallowedTools: ['Bash', 'WebFetch']
            });
        });

        it('should include MCP servers when provided', () => {
            const mcpServers = {
                'test-server': { tools: [] }
            };

            const config = buildSdkConfiguration(
                'claude-3-sonnet',
                {},
                mcpServers,
                []
            );

            expect(config.mcpServers).toEqual(mcpServers);
        });

        it('should include working directory when provided', () => {
            const config = buildSdkConfiguration(
                'claude-3-sonnet',
                { workingDirectory: '/home/user' },
                {},
                [],
                '/home/user'
            );

            expect(config.workingDirectory).toBe('/home/user');
        });
    });

    describe('canContinueOnFail', () => {
        it('should return true for context with continueOnFail', () => {
            const executeContext = {
                continueOnFail: jest.fn(),
                getNode: jest.fn(),
                getNodeParameter: jest.fn(),
                getInputConnectionData: jest.fn(),
            };
            expect(canContinueOnFail(executeContext)).toBe(true);
        });

        it('should return false for context without continueOnFail', () => {
            const supplyContext = {
                getNode: jest.fn(),
                getNodeParameter: jest.fn(),
                getInputConnectionData: jest.fn(),
            };
            expect(canContinueOnFail(supplyContext)).toBe(false);
        });
    });

    describe('getConnectedModel', () => {
        it('should return model configuration when connected', async () => {
            const mockModel = {
                constructor: { name: 'ChatAnthropic' },
                model: 'claude-3-sonnet',
                anthropicApiKey: 'test-key'
            };

            mockContext.getInputConnectionData.mockResolvedValue(mockModel);

            const result = await getConnectedModel(mockContext, 0);

            expect(result).toEqual({
                model: 'claude-3-sonnet',
                apiKey: 'test-key',
                baseURL: undefined
            });
        });

        it('should throw error when no model connected', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(null);

            await expect(getConnectedModel(mockContext, 0))
                .rejects.toThrow('Please connect an Anthropic Chat Model');
        });

        it('should throw error for non-Anthropic model', async () => {
            const mockModel = {
                constructor: { name: 'ChatOpenAI' },
                model: 'gpt-4'
            };

            mockContext.getInputConnectionData.mockResolvedValue(mockModel);

            await expect(getConnectedModel(mockContext, 0))
                .rejects.toThrow('Only Anthropic Chat Models are supported');
        });
    });
});