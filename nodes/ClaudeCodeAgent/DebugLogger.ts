import * as fs from 'fs';
import * as path from 'path';

export class DebugLogger {
    private logDir: string;
    private logFile: string = '';
    private enabled: boolean;

    constructor(enabled: boolean = false) {
        this.enabled = enabled;
        // Use logs directory in current working directory or temp directory
        const cwd = process.cwd();
        this.logDir = path.join(cwd, 'logs');

        if (this.enabled) {
            // Create debug directory if it doesn't exist
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }

            // Create timestamped log file
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            this.logFile = path.join(this.logDir, `debug-${timestamp}.log`);

            this.log('=== Claude Code Agent Debug Log ===');
            this.log(`Started at: ${new Date().toISOString()}`);
            this.log(`Log file: ${this.logFile}`);
            this.log(`Log directory: ${this.logDir}`);
            this.log('');
        }
    }

    log(message: string, data?: any) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        let logEntry = `[${timestamp}] ${message}`;

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

    logSection(title: string) {
        if (!this.enabled) return;

        const separator = '='.repeat(60);
        this.log(`\n${separator}`);
        this.log(title);
        this.log(separator);
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
