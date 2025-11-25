import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { DebugLogger } from './DebugLogger';

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

export async function processToolsForAgent(
    tools: any[],
    options: { verbose: boolean },
    logger: DebugLogger
): Promise<{ mcpServers: Record<string, any>; disallowedTools: string[] }> {
    const mcpServers: Record<string, any> = {};
    let toolsCount = 0;

    if (tools && tools.length > 0) {
        toolsCount = tools.length;
        logger.log(`Found ${toolsCount} tools`, tools.map((t: any) => ({
            name: t.name,
            description: t.description,
            source: t.metadata?.sourceNodeName
        })));

        // Group tools by source node to create distinct MCP servers
        const toolsBySource: Record<string, any[]> = {};

        for (const tool of tools) {
            // Use sourceNodeName as the grouping key, fallback to 'n8n-tools'
            // For MCP Client tools, this will group them by the client node name
            const sourceName = tool.metadata?.sourceNodeName || 'n8n-tools';
            if (!toolsBySource[sourceName]) {
                toolsBySource[sourceName] = [];
            }
            toolsBySource[sourceName].push(tool);
        }

        logger.log('Grouped tools by source:', Object.keys(toolsBySource));

        // Check for HTTP Request node globally to determine if we should allow curl/wget
        const hasHttpRequestNode = tools.some(t => {
            const nodeType = t.metadata?.nodeType || t.nodeType;
            return nodeType && (
                nodeType.toLowerCase().includes('httprequest') ||
                t.name.toLowerCase().includes('http_request')
            );
        });

        logger.log(`Global check: HTTP Request node ${hasHttpRequestNode ? 'FOUND' : 'NOT FOUND'}`);

        // Create an MCP server for each group
        for (const [sourceName, sourceTools] of Object.entries(toolsBySource)) {
            const sdkTools = await adaptToMcpTools(sourceTools, options.verbose, logger);

            // Sanitize server name (alphanumeric and underscores only)
            // e.g. "My MCP Client" -> "My_MCP_Client"
            const serverName = sourceName.replace(/[^a-zA-Z0-9_]/g, '_');

            // Check if this group contains an "Execute Command" node
            const isExecuteCommand = sourceTools.some(t => {
                const nodeType = t.metadata?.nodeType || t.nodeType;
                return nodeType && (
                    nodeType.toLowerCase().includes('executecommand') ||
                    t.name.toLowerCase().includes('execute_command')
                );
            });

            // Check if this group contains an "HTTP Request" node
            const isHttpRequest = sourceTools.some(t => {
                const nodeType = t.metadata?.nodeType || t.nodeType;
                return nodeType && (
                    nodeType.toLowerCase().includes('httprequest') ||
                    t.name.toLowerCase().includes('http_request')
                );
            });

            if (isExecuteCommand) {
                logger.log(`Found Execute Command node in group ${sourceName}. Renaming tools to 'Bash' to override default.`);
                sdkTools.forEach(t => {
                    if (t.name.toLowerCase().includes('execute')) {
                        t.name = 'Bash';
                        t.description = 'Execute a bash command on the n8n server. Use this for all shell commands.';

                        // If no HTTP Request node is connected, ban curl/wget
                        if (!hasHttpRequestNode) {
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
                logger.log(`Found HTTP Request node in group ${sourceName}. Renaming tools to 'WebFetch' to override default.`);
                sdkTools.forEach(t => {
                    // Rename the tool to 'WebFetch' so the agent uses it for web requests
                    if (t.name.toLowerCase().includes('http')) {
                        t.name = 'WebFetch';
                        t.description = 'Fetch content from a URL. Use this for all web requests.';
                    }
                });
            }

            logger.log(`Creating MCP server '${serverName}' with ${sdkTools.length} tools`);

            mcpServers[serverName] = createSdkMcpServer({
                name: serverName,
                tools: sdkTools,
            });
        }

        logger.log('MCP servers created successfully');
    } else {
        logger.log('No tools connected');
    }

    return {
        mcpServers,
        disallowedTools: ['Bash', 'WebFetch']
    };
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