import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DebugLogger } from '../nodes/ClaudeAgent/DebugLogger';
import { buildNativeToolPolicy, processToolsForAgent } from '../nodes/ClaudeAgent/McpToolAdapter';

const logger = new DebugLogger(false);

function createLangchainTool(name: string, metadata: Record<string, any> = {}) {
    return {
        name,
        description: `${name} description`,
        metadata,
        schema: z.object({
            command: z.string().describe('command'),
        }),
        invoke: vi.fn(async (input: any) => ({
            ran: input,
        })),
    } as any;
}

describe('buildNativeToolPolicy', () => {
    it('keeps shell/filesystem tools disabled without Execute Command and preserves core allowlist', () => {
        const policy = buildNativeToolPolicy({
            bySource: {},
            hasExecuteCommandNode: false,
            hasHttpRequestNode: false,
            mcpClients: [],
        }, logger);

        expect(policy.allowedTools).toEqual(
            expect.arrayContaining(['Agent', 'AskUserQuestion', 'ListMcpResources', 'ReadMcpResource', 'Mcp', 'WebSearch'])
        );
        expect(policy.disallowedTools).toEqual(
            expect.arrayContaining([
                'Bash',
                'BashOutput',
                'FileEdit',
                'FileRead',
                'FileWrite',
                'Glob',
                'Grep',
                'KillShell',
                'NotebookEdit',
                'WebFetch',
                'ExitPlanMode',
                'TimeMachine',
                'TodoWrite',
            ]),
        );
    });

    it('permits shell and filesystem tools only when Execute Command is attached', () => {
        const policy = buildNativeToolPolicy({
            bySource: {},
            hasExecuteCommandNode: true,
            hasHttpRequestNode: true,
            mcpClients: [],
        }, logger);

        expect(policy.allowedTools).toEqual(
            expect.arrayContaining(['Bash', 'BashOutput', 'FileRead', 'FileWrite', 'WebFetch']),
        );
        expect(policy.disallowedTools).toEqual(expect.arrayContaining(['ExitPlanMode', 'TimeMachine', 'TodoWrite']));
    });
});

describe('processToolsForAgent', () => {
    it('gates Bash/WebFetch access based on connected tool types', async () => {
        const executeTool = createLangchainTool('Execute Command', { nodeType: 'executeCommand', sourceNodeName: 'runner' });
        const httpTool = createLangchainTool('HTTP Request', { nodeType: 'httpRequest', sourceNodeName: 'http' });

        const result = await processToolsForAgent([executeTool, httpTool], { verbose: false }, logger);

        expect(result.allowedTools).toEqual(expect.arrayContaining(['Bash', 'WebFetch', 'FileRead']));
        expect(result.disallowedTools).not.toEqual(expect.arrayContaining(['Bash', 'WebFetch', 'FileRead']));
        expect(Object.keys(result.mcpServers)).toEqual(expect.arrayContaining(['runner', 'http']));
    });

    it('discovers tools from MCP clients and adds them to allowed list', async () => {
        const mcpClient = {
            name: 'Remote MCP',
            metadata: { sourceNodeName: 'remoteClient' },
            listTools: vi.fn(async () => ({ tools: [{ name: 'ping', description: 'Ping the server' }] })),
            callTool: vi.fn(async (name: string, args: any) => ({ name, args })),
            listResources: vi.fn(async () => ({ resources: [{ name: 'status', uri: 'mcp://status' }] })),
        };

        const result = await processToolsForAgent([mcpClient], { verbose: false }, logger);

        expect(result.allowedTools).toContain('ping');
        expect(Object.keys(result.mcpServers)).toContain('remoteClient');
        expect(result.resourceDiscoveries.remoteClient).toEqual([
            { name: 'status', uri: 'mcp://status' },
        ]);
        expect(mcpClient.listResources).toHaveBeenCalledTimes(1);
    });

    it('keeps WebFetch disallowed when HTTP tool is missing', async () => {
        const executeTool = createLangchainTool('Execute Command', { nodeType: 'executeCommand', sourceNodeName: 'runner' });

        const result = await processToolsForAgent([executeTool], { verbose: false }, logger);

        expect(result.disallowedTools).toContain('WebFetch');
        expect(result.allowedTools).toEqual(expect.arrayContaining(['Bash', 'FileRead']));
    });

    it('keeps shell and filesystem tools blocked when Execute Command is absent', async () => {
        const httpTool = createLangchainTool('HTTP Request', { nodeType: 'httpRequest', sourceNodeName: 'http' });

        const result = await processToolsForAgent([httpTool], { verbose: false }, logger);

        expect(result.allowedTools).toContain('WebFetch');
        expect(result.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'FileRead', 'Grep']));
    });
});
