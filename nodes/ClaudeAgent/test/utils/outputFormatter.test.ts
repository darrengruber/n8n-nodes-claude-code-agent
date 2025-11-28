// @ts-nocheck
import {
    formatOutputResult,
    processSdkMessages,
    saveMemoryContextSafe,
} from '../../utils/outputFormatter';
import { DebugLogger } from '../../utils/debugLogger';
import { mockSdkMessages } from '../fixtures/claudeFixtures';

// Mock the saveMemoryContext import
jest.mock('../../utils/memoryProcessor', () => ({
    saveMemoryContext: jest.fn()
}));

import { saveMemoryContext as mockSaveMemoryContext } from '../../utils/memoryProcessor';

describe('ClaudeAgent > utils > outputFormatter', () => {
    let mockContext: any;
    let logger: DebugLogger;

    beforeEach(() => {
        mockContext = {};
        logger = new DebugLogger(false);
        jest.clearAllMocks();
    });

    describe('formatOutputResult', () => {
        it('should format basic output result', () => {
            const result = formatOutputResult('Test output', false);

            expect(result).toEqual({
                output: 'Test output'
            });
        });

        it('should include logs when verbose is true', () => {
            const logs = ['log1', 'log2'];
            const result = formatOutputResult('Test output', true, logs);

            expect(result).toEqual({
                output: 'Test output',
                logs: logs
            });
        });

        it('should not include logs when verbose is false', () => {
            const logs = ['log1', 'log2'];
            const result = formatOutputResult('Test output', false, logs);

            expect(result).toEqual({
                output: 'Test output'
            });
            expect(result.logs).toBeUndefined();
        });

        it('should handle complex output objects', () => {
            const complexOutput = { data: [1, 2, 3], status: 'success' };
            const result = formatOutputResult(complexOutput, false);

            expect(result.output).toEqual(complexOutput);
        });
    });

    describe('processSdkMessages', () => {
        it('should process successful SDK messages', async () => {
            const mockGenerator = (async function* () {
                yield mockSdkMessages[0];
                yield mockSdkMessages[1];
                yield mockSdkMessages[2];
                yield mockSdkMessages[3];
            })();

            const loggerMock = {
                logTurn: jest.fn(),
                logSection: jest.fn(),
                log: jest.fn(),
                logError: jest.fn()
            };

            const result = await processSdkMessages(mockGenerator, false, loggerMock);

            expect(result.result).toBe('Task completed successfully');
            expect(result.logs).toEqual([]);
            expect(result.messageCount).toBe(4);
            expect(loggerMock.logTurn).toHaveBeenCalledTimes(4);
        });

        it('should collect logs when verbose is true', async () => {
            const mockGenerator = (async function* () {
                yield { type: 'debug', data: 'Debug info' };
                yield { type: 'result', subtype: 'success', result: 'Success' };
            })();

            const loggerMock = {
                logTurn: jest.fn(),
                logSection: jest.fn(),
                log: jest.fn(),
                logError: jest.fn()
            };

            const result = await processSdkMessages(mockGenerator, true, loggerMock);

            expect(result.logs).toHaveLength(2);
            expect(result.logs[0]).toContain('debug');
            expect(result.logs[1]).toContain('success');
        });

        it('should handle error during execution', async () => {
            const mockGenerator = (async function* () {
                yield {
                    type: 'result',
                    subtype: 'error_during_execution',
                    errors: ['API error']
                };
            })();

            const loggerMock = {
                logTurn: jest.fn(),
                logSection: jest.fn(),
                logError: jest.fn()
            };

            await expect(processSdkMessages(mockGenerator, false, loggerMock))
                .rejects.toThrow('Claude Agent failed: error_during_execution');
        });

        it('should handle max turns error', async () => {
            const mockGenerator = (async function* () {
                yield {
                    type: 'result',
                    subtype: 'error_max_turns',
                    errors: ['Too many turns']
                };
            })();

            const loggerMock = {
                logTurn: jest.fn(),
                logSection: jest.fn(),
                logError: jest.fn()
            };

            await expect(processSdkMessages(mockGenerator, false, loggerMock))
                .rejects.toThrow('Claude Agent failed: error_max_turns');
        });

        it('should handle max budget error', async () => {
            const mockGenerator = (async function* () {
                yield {
                    type: 'result',
                    subtype: 'error_max_budget_usd',
                    errors: ['Budget exceeded']
                };
            })();

            const loggerMock = {
                logTurn: jest.fn(),
                logSection: jest.fn(),
                logError: jest.fn()
            };

            await expect(processSdkMessages(mockGenerator, false, loggerMock))
                .rejects.toThrow('Claude Agent failed: error_max_budget_usd');
        });

        it('should handle max structured output retries error', async () => {
            const mockGenerator = (async function* () {
                yield {
                    type: 'result',
                    subtype: 'error_max_structured_output_retries',
                    errors: ['Too many retries']
                };
            })();

            const loggerMock = {
                logTurn: jest.fn(),
                logSection: jest.fn(),
                logError: jest.fn()
            };

            await expect(processSdkMessages(mockGenerator, false, loggerMock))
                .rejects.toThrow('Claude Agent failed: error_max_structured_output_retries');
        });

        it('should throw error when no result received', async () => {
            const mockGenerator = (async function* () {
                yield { type: 'start' };
                yield { type: 'tool_use' };
                // No result message
            })();

            const loggerMock = {
                logTurn: jest.fn(),
                logSection: jest.fn(),
                log: jest.fn(),
                logError: jest.fn()
            };

            await expect(processSdkMessages(mockGenerator, false, loggerMock))
                .rejects.toThrow('Claude Agent finished without a result');
        });
    });

    describe('saveMemoryContextSafe', () => {
        it('should save memory context successfully', async () => {
            mockSaveMemoryContext.mockResolvedValue(undefined);

            await saveMemoryContextSafe(mockContext, 0, 'Hello', 'Hi there!', logger);

            expect(mockSaveMemoryContext).toHaveBeenCalledWith(
                mockContext, 0, 'Hello', 'Hi there!', logger
            );
        });

        it('should handle memory save errors gracefully', async () => {
            mockSaveMemoryContext.mockRejectedValue(new Error('Memory error'));
            const loggerSpy = jest.spyOn(logger, 'logError');

            await expect(saveMemoryContextSafe(mockContext, 0, 'Hello', 'Hi there!', logger))
                .resolves.toBeUndefined();

            expect(loggerSpy).toHaveBeenCalledWith(
                'Failed to save memory context',
                expect.any(Error)
            );
        });
    });
});