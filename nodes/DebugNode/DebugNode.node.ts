import fs from 'fs';
import path from 'path';
import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import * as LoggerProxy from 'n8n-workflow/dist/cjs/logger-proxy';

type ConsoleMethods = 'log' | 'info' | 'warn' | 'error' | 'debug';

type HookOptions = {
    captureConsole: boolean;
    captureStdIo: boolean;
    captureLoggerProxy: boolean;
    includeWorkflowContext: boolean;
    traceNodeIO: boolean;
};

type WorkflowContext = {
    workflowId?: string;
    workflowName?: string;
    workflowActive?: boolean;
    workflowSettings?: Record<string, unknown>;
    nodeName?: string;
    nodeType?: string;
    nodeVersion?: number;
    executionId?: string;
    mode?: string;
    rawWorkflow?: unknown;
    rawNode?: unknown;
};

type HookState = {
    filePath: string;
    startedAt: string;
    restore: () => void;
    options: HookOptions;
    workflowContext?: WorkflowContext;
};

type HookInstallResult = {
    state: HookState;
    alreadyActive: boolean;
};

type GlobalWithDebugHook = typeof globalThis & {
    __N8N_DEBUG_NODE_HOOK__?: HookState;
};

function formatLogLine(level: string, messages: any[], context?: WorkflowContext): string {
    const timestamp = new Date().toISOString();
    const rendered = messages
        .map((entry) => {
            if (typeof entry === 'string') return entry;
            try {
                return JSON.stringify(entry);
            } catch {
                return String(entry);
            }
        })
        .join(' ');

    const contextFragment = context ? ` [WF:${context.workflowId || context.workflowName || 'unknown'}]` : '';

    return `[${timestamp}] [${level}]${contextFragment} ${rendered}\n`;
}

function resolveLogDirectory(userProvided?: string): string {
    if (userProvided) return path.resolve(userProvided);
    if (process.env.N8N_DEBUG_LOG_DIR) return path.resolve(process.env.N8N_DEBUG_LOG_DIR);
    if (process.env.N8N_LOG_DIR) return path.resolve(process.env.N8N_LOG_DIR);
    if (process.env.HOME) return path.join(process.env.HOME, 'n8n-debug-logs');
    return path.join(process.cwd(), 'logs');
}

function createLogFilePath(logDirectory: string, customFileName?: string): string {
    const dir = resolveLogDirectory(logDirectory);
    const name =
        customFileName?.trim() ||
        `n8n-server-${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_')}.log`;

    return path.join(dir, name);
}

function installLogHook(
    logDirectory?: string,
    customFileName?: string,
    options?: Partial<HookOptions>,
    workflowContext?: WorkflowContext,
): HookInstallResult {
    const globalWithHook = global as GlobalWithDebugHook;
    if (globalWithHook.__N8N_DEBUG_NODE_HOOK__) {
        return { state: globalWithHook.__N8N_DEBUG_NODE_HOOK__, alreadyActive: true };
    }

    const hookOptions: HookOptions = {
        captureConsole: options?.captureConsole ?? true,
        captureStdIo: options?.captureStdIo ?? true,
        captureLoggerProxy: options?.captureLoggerProxy ?? true,
        includeWorkflowContext: options?.includeWorkflowContext ?? true,
        traceNodeIO: options?.traceNodeIO ?? true,
    };

    const filePath = createLogFilePath(logDirectory, customFileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stream = fs.createWriteStream(filePath, { flags: 'a' });

    const restoreFns: Array<() => void> = [];

    let hookState: HookState;

    const writeLine = (level: string, messages: any[]) => {
        try {
            stream.write(formatLogLine(level, messages, hookState?.workflowContext));
        } catch (error) {
            console.error('[DebugNode] Failed to write log line', error);
        }
    };

    const traceEvent = (eventName: string, payload: any[]) => {
        if (!hookOptions.traceNodeIO) return;
        if (typeof eventName !== 'string') return;
        const normalizedName = eventName.toLowerCase();
        if (
            normalizedName.includes('nodeexecute') ||
            normalizedName.includes('workflowexecute') ||
            normalizedName.includes('n8n.node')
        ) {
            writeLine(`TRACE/${eventName}`, payload);
        }
    };

    if (hookOptions.captureConsole) {
        const original: Record<ConsoleMethods, (...args: any[]) => void> = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        };

        (['log', 'info', 'warn', 'error', 'debug'] as ConsoleMethods[]).forEach((method) => {
            console[method] = (...args: any[]) => {
                writeLine(`CONSOLE/${method.toUpperCase()}`, args);
                return original[method].apply(console, args);
            };
        });

        restoreFns.push(() => {
            (['log', 'info', 'warn', 'error', 'debug'] as ConsoleMethods[]).forEach((method) => {
                console[method] = original[method];
            });
        });
    }

    if (hookOptions.captureStdIo) {
        const originalStdout = process.stdout.write;
        const originalStderr = process.stderr.write;

        process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
            writeLine('STDOUT', [chunk?.toString?.() ?? chunk]);
            return originalStdout.call(process.stdout, chunk, encoding, cb);
        }) as typeof process.stdout.write;

        process.stderr.write = ((chunk: any, encoding?: any, cb?: any) => {
            writeLine('STDERR', [chunk?.toString?.() ?? chunk]);
            return originalStderr.call(process.stderr, chunk, encoding, cb);
        }) as typeof process.stderr.write;

        restoreFns.push(() => {
            process.stdout.write = originalStdout;
            process.stderr.write = originalStderr;
        });
    }

    if (hookOptions.traceNodeIO) {
        const originalEmit = process.emit;
        process.emit = function (this: any, eventName: any, ...args: any[]) {
            try {
                traceEvent(String(eventName), args);
            } catch (error) {
                console.error('[DebugNode] Failed to trace event', error);
            }
            return originalEmit.call(this, eventName, ...args);
        };

        restoreFns.push(() => {
            process.emit = originalEmit;
        });
    }

    if (hookOptions.captureLoggerProxy) {
        const originalLoggerProxy = {
            error: LoggerProxy.error,
            warn: LoggerProxy.warn,
            info: LoggerProxy.info,
            debug: LoggerProxy.debug,
        };

        (['error', 'warn', 'info', 'debug'] as const).forEach((level) => {
            (LoggerProxy as any)[level] = (message: string, meta?: any) => {
                writeLine(`LOGGER/${level.toUpperCase()}`, [message, meta]);
                return originalLoggerProxy[level](message, meta);
            };
        });

        restoreFns.push(() => {
            (['error', 'warn', 'info', 'debug'] as const).forEach((level) => {
                (LoggerProxy as any)[level] = originalLoggerProxy[level];
            });
        });
    }

    const restore = () => {
        restoreFns.forEach((fn) => fn());
        stream.end();
        delete (global as GlobalWithDebugHook).__N8N_DEBUG_NODE_HOOK__;
    };

    hookState = {
        filePath,
        startedAt: new Date().toISOString(),
        restore,
        options: hookOptions,
        workflowContext,
    };

    (global as GlobalWithDebugHook).__N8N_DEBUG_NODE_HOOK__ = hookState;
    if (hookOptions.includeWorkflowContext) {
        writeLine('DEBUG_NODE', ['Hook installed', hookOptions, { workflowContext }]);
    } else {
        writeLine('DEBUG_NODE', ['Hook installed', hookOptions]);
    }

    return { state: hookState, alreadyActive: false };
}

export class DebugNode implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Debug Node',
        name: 'debugNode',
        icon: 'file:img/debug.svg',
        group: ['transform'],
        version: 1,
        description: 'Capture all n8n server logs into a configured directory',
        usableAsTool: false,
        defaults: {
            name: 'Debug Node',
        },
        inputs: ['main'],
        outputs: ['main'],
        properties: [
            {
                displayName: 'Log Directory',
                name: 'logDirectory',
                type: 'string',
                default: '={{ $env.N8N_DEBUG_LOG_DIR || $env.N8N_LOG_DIR || ($env.HOME && $env.HOME + "/n8n-debug-logs") || "/tmp/n8n-debug-logs" }}',
                description: 'Directory where aggregated server logs will be written',
            },
            {
                displayName: 'File Name',
                name: 'fileName',
                type: 'string',
                default: '',
                placeholder: 'Leave empty to auto-generate a timestamped file',
            },
            {
                displayName: 'Capture Console Methods',
                name: 'captureConsole',
                type: 'boolean',
                default: true,
                description: 'Whether to capture console.log/info/warn/error/debug output',
            },
            {
                displayName: 'Capture Stdout/Stderr',
                name: 'captureStdIo',
                type: 'boolean',
                default: true,
                description: 'Whether to capture low-level stdout/stderr writes from the n8n process',
            },
            {
                displayName: 'Capture LoggerProxy',
                name: 'captureLoggerProxy',
                type: 'boolean',
                default: true,
                description: 'Whether to tap into the LoggerProxy used internally by n8n for server logs',
            },
            {
                displayName: 'Include Workflow Context',
                name: 'includeWorkflowContext',
                type: 'boolean',
                default: true,
                description: 'Whether to enrich log lines with workflow metadata (id, name, node, mode, etc.)',
            },
            {
                displayName: 'Trace Node Inputs/Outputs',
                name: 'traceNodeIO',
                type: 'boolean',
                default: true,
                description: 'Attempt to trace node and workflow execution events by tapping into process event emissions',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const logDirectory = this.getNodeParameter('logDirectory', 0) as string;
        const fileName = this.getNodeParameter('fileName', 0) as string;
        const captureConsole = this.getNodeParameter('captureConsole', 0) as boolean;
        const captureStdIo = this.getNodeParameter('captureStdIo', 0) as boolean;
        const captureLoggerProxy = this.getNodeParameter('captureLoggerProxy', 0) as boolean;
        const includeWorkflowContext = this.getNodeParameter('includeWorkflowContext', 0) as boolean;
        const traceNodeIO = this.getNodeParameter('traceNodeIO', 0) as boolean;

        const workflow = this.getWorkflow?.();
        const node = this.getNode?.();
        const executionId = (this as any).getExecutionId?.();
        const mode = (this as any).getMode?.();
        const workflowData = this.getWorkflowData?.();

        const workflowContext: WorkflowContext | undefined = includeWorkflowContext
            ? {
                  workflowId: workflow?.id?.toString?.() ?? workflowData?.id?.toString?.(),
                  workflowName: workflow?.name ?? workflowData?.name,
                  workflowActive: workflow?.active ?? workflowData?.active,
                  workflowSettings: (workflow as any)?.settings ?? workflowData?.settings,
                  nodeName: node?.name,
                  nodeType: node?.type,
                  nodeVersion: node?.typeVersion,
                  executionId: executionId?.toString?.(),
                  mode,
                  rawWorkflow: includeWorkflowContext ? workflowData ?? workflow : undefined,
                  rawNode: includeWorkflowContext ? node : undefined,
              }
            : undefined;

        const { state: hookState, alreadyActive } = installLogHook(
            logDirectory,
            fileName,
            {
                captureConsole,
                captureStdIo,
                captureLoggerProxy,
                includeWorkflowContext,
                traceNodeIO,
            },
            workflowContext,
        );

        const returnItems = items.map((item) => ({
            json: {
                ...item.json,
                logFilePath: hookState.filePath,
                startedAt: hookState.startedAt,
                options: hookState.options,
                alreadyActive,
            },
        }));

        return [returnItems];
    }
}
