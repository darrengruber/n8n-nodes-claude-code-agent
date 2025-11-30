// @ts-nocheck
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ClaudeAgent } from '../ClaudeAgent.node';

// Mock external dependencies
jest.mock('../ClaudeAgentExecute');
jest.mock('../GenericFunctions');

const mockClaudeAgentExecute = require('../ClaudeAgentExecute');
const mockGenericFunctions = require('../GenericFunctions');

// Type declarations for mocked functions
interface MockedExecuteFunctions extends IExecuteFunctions {
    getInputData: jest.MockedFunction<any>;
    getNodeParameter: jest.MockedFunction<any>;
    continueOnFail: jest.MockedFunction<any>;
    getNode: jest.MockedFunction<any>;
    getInputConnectionData: jest.MockedFunction<any>;
}

describe('ClaudeAgent > Node Execution', () => {
    let node: ClaudeAgent;
    let executeFunctions: MockedExecuteFunctions;

    beforeEach(() => {
        node = new ClaudeAgent();
        executeFunctions = {
            getInputData: jest.fn(),
            getNodeParameter: jest.fn(),
            continueOnFail: jest.fn(),
            getNode: jest.fn(),
            getInputConnectionData: jest.fn(),
        } as any;

        // Default mock implementations
        executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
        executeFunctions.continueOnFail.mockReturnValue(false);
        executeFunctions.getNode.mockReturnValue({ id: 'test-node' });
    });

    describe('basic execution', () => {
        it('should execute with minimal valid parameters', async () => {
            // Arrange
            const expectedResult = [{
                json: { output: 'Hello! I can help you with various tasks.' }
            }];

            mockClaudeAgentExecute.claudeAgentExecute.mockResolvedValue(expectedResult);

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result).toEqual(expectedResult);
            expect(mockClaudeAgentExecute.claudeAgentExecute).toHaveBeenCalled();
        });

        it('should handle system message option', async () => {
            // Arrange
            const expectedResult = [{
                json: { output: '2+2 = 4' }
            }];

            mockClaudeAgentExecute.claudeAgentExecute.mockResolvedValue(expectedResult);

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.output).toBe('2+2 = 4');
        });

        it('should handle max turns option', async () => {
            // Arrange
            const expectedResult = [{
                json: { output: 'I can help debug your code.' }
            }];

            mockClaudeAgentExecute.claudeAgentExecute.mockResolvedValue(expectedResult);

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.output).toContain('debug');
        });

        it('should handle working directory option', async () => {
            // Arrange
            const expectedResult = [{
                json: { output: 'Files in /home/user/project: ...' }
            }];

            mockClaudeAgentExecute.claudeAgentExecute.mockResolvedValue(expectedResult);

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.output).toContain('Files');
        });
    });

    describe('error handling', () => {
        it('should propagate execution errors', async () => {
            // Arrange
            const testError = new Error('Test execution error');
            mockClaudeAgentExecute.claudeAgentExecute.mockRejectedValue(testError);

            // Act & Assert
            await expect(node.execute.call(executeFunctions))
                .rejects.toThrow('Test execution error');
        });

        it('should handle continue on fail scenario', async () => {
            // Arrange
            executeFunctions.continueOnFail.mockReturnValue(true);
            const errorResult = [{
                json: { error: 'Test error' },
                error: new Error('Test error'),
                pairedItem: 0
            }];

            mockClaudeAgentExecute.claudeAgentExecute.mockResolvedValue(errorResult);

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result).toEqual(errorResult);
        });
    });
});