// @ts-nocheck
import { buildPromptWithMemory, addOutputParserInstructions } from '../../utils/promptBuilder';
import { DebugLogger } from '../../utils/debugLogger';
import { mockMemoryMessages } from '../fixtures/claudeFixtures';

describe('ClaudeAgent > utils > promptBuilder', () => {
    let mockContext: any;
    let logger: DebugLogger;

    beforeEach(() => {
        mockContext = {
            getInputConnectionData: jest.fn(),
        };
        logger = new DebugLogger(false);
    });

    describe('buildPromptWithMemory', () => {
        it('should return original prompt when no memory available', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(null);

            const result = await buildPromptWithMemory.call(mockContext, 0, 'Hello', logger);

            expect(result).toBe('Hello');
        });

        it('should handle string memory messages', async () => {
            // This test should actually return the prompt unchanged since string memory
            // is not currently supported by the memory processing logic
            mockContext.getInputConnectionData.mockResolvedValue('Previous conversation here');

            const result = await buildPromptWithMemory.call(mockContext, 0, 'New message', logger);

            // String memory is not processed by the current implementation
            expect(result).toBe('New message');
        });

        it('should handle structured memory messages', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(mockMemoryMessages.simple);

            const result = await buildPromptWithMemory.call(mockContext, 0, 'What now?', logger);

            expect(result).toContain('Here is the conversation history:');
            expect(result).toContain('Current request:');
            expect(result).toContain('What now?');
        });

        it('should handle empty message arrays', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(mockMemoryMessages.empty);

            const result = await buildPromptWithMemory.call(mockContext, 0, 'Hello', logger);

            expect(result).toBe('Hello');
        });

        it('should handle complex conversation history', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(mockMemoryMessages.complex);

            const result = await buildPromptWithMemory.call(mockContext, 0, 'Continue', logger);

            expect(result).toContain('Here is the conversation history:');
            expect(result).toContain('Current request:');
            expect(result).toContain('Continue');
        });
    });

    describe('addOutputParserInstructions', () => {
        it('should return original prompt when no output parser', () => {
            const result = addOutputParserInstructions('Original prompt', null, logger);

            expect(result).toBe('Original prompt');
        });

        it('should add format instructions when parser available', () => {
            const mockParser = {
                getFormatInstructions: jest.fn().mockReturnValue('Respond in JSON format')
            };

            const result = addOutputParserInstructions('Original prompt', mockParser, logger);

            expect(result).toBe('Original prompt\n\nRespond in JSON format');
            expect(mockParser.getFormatInstructions).toHaveBeenCalled();
        });

        it('should handle empty format instructions', () => {
            const mockParser = {
                getFormatInstructions: jest.fn().mockReturnValue('')
            };

            const result = addOutputParserInstructions('Original prompt', mockParser, logger);

            // Empty string is falsy, so no instructions are added
            expect(result).toBe('Original prompt');
        });

        it('should handle null format instructions', () => {
            const mockParser = {
                getFormatInstructions: jest.fn().mockReturnValue(null)
            };

            const result = addOutputParserInstructions('Original prompt', mockParser, logger);

            expect(result).toBe('Original prompt');
        });
    });
});