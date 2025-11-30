import * as fs from 'fs';
import * as path from 'path';
import { formatTurnsFromData } from './turnFormatter';

export class DebugLogger {
    private logDir: string;
    private logFile: string = '';
    private enabled: boolean;
    private prefix: string;

    private turns: any[] = [];

    constructor(enabled: boolean = false, prefix: string = '') {
        this.enabled = enabled;
        this.prefix = prefix;

        // Determine log directory with priority:
        // 1. Environment variable CLAUDE_AGENT_LOG_DIR
        // 2. Home directory ~/claude-agent-logs
        // 3. Current working directory /logs (fallback)
        if (process.env.CLAUDE_AGENT_LOG_DIR) {
            this.logDir = process.env.CLAUDE_AGENT_LOG_DIR;
        } else if (process.env.HOME) {
            this.logDir = path.join(process.env.HOME, 'claude-agent-logs');
        } else {
            const cwd = process.cwd();
            this.logDir = path.join(cwd, 'logs');
        }

        if (this.enabled) {
            // Create debug directory if it doesn't exist
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }

            // Create timestamped log file
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            this.logFile = path.join(this.logDir, `debug-${timestamp}.log`);

            this.log(`${this.prefix}=== Claude Agent Debug Log ===`);
            this.log(`${this.prefix}Started at: ${new Date().toISOString()}`);
            this.log(`${this.prefix}Log file: ${this.logFile}`);
            this.log(`${this.prefix}Log directory: ${this.logDir}`);
            this.log('');
        }
    }

    log(message: string, data?: any) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        let logEntry = `[${timestamp}] ${this.prefix}${message}`;

        if (data !== undefined) {
            logEntry += '\n' + JSON.stringify(data, null, 2);
        }

        logEntry += '\n';

        try {
            fs.appendFileSync(this.logFile, logEntry);
            console.log(`[DebugLogger] ${message}`);
        } catch (error) {
            console.error('[DebugLogger] Failed to write log:', error);
        }
    }

    logTurn(turn: any) {
        if (!this.enabled) return;

        // Add to turns collection for markdown generation
        this.turns.push(turn);

        // Also log to standard log file
        this.log('Turn received:', turn);
    }

    finalize() {
        if (!this.enabled || this.turns.length === 0) return;

        try {
            // Generate markdown content
            // We need to dynamically import or require the utility since it might be outside the nodes directory structure
            // depending on how n8n loads nodes. For now, we'll try to use the imported function.
            // Note: In a real n8n node environment, we might need to bundle this utility or handle it differently.
            // Assuming the build process handles the import correctly.
            const markdown = formatTurnsFromData(this.turns);

            // Create markdown file path (same as log file but .md)
            const mdFile = this.logFile.replace('.log', '.md');

            fs.writeFileSync(mdFile, markdown);
            this.log(`Markdown log generated: ${mdFile}`);
        } catch (error) {
            this.logError('Failed to generate markdown log', error);
        }
    }

    logSection(title: string) {
        if (!this.enabled) return;

        const separator = '='.repeat(60);
        this.log(`${separator}`);
        this.log(`${this.prefix}${title}`);
        this.log(`${separator}`);
    }

    logWarning(message: string, data?: any) {
        if (!this.enabled) return;

        this.log(`⚠️  WARNING: ${message}`, data);
    }

    logError(message: string, error: any) {
        if (!this.enabled) return;

        this.logSection(`ERROR: ${message}`);
        this.log('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            name: error.name,
            ...error,
        });
    }

    getLogPath(): string {
        return this.enabled ? this.logFile : 'Debug logging disabled';
    }
}
