import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { DebugLogger } from './debugLogger';
import { BinaryArtifact } from '../interfaces';

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
    logger: DebugLogger,
    binaryArtifacts?: BinaryArtifact[]
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
            const sdkTools = await adaptToMcpTools(sourceTools, options.verbose, logger, binaryArtifacts);

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

export async function adaptToMcpTools(
    tools: any[],
    verbose: boolean = false,
    logger?: DebugLogger,
    binaryArtifacts?: any[]
): Promise<any[]> {
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

        // Enhance description for RunContainer tools
        let enhancedDescription = t.description;
        const nodeType = t.metadata?.nodeType || t.nodeType || '';
        const isRunContainer = nodeType.toLowerCase().includes('runcontainer');

        if (isRunContainer && logger) {
            logger.log(`Detected RunContainer tool: ${t.name}, enhancing description`);

            // Build workspace instructions with default paths
            // Note: If users change workspaceMountPath, binaryInputPath, or outputDirectory,
            // they should update the tool description accordingly
            const workspaceInstructions = '\n\nWorkspace: A persistent volume is mounted at /agent/workspace. Use this directory to persist files between turns.';
            enhancedDescription += workspaceInstructions;

            // Check for binary input processing result
            if (t.metadata?.binaryInput) {
                const binaryInput = t.metadata.binaryInput;
                
                if (binaryInput.metadata && binaryInput.metadata.length > 0) {
                    // Use processed binary input metadata
                    const byType = binaryInput.metadata.reduce((acc: any, file: any) => {
                        acc[file.fileType] = (acc[file.fileType] || []).concat(file);
                        return acc;
                    }, {});

                    let fileListing = '\n\nAvailable Input Files:\n';
                    
                    for (const [type, files] of Object.entries(byType)) {
                        fileListing += `\n${type.charAt(0).toUpperCase() + type.slice(1)} Files:\n`;
                        for (const file of files as any[]) {
                            const sizeMB = Math.round(file.fileSize / 1024 / 1024 * 100) / 100;
                            const location = file.filePath ? ` (mounted at ${file.filePath})` : ' (metadata only)';
                            fileListing += `  - ${file.fileName} (${file.mimeType}, ${sizeMB}MB)${location}\n`;
                        }
                    }
                    
                    enhancedDescription += fileListing;
                    logger.log(`Enhanced description with ${binaryInput.metadata.length} processed binary files`);
                }

                // Add warnings about skipped files if any
                if (binaryInput.skippedFiles && binaryInput.skippedFiles.length > 0) {
                    const skippedWarning = `\n\nNote: ${binaryInput.skippedFiles.length} file(s) were skipped:\n${binaryInput.skippedFiles.map((f: any) => `  - ${f.fileName || f.key}: ${f.reason}`).join('\n')}`;
                    enhancedDescription += skippedWarning;
                    logger.logWarning(`Added ${binaryInput.skippedFiles.length} skipped file warnings to description`);
                }
            } else if (t.metadata?.currentItem?.binary) {
                // Fallback to original logic for backward compatibility
                const binaryData = t.metadata.currentItem.binary;
                const fileNames = Object.entries(binaryData).map(([key, data]: [string, any]) => {
                    return data.fileName || key;
                });

                if (fileNames.length > 0) {
                    enhancedDescription += `\n\nInput Files: The following files are available:\n${fileNames.map(f => `  - ${f}`).join('\n')}`;
                    logger.log(`Listed ${fileNames.length} input files in description (legacy mode)`);
                }
            } else {
                // No binary data, just mention where inputs would be
                enhancedDescription += '\n\nIf binary input is enabled, input files will be available to tools.';
            }

            // Add output instructions
            enhancedDescription += '\n\nOutput Files: Place any files you want to return in /agent/workspace/output.';
        }


        return tool(t.name, enhancedDescription, schemaShape, async (args) => {
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

                logger?.log(`Tool ${t.name} execution result:`, {
                    resultType: typeof result,
                    isArray: Array.isArray(result),
                    resultLength: Array.isArray(result) ? result.length : 'N/A',
                    hasBinary: Array.isArray(result) ? result.some((item: any) => item.binary) : 'N/A'
                });

                if (verbose && logger) {
                    logger.log(`Tool ${t.name} result:`, result);
                }

                // Handle binary data from n8n nodes
                let outputText = '';
                if (typeof result === 'string') {
                    outputText = result;
                    
                    // Check if this is a JSON string that might contain binary data
                    try {
                        logger?.log(`JSON parsing attempt for ${t.name}:`, {
                            resultType: typeof result,
                            resultLength: result.length,
                            resultPreview: result.substring(0, 200) + (result.length > 200 ? '...' : '')
                        });
                        
                        let parsedResult = JSON.parse(result);
                        
                        // Debug: Log the full structure to compare with original
                        logger?.log(`Parsed result structure for ${t.name}:`, {
                            isArray: Array.isArray(parsedResult),
                            length: parsedResult.length,
                            firstItemKeys: parsedResult.length > 0 ? Object.keys(parsedResult[0]) : [],
                            fullResult: JSON.stringify(parsedResult, null, 2)
                        });
                        
                        // Handle case where result is a string containing JSON array (double-encoded JSON)
                        if (typeof parsedResult === 'string') {
                            logger?.log(`Tool ${t.name} returned double-encoded JSON string, parsing again...`);
                            // Unescape the string before parsing again
                            const unescapedResult = parsedResult.replace(/\\"/g, '"').replace(/\\\\n/g, '\\n');
                            parsedResult = JSON.parse(unescapedResult);
                        }
                        
                        if (Array.isArray(parsedResult) && parsedResult.length > 0) {
                            logger?.log(`Tool ${t.name} returned JSON array with ${parsedResult.length} items`);
                            
                            // Process as array result for binary extraction
                            for (let i = 0; i < parsedResult.length; i++) {
                                const item = parsedResult[i];
                                logger?.log(`Processing item ${i}:`, {
                                    hasBinary: !!item.binary,
                                    binaryKeys: item.binary ? Object.keys(item.binary) : [],
                                    itemKeys: Object.keys(item)
                                });
                                
                                if (item.binary && binaryArtifacts) {
                                    logger?.log(`Found binary data in item ${i}:`, Object.keys(item.binary));
                                    for (const [key, binaryData] of Object.entries(item.binary)) {
                                        logger?.log(`Processing binary data for key: ${key}`, {
                                            hasData: !!(binaryData as any).data,
                                            fileName: (binaryData as any).fileName,
                                            mimeType: (binaryData as any).mimeType
                                        });
                                        
                                        if (binaryData && (binaryData as any).data) {
                                            const fileName = (binaryData as any).fileName || key;
                                            const mimeType = (binaryData as any).mimeType || 'application/octet-stream';
                                            const dataSize = Buffer.from((binaryData as any).data, 'base64').length;

                                            logger?.log(`Found binary artifact: ${fileName} (${mimeType}, ${dataSize} bytes)`);
                                            logger?.log(`Collecting binary artifact from tool ${t.name}`);

                                            binaryArtifacts.push({
                                                toolName: t.name,
                                                fileName,
                                                mimeType,
                                                data: (binaryData as any).data,
                                                description: `Generated by tool ${t.name}`
                                            });
                                        }
                                    }
                                } else {
                                    logger?.log(`No binary data found in item ${i}`);
                                }
                            }
                        }
                    } catch (parseError) {
                        // Not a JSON string, treat as regular text output
                        logger?.log(`Result is not JSON, treating as text output. Parse error: ${parseError.message}`);
                    }
                } else if (Array.isArray(result) && result.length > 0) {
                    // Handle INodeExecutionData[][] (standard n8n node output) or INodeExecutionData[]
                    let items: any[] = [];

                    if (Array.isArray(result[0])) {
                        // It's INodeExecutionData[][]
                        items = result.flat();
                    } else if (result[0].json) {
                        // It's INodeExecutionData[]
                        items = result;
                    }

                    if (items.length > 0 && items[0].json) {
                        const jsonOutputs: any[] = [];

                        for (const item of items) {
                            if (item.json) {
                                jsonOutputs.push(item.json);
                            }

                            // Check for binary data
                            if (item.binary && binaryArtifacts) {
                                console.log(`[MCP Adapter] Tool ${t.name} returned binary data:`, Object.keys(item.binary));
                                for (const [key, binaryData] of Object.entries(item.binary)) {
                                    if (binaryData && (binaryData as any).data) {
                                        const fileName = (binaryData as any).fileName || key;
                                        const mimeType = (binaryData as any).mimeType || 'application/octet-stream';
                                        const dataSize = Buffer.from((binaryData as any).data, 'base64').length;

                                        logger?.log(`Found binary artifact: ${fileName} (${mimeType})`);
                                        console.log(`[MCP Adapter] Collecting binary artifact: ${fileName} (${mimeType}, ${dataSize} bytes) from tool ${t.name}`);

                                        const artifact: BinaryArtifact = {
                                            toolName: t.name,
                                            fileName,
                                            mimeType,
                                            data: (binaryData as any).data,
                                            fileSize: dataSize,
                                            description: `Generated by tool ${t.name}`,
                                            timestamp: new Date()
                                        };
                                        binaryArtifacts.push(artifact);

                                        // Add reference to output text
                                        jsonOutputs.push({
                                            _binaryFile: {
                                                fileName,
                                                mimeType,
                                                message: `Binary file '${fileName}' has been generated and saved.`
                                            }
                                        });
                                    }
                                }
                            }
                        }
                        outputText = JSON.stringify(jsonOutputs);
                    } else {
                        // Fallback for other array types
                        outputText = JSON.stringify(result);
                    }
                } else {
                    outputText = JSON.stringify(result);
                }

                return {
                    content: [{ type: 'text', text: outputText }],
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