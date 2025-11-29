import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { DebugLogger } from './DebugLogger';

type ToolGrouping = {
    bySource: Record<string, any[]>;
    hasExecuteCommandNode: boolean;
    hasHttpRequestNode: boolean;
    mcpClients: any[];
};

type NativeToolPolicy = {
    allowedTools: string[];
    disallowedTools: string[];
};

type NativeToolRule = {
    name: string;
    requiresExecuteCommand?: boolean;
    requiresHttpRequest?: boolean;
};

const CORE_NATIVE_TOOLS: NativeToolRule[] = [
    { name: 'Agent' },
    { name: 'AskUserQuestion' },
    { name: 'ListMcpResources' },
    { name: 'ReadMcpResource' },
    { name: 'Mcp' },
    { name: 'WebSearch' },
];

const SHELL_AND_FS_TOOLS: NativeToolRule[] = [
    { name: 'Bash', requiresExecuteCommand: true },
    { name: 'BashOutput', requiresExecuteCommand: true },
    { name: 'FileEdit', requiresExecuteCommand: true },
    { name: 'FileRead', requiresExecuteCommand: true },
    { name: 'FileWrite', requiresExecuteCommand: true },
    { name: 'Glob', requiresExecuteCommand: true },
    { name: 'Grep', requiresExecuteCommand: true },
    { name: 'KillShell', requiresExecuteCommand: true },
    { name: 'NotebookEdit', requiresExecuteCommand: true },
];

const NETWORK_TOOLS: NativeToolRule[] = [
    { name: 'WebFetch', requiresHttpRequest: true },
];

const EXPLICIT_DENYLIST = ['ExitPlanMode', 'TimeMachine', 'TodoWrite'];

// Manual schema definitions for common n8n tools that might not have proper schema.shape
const TOOL_SCHEMAS: Record<string, any> = {
    'Calculator': {
        input: z.string().describe('A mathematical expression to evaluate, e.g., "2+2" or "sqrt(16)"'),
    },
};

interface SchemaExtractor {
    name: string;
    extract: (tool: any, logger?: DebugLogger) => any | null;
}

const SCHEMA_EXTRACTORS: SchemaExtractor[] = [
    {
        name: 'Direct Zod schema.shape',
        extract: (tool: any) => tool.schema?.shape || null,
    },
    {
        name: 'Nested ZodEffects wrapper',
        extract: (tool: any) => {
            const nestedShape = tool.schema?._def?.schema?._def?.shape;
            return nestedShape ? nestedShape() : null;
        },
    },
    {
        name: 'Manual schema fallback',
        extract: (tool: any) => TOOL_SCHEMAS[tool.name] || null,
    },
    {
        name: 'Empty object default',
        extract: () => ({}),
    },
];

// Configuration for schema extraction pipeline
const SCHEMA_CONFIG = {
    enableManualSchemas: process.env.ENABLE_MANUAL_SCHEMAS !== 'false', // Default: true
    enableLogging: process.env.SCHEMA_DEBUG_LOGGING === 'true', // Default: false
};

function getActiveExtractors(): SchemaExtractor[] {
    return SCHEMA_EXTRACTORS.filter(extractor => {
        if (extractor.name === 'Manual schema fallback') {
            return SCHEMA_CONFIG.enableManualSchemas;
        }
        return true;
    });
}

function sanitizeServerName(name: string): string {
    return (name || 'n8n-tools').replace(/[^a-zA-Z0-9_]/g, '_');
}

function groupTools(tools: any[]): ToolGrouping {
    const bySource: Record<string, any[]> = {};
    const mcpClients: any[] = [];
    let hasExecuteCommandNode = false;
    let hasHttpRequestNode = false;

    for (const toolItem of tools) {
        if (isMcpClient(toolItem)) {
            mcpClients.push(toolItem);
            continue;
        }

        const sourceName = toolItem.metadata?.sourceNodeName || 'n8n-tools';
        if (!bySource[sourceName]) {
            bySource[sourceName] = [];
        }

        const nodeType = toolItem.metadata?.nodeType || toolItem.nodeType || '';
        const normalizedNodeType = nodeType.toLowerCase();
        hasExecuteCommandNode ||= normalizedNodeType.includes('executecommand') || toolItem.name?.toLowerCase().includes('execute_command');
        hasHttpRequestNode ||= normalizedNodeType.includes('httprequest') || toolItem.name?.toLowerCase().includes('http_request');

        bySource[sourceName].push(toolItem);
    }

    return {
        bySource,
        hasExecuteCommandNode,
        hasHttpRequestNode,
        mcpClients,
    };
}

function computeAllowedFromRules(rules: NativeToolRule[], grouping: ToolGrouping): {
    allowed: string[];
    disallowed: string[];
} {
    const allowed: string[] = [];
    const disallowed: string[] = [];

    for (const rule of rules) {
        const needsExecuteCommand = rule.requiresExecuteCommand && !grouping.hasExecuteCommandNode;
        const needsHttpRequest = rule.requiresHttpRequest && !grouping.hasHttpRequestNode;

        if (needsExecuteCommand || needsHttpRequest) {
            disallowed.push(rule.name);
        } else {
            allowed.push(rule.name);
        }
    }

    return { allowed, disallowed };
}

export function buildNativeToolPolicy(grouping: ToolGrouping, logger?: DebugLogger): NativeToolPolicy {
    const allowed: string[] = [];
    const disallowed: string[] = [];

    const ruleGroups = [CORE_NATIVE_TOOLS, SHELL_AND_FS_TOOLS, NETWORK_TOOLS];
    for (const group of ruleGroups) {
        const { allowed: groupAllowed, disallowed: groupDisallowed } = computeAllowedFromRules(group, grouping);
        allowed.push(...groupAllowed);
        disallowed.push(...groupDisallowed);
    }

    disallowed.push(...EXPLICIT_DENYLIST);

    if (logger) {
        logger.log('Native tool policy computed', {
            allowed,
            disallowed,
            hasExecuteCommandNode: grouping.hasExecuteCommandNode,
            hasHttpRequestNode: grouping.hasHttpRequestNode,
        });
    }

    return { allowedTools: allowed, disallowedTools: disallowed };
}

export async function processToolsForAgent(
    tools: any[],
    options: { verbose: boolean },
    logger: DebugLogger
): Promise<{
    mcpServers: Record<string, any>;
    allowedTools: string[];
    disallowedTools: string[];
    resourceDiscoveries: Record<string, any[]>;
}> {
    const mcpServers: Record<string, any> = {};
    const allowedTools = new Set<string>();
    const disallowedTools = new Set<string>();
    const resourceDiscoveries: Record<string, any[]> = {};

    const normalizedTools = Array.isArray(tools) ? tools : [];
    const grouping = groupTools(normalizedTools);
    const nativePolicy = buildNativeToolPolicy(grouping, logger);
    nativePolicy.allowedTools.forEach((name) => allowedTools.add(name));
    nativePolicy.disallowedTools.forEach((name) => disallowedTools.add(name));

    if (normalizedTools.length > 0) {
        logger.log(
            `Found ${normalizedTools.length} tools`,
            normalizedTools.map((t: any) => ({
                name: t.name,
                description: t.description,
                source: t.metadata?.sourceNodeName,
            })),
        );

        logger.log('Grouped tools by source:', Object.keys(grouping.bySource));
        logger.log(`HTTP Request node ${grouping.hasHttpRequestNode ? 'FOUND' : 'NOT FOUND'}`);
        logger.log(`Execute Command node ${grouping.hasExecuteCommandNode ? 'FOUND' : 'NOT FOUND'}`);

        for (const [sourceName, sourceTools] of Object.entries(grouping.bySource)) {
            const sdkTools = await adaptN8nToolsToMcp(sourceTools, {
                verbose: options.verbose,
                hasHttpRequestNode: grouping.hasHttpRequestNode,
            }, logger);

            const serverName = sanitizeServerName(sourceName);
            allowedToolsFromSdk(sdkTools).forEach((name) => allowedTools.add(name));

            logger.log(`Creating MCP server '${serverName}' with ${sdkTools.length} tools`);
            mcpServers[serverName] = createSdkMcpServer({
                name: serverName,
                tools: sdkTools,
            });
        }

        for (const client of grouping.mcpClients) {
            const { sdkTools, serverName, exposedToolNames, resources } = await adaptMcpClientTool(
                client,
                options.verbose,
                logger,
            );
            if (sdkTools.length === 0) continue;

            exposedToolNames.forEach((name) => allowedTools.add(name));
            const safeName = sanitizeServerName(serverName);
            logger.log(`Creating MCP client server '${safeName}' with ${sdkTools.length} tools`);
            mcpServers[safeName] = createSdkMcpServer({
                name: safeName,
                tools: sdkTools,
            });

            if (resources.length > 0) {
                resourceDiscoveries[safeName] = resources;
            }
        }

        logger.log('MCP servers created successfully');
    } else {
        logger.log('No tools connected');
    }

    return {
        mcpServers,
        allowedTools: Array.from(allowedTools),
        disallowedTools: Array.from(disallowedTools),
        resourceDiscoveries,
    };
}

function isMcpClient(toolItem: any): boolean {
    return !!(toolItem && typeof toolItem.listTools === 'function' && typeof toolItem.callTool === 'function');
}

function allowedToolsFromSdk(sdkTools: any[]): string[] {
    return sdkTools.map((sdkTool) => sdkTool.name).filter(Boolean);
}

async function adaptN8nToolsToMcp(
    sourceTools: any[],
    options: { verbose: boolean; hasHttpRequestNode: boolean },
    logger: DebugLogger,
): Promise<any[]> {
    const sdkTools = await adaptToMcpTools(sourceTools, options.verbose, logger);

    const isExecuteCommand = sourceTools.some((t) => {
        const nodeType = t.metadata?.nodeType || t.nodeType;
        return nodeType && (
            nodeType.toLowerCase().includes('executecommand') ||
            t.name.toLowerCase().includes('execute_command')
        );
    });

    const isHttpRequest = sourceTools.some((t) => {
        const nodeType = t.metadata?.nodeType || t.nodeType;
        return nodeType && (
            nodeType.toLowerCase().includes('httprequest') ||
            t.name.toLowerCase().includes('http_request')
        );
    });

    if (isExecuteCommand) {
        logger.log('Found Execute Command node in group. Renaming tools to Bash to override default.');
        sdkTools.forEach(t => {
            if (t.name.toLowerCase().includes('execute')) {
                t.name = 'Bash';
                t.description = 'Execute a bash command on the n8n server. Use this for all shell commands.';

                // If no HTTP Request node is connected, ban curl/wget
                if (!options.hasHttpRequestNode) {
                    logger.log('No HTTP Request node connected. Banning curl/wget in Bash tool.');
                    const originalHandler = t.handler;
                    t.handler = async (args: any, extra: any) => {
                        const command = args.command || '';
                        if (typeof command === 'string') {
                            const lowerCmd = command.toLowerCase();
                            // Simple check for curl/wget
                            if (
                                lowerCmd.startsWith('curl ') ||
                                lowerCmd.startsWith('wget ') ||
                                lowerCmd.includes(' curl ') ||
                                lowerCmd.includes(' wget ') ||
                                lowerCmd.includes('|curl ') ||
                                lowerCmd.includes('|wget ')
                            ) {
                                throw new Error('Network access via curl/wget is disabled because no HTTP Request node is connected. Please connect an HTTP Request node to enable web fetching.');
                            }
                        }
                        return originalHandler(args, extra);
                    };
                }
            }
        });
    }

    if (isHttpRequest) {
        logger.log('Found HTTP Request node in group. Renaming tools to WebFetch to override default.');
        sdkTools.forEach(t => {
            // Rename the tool to 'WebFetch' so the agent uses it for web requests
            if (t.name.toLowerCase().includes('http')) {
                t.name = 'WebFetch';
                t.description = 'Fetch content from a URL. Use this for all web requests.';
            }
        });
    }

    return sdkTools;
}

async function adaptMcpClientTool(
    toolItem: any,
    verbose: boolean,
    logger: DebugLogger,
): Promise<{ sdkTools: any[]; serverName: string; exposedToolNames: string[]; resources: any[] }> {
    const sdkTools: any[] = [];
    const exposedToolNames: string[] = [];
    const serverName = toolItem.metadata?.sourceNodeName || toolItem.name || 'mcp-client';
    const resources: any[] = [];

    if (typeof toolItem.listTools === 'function') {
        try {
            const discovery = await toolItem.listTools();
            const tools = Array.isArray(discovery?.tools) ? discovery.tools : [];

            for (const discovered of tools) {
                const name = discovered.name || 'mcp_tool';
                const description = discovered.description || 'Tool exposed by MCP client';
                const inputSchema = discovered.inputSchema || discovered.schema || {};

                exposedToolNames.push(name);
                sdkTools.push(tool(name, description, inputSchema, async (args: any) => {
                    const result = await toolItem.callTool(name, args);
                    return {
                        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
                        isError: false,
                    };
                }));
            }

            if (verbose) {
                logger.log('Discovered MCP client tools', { serverName, exposedToolNames });
            }
        } catch (error) {
            logger.logError('Failed to discover MCP client tools', error);
        }
    }

    if (typeof toolItem.listResources === 'function') {
        try {
            const resourceResult = await toolItem.listResources();
            const discoveredResources = Array.isArray(resourceResult?.resources)
                ? resourceResult.resources
                : [];
            resources.push(...discoveredResources);

            if (verbose) {
                logger.log('Discovered MCP client resources', {
                    serverName,
                    resourceCount: discoveredResources.length,
                    resources: discoveredResources.map((r: any) => r?.name || r?.uri || 'unknown'),
                });
            }
        } catch (error) {
            logger.logError('Failed to list MCP client resources', error);
        }
    }

    return { sdkTools, serverName, exposedToolNames, resources };
}

function extractSchemaShape(tool: any, logger?: DebugLogger): any {
    const activeExtractors = getActiveExtractors();

    for (const extractor of activeExtractors) {
        try {
            const result = extractor.extract(tool, logger);
            if (result !== null && result !== undefined) {
                logger?.log(`✓ Using ${extractor.name} for ${tool.name}`);
                return result;
            }
        } catch (error) {
            logger?.log(`✗ ${extractor.name} failed for ${tool.name}: ${error.message}`);
        }
    }

    logger?.log(`! Using empty schema as final fallback for ${tool.name}`);
    return {};
}

export async function adaptToMcpTools(tools: any[], verbose: boolean = false, logger?: DebugLogger): Promise<any[]> {
    if (!tools || tools.length === 0) {
        return [];
    }

    return tools.map((t: any) => {
        // Check if this is already an SDK tool (created with tool() from @anthropic-ai/claude-agent-sdk)
        // SDK tools have a handler function but no invoke/call methods
        // They're already in the correct format and don't need adaptation
        // Check multiple ways to detect SDK tools:
        // 1. Has handler but no invoke/call (SDK tool structure)
        // 2. Has _def.handler (internal SDK structure)
        // 3. Is a function itself (some SDK tool formats)
        const hasInvokeOrCall = t && (typeof t.invoke === 'function' || typeof t.call === 'function');
        const hasHandler = t && (typeof t.handler === 'function' || (t._def && typeof t._def.handler === 'function'));
        const isSdkTool = t && typeof t === 'object' && !hasInvokeOrCall && hasHandler;
        
        if (isSdkTool) {
            if (verbose && logger) {
                logger.log(`Tool ${t.name} is already an SDK tool (has handler, no invoke/call), skipping adaptation`);
            }
            // Return SDK tool as-is - it's already in the correct format
            return t;
        }

        // Assuming LangChain tool structure
        // t.schema is usually a Zod schema. We need the shape for the SDK tool definition.
        // If schema is missing or doesn't have shape, default to empty object.

        if (verbose && logger) {
            logger.log(`Processing tool: ${t.name}`);
            logger.log('Tool object keys:', Object.keys(t));

            // Enhanced Metadata Logging based on AI_TOOL_NODE_TYPES.md
            logger.log(`Tool Description: ${t.description}`);

            // Check for n8n specific metadata
            if ('metadata' in t) {
                logger.log('Tool Metadata Object:', t.metadata);
            }

            // Check for properties mentioned in AI_TOOL_NODE_TYPES.md
            const n8nProps = ['nodeType', 'sourceNodeName', 'isFromToolkit', 'displayName', 'category', 'originalService'];
            const foundProps: Record<string, any> = {};

            n8nProps.forEach(prop => {
                if (prop in t) foundProps[prop] = t[prop];
                // Also check in metadata if it exists
                if (t.metadata && prop in t.metadata) foundProps[`metadata.${prop}`] = t.metadata[prop];
            });

            if (Object.keys(foundProps).length > 0) {
                logger.log('Found n8n Tool Properties:', foundProps);

                // Derive category if nodeType is available
                const nodeType = foundProps['nodeType'] || foundProps['metadata.nodeType'];
                if (typeof nodeType === 'string') {
                    logger.log('Derived Tool Category:', {
                        isDedicatedAiTool: nodeType.startsWith('tool'),
                        isConvertedUsableTool: nodeType.endsWith('Tool'),
                        originalService: nodeType.endsWith('Tool') ? nodeType.slice(0, -4) : null
                    });
                }
            }

            logger.log('Schema type:', typeof t.schema);
            logger.log('Schema:', t.schema);
            if (t.schema) {
                logger.log('Schema keys:', Object.keys(t.schema));
                logger.log('Schema.shape:', t.schema.shape);
                logger.log('Schema._def:', t.schema._def);

                // Try to inspect deeper into Zod schema structure
                if (t.schema._def && t.schema._def.schema) {
                    logger.log('Schema._def.schema:', t.schema._def.schema);
                    if (t.schema._def.schema._def) {
                        logger.log('Schema._def.schema._def:', t.schema._def.schema._def);
                        if (t.schema._def.schema._def.shape) {
                            logger.log('Schema._def.schema._def.shape():', t.schema._def.schema._def.shape());
                        }
                    }
                }
            }
        }

        // Extract schema using the pipeline
        const schemaShape = extractSchemaShape(t, verbose ? logger : undefined);
        if (verbose && logger) {
            logger.log(`Extracted schema for ${t.name} using pipeline`);
        }

        return tool(t.name, t.description, schemaShape, async (args) => {
            try {
                // Try to use invoke if available (newer LangChain), fallback to call
                // invoke() handles input unification (e.g. string vs object) better than call()
                if (!t.invoke && !t.call) {
                    throw new Error(`Tool ${t.name} has neither invoke nor call method. Cannot execute.`);
                }
                const method = t.invoke ? t.invoke.bind(t) : t.call.bind(t);

                // The SDK wraps tool calls with metadata (signal, _meta, requestId)
                // We need to extract the actual tool input and unwrap it properly
                let input = args;

                // Remove SDK metadata wrapper
                if (args && typeof args === 'object') {
                    const { signal, _meta, requestId, ...actualArgs } = args;

                    // If there's an 'input' field after unwrapping, use that
                    if ('input' in actualArgs) {
                        input = actualArgs.input as any;
                        if (verbose && logger) logger.log(`Unwrapped input field for ${t.name}: "${input}"`);
                    }
                    // Otherwise use the cleaned args
                    else if (Object.keys(actualArgs).length > 0) {
                        input = actualArgs;
                        if (verbose && logger) logger.log(`Using cleaned args for ${t.name}:`, actualArgs);
                    }
                    // If args is completely empty after removing metadata, keep original args
                    else {
                        if (verbose && logger) logger.log(`No input provided for ${t.name}, using original args`);
                    }
                }

                if (verbose && logger) {
                    logger.log(`Calling tool ${t.name} with original args:`, args);
                    logger.log(`Calling tool ${t.name} with processed input:`, input);
                }

                const result = await method(input);

                if (verbose && logger) {
                    logger.log(`Tool ${t.name} result:`, result);
                }

                return {
                    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
                    isError: false,
                };
            } catch (err: any) {
                if (logger) {
                    logger.logError(`Tool ${t.name} execution failed`, err);
                } else {
                    console.error(`[ClaudeAgent] Tool ${t.name} error:`, err);
                }
                return {
                    content: [{ type: 'text', text: `Error executing tool ${t.name}: ${err.message}` }],
                    isError: true,
                };
            }
        });
    });
}