// @ts-nocheck
import { processConnectedTools } from '../../utils/toolProcessor';
import { DebugLogger } from '../../utils/debugLogger';
import { mockTools } from '../fixtures/claudeFixtures';

// Mock the processToolsForAgent function
jest.mock('../../utils/mcpAdapter', () => ({
    processToolsForAgent: jest.fn()
}));

import { processToolsForAgent } from '../../utils/mcpAdapter';

describe('ClaudeAgent > utils > toolProcessor', () => {
    let mockContext: any;
    let logger: DebugLogger;

    beforeEach(() => {
        mockContext = {
            getInputConnectionData: jest.fn(),
        };
        logger = new DebugLogger(false);
        jest.clearAllMocks();
    });

    describe('processConnectedTools', () => {
        it('should handle no connected tools', async () => {
            mockContext.getInputConnectionData.mockResolvedValue([]);
            (processToolsForAgent as jest.Mock).mockResolvedValue({
                mcpServers: {},
                disallowedTools: ['Bash', 'WebFetch']
            });

            const result = await processConnectedTools(mockContext, 0, false, logger);

            expect(result).toEqual({
                mcpServers: {},
                disallowedTools: ['Bash', 'WebFetch'],
                toolsCount: 0
            });
        });

        it('should process single tools', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(mockTools.single);
            (processToolsForAgent as jest.Mock).mockResolvedValue({
                mcpServers: { 'bash-server': { tools: mockTools.single } },
                disallowedTools: ['Bash']
            });

            const result = await processConnectedTools(mockContext, 0, true, logger);

            expect(result.toolsCount).toBe(1);
            expect(result.mcpServers).toHaveProperty('bash-server');
            expect(processToolsForAgent).toHaveBeenCalledWith(
                mockTools.single,
                { verbose: true },
                logger
            );
        });

        it('should process multiple tools', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(mockTools.multiple);
            (processToolsForAgent as jest.Mock).mockResolvedValue({
                mcpServers: {
                    'bash-server': { tools: [mockTools.single[0]] },
                    'search-server': { tools: [mockTools.multiple[1]] }
                },
                disallowedTools: []
            });

            const result = await processConnectedTools(mockContext, 0, false, logger);

            expect(result.toolsCount).toBe(2);
            expect(Object.keys(result.mcpServers)).toHaveLength(2);
            expect(processToolsForAgent).toHaveBeenCalledWith(
                mockTools.multiple,
                { verbose: false },
                logger
            );
        });

        it('should unwrap toolkit tools', async () => {
            mockContext.getInputConnectionData.mockResolvedValue([mockTools.toolkit]);
            (processToolsForAgent as jest.Mock).mockResolvedValue({
                mcpServers: { 'file-server': { tools: mockTools.toolkit.tools } },
                disallowedTools: []
            });

            const result = await processConnectedTools(mockContext, 0, true, logger);

            expect(result.toolsCount).toBe(2); // Should be unwrapped
            expect(processToolsForAgent).toHaveBeenCalledWith(
                mockTools.toolkit.tools,
                { verbose: true },
                logger
            );
        });

        it('should handle tool processing errors gracefully', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(mockTools.single);
            (processToolsForAgent as jest.Mock).mockRejectedValue(new Error('Tool processing failed'));

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            const result = await processConnectedTools(mockContext, 0, false, logger);

            expect(result).toEqual({
                mcpServers: {},
                disallowedTools: ['Bash', 'WebFetch'],
                toolsCount: 0
            });
            expect(consoleSpy).toHaveBeenCalledWith('Failed to process tools:', expect.any(Error));

            consoleSpy.mockRestore();
        });

        it('should handle null tools input', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(null);
            (processToolsForAgent as jest.Mock).mockResolvedValue({
                mcpServers: {},
                disallowedTools: ['Bash', 'WebFetch']
            });

            const result = await processConnectedTools(mockContext, 0, false, logger);

            expect(result.toolsCount).toBe(0);
            expect(result.mcpServers).toEqual({});
        });

        it('should pass verbose option correctly', async () => {
            mockContext.getInputConnectionData.mockResolvedValue(mockTools.single);
            (processToolsForAgent as jest.Mock).mockResolvedValue({
                mcpServers: {},
                disallowedTools: []
            });

            await processConnectedTools(mockContext, 0, true, logger);

            expect(processToolsForAgent).toHaveBeenCalledWith(
                mockTools.single,
                { verbose: true },
                logger
            );

            await processConnectedTools(mockContext, 0, false, logger);

            expect(processToolsForAgent).toHaveBeenCalledWith(
                mockTools.single,
                { verbose: false },
                logger
            );
        });
    });
});