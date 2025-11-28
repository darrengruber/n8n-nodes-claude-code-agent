/**
 * Docker log parsing utilities
 * Handles Docker multiplexed log format and stream separation
 */

/**
 * Docker log stream types
 */
export enum LogStreamType {
    STDOUT = 1,
    STDERR = 2
}

/**
 * Parsed log entry with stream information
 */
export interface ParsedLogEntry {
    stream: LogStreamType;
    data: Buffer;
    text: string;
    timestamp?: Date;
}

/**
 * Container execution result with parsed logs
 */
export interface ContainerExecutionResult {
    stdout: Buffer;
    stderr: Buffer;
    stdoutText: string;
    stderrText: string;
    exitCode: number;
    logEntries: ParsedLogEntry[];
    hasStdout: boolean;
    hasStderr: boolean;
}

/**
 * Parse Docker multiplexed log format
 * Docker logs use a multiplexed format with 8-byte headers:
 * - 1 byte: stream type (1 = stdout, 2 = stderr)
 * - 3 bytes: padding (unused)
 * - 4 bytes: data size (big-endian)
 * - N bytes: actual log data
 *
 * @param logsBuffer - Raw Docker logs buffer
 * @returns Parsed log entries array
 */
export function parseDockerLogs(logsBuffer: Buffer): ParsedLogEntry[] {
    const entries: ParsedLogEntry[] = [];
    let offset = 0;

    while (offset < logsBuffer.length) {
        // Check if we have enough bytes for a header
        if (offset + 8 > logsBuffer.length) {
            break;
        }

        // Parse header
        const streamType = logsBuffer[offset];
        const size = logsBuffer.readUInt32BE(offset + 4);

        // Validate stream type
        if (streamType !== LogStreamType.STDOUT && streamType !== LogStreamType.STDERR) {
            break;
        }

        // Check if we have enough bytes for the data
        const dataStart = offset + 8;
        const dataEnd = dataStart + size;

        if (dataEnd > logsBuffer.length) {
            break;
        }

        // Extract data
        const data = logsBuffer.slice(dataStart, dataEnd);
        // Remove control characters but preserve essential whitespace (tab, LF, CR)
        const text = data.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        entries.push({
            stream: streamType as LogStreamType,
            data,
            text,
            timestamp: new Date() // Docker doesn't include timestamps in this format
        });

        // Move to next entry
        offset = dataEnd;
    }

    return entries;
}

/**
 * Separate parsed log entries into stdout and stderr buffers
 *
 * @param entries - Parsed log entries
 * @returns Separated stdout and stderr buffers
 */
export function separateLogStreams(entries: ParsedLogEntry[]): {
    stdout: Buffer;
    stderr: Buffer;
    stdoutText: string;
    stderrText: string;
} {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    for (const entry of entries) {
        if (entry.stream === LogStreamType.STDOUT) {
            stdoutChunks.push(entry.data);
            stdoutLines.push(entry.text);
        } else if (entry.stream === LogStreamType.STDERR) {
            stderrChunks.push(entry.data);
            stderrLines.push(entry.text);
        }
    }

    const stdout = Buffer.concat(stdoutChunks);
    const stderr = Buffer.concat(stderrChunks);

    return {
        stdout,
        stderr,
        stdoutText: stdoutLines.join(''),
        stderrText: stderrLines.join('')
    };
}

/**
 * Parse container execution result from Docker logs
 *
 * @param logsBuffer - Raw Docker logs buffer
 * @param exitCode - Container exit code
 * @returns Complete container execution result
 */
export function parseContainerResult(logsBuffer: Buffer, exitCode: number): ContainerExecutionResult {
    const logEntries = parseDockerLogs(logsBuffer);
    const { stdout, stderr, stdoutText, stderrText } = separateLogStreams(logEntries);

    return {
        stdout,
        stderr,
        stdoutText,
        stderrText,
        exitCode,
        logEntries,
        hasStdout: stdout.length > 0,
        hasStderr: stderr.length > 0
    };
}

/**
 * Format container result for n8n output
 *
 * @param result - Container execution result
 * @returns Formatted result object
 */
export function formatContainerResult(result: ContainerExecutionResult): {
    stdout: string;
    stderr: string;
    exitCode: number;
    success: boolean;
    hasOutput: boolean;
} {
    return {
        stdout: result.stdoutText,
        stderr: result.stderrText,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        hasOutput: result.hasStdout || result.hasStderr
    };
}

/**
 * Extract error information from stderr logs
 *
 * @param stderrText - Standard error text
 * @returns Parsed error information
 */
export function parseContainerError(stderrText: string): {
    hasError: boolean;
    errorMessage?: string;
    errorType?: string;
    errorCode?: string;
} {
    if (!stderrText || stderrText.trim().length === 0) {
        return { hasError: false };
    }

    const lines = stderrText.split('\n').filter(line => line.trim());
    const hasError = lines.length > 0;

    if (!hasError) {
        return { hasError: false };
    }

    // Try to extract common error patterns
    const errorMessage = lines[lines.length - 1]; // Usually the last line has the main error
    let errorType: string | undefined;
    let errorCode: string | undefined;

    // Common Docker error patterns
    if (errorMessage.toLowerCase().includes('no such image')) {
        errorType = 'IMAGE_NOT_FOUND';
    } else if (errorMessage.toLowerCase().includes('permission denied')) {
        errorType = 'PERMISSION_ERROR';
    } else if (errorMessage.toLowerCase().includes('command not found')) {
        errorType = 'COMMAND_NOT_FOUND';
    } else if (errorMessage.toLowerCase().includes('exit code')) {
        const match = errorMessage.match(/exit code (\d+)/);
        if (match) {
            errorCode = match[1];
            errorType = 'NON_ZERO_EXIT';
        }
    }

    return {
        hasError,
        errorMessage: errorMessage || 'Unknown error',
        errorType,
        errorCode
    };
}

/**
 * Validate and sanitize log output
 *
 * @param text - Log text to validate
 * @returns Sanitized text
 */
export function sanitizeLogOutput(text: string): string {
    if (!text) {
        return '';
    }

    // Remove null characters and other control characters but preserve essential whitespace
    return text
        .replace(/\0/g, '') // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except tab(9), LF(10), CR(13)
        .replace(/^\s+/, '') // Only trim leading whitespace, preserve trailing
        .replace(/\n$/, ''); // Remove final newline but preserve other trailing whitespace
}

/**
 * Create a log summary for debugging
 *
 * @param result - Container execution result
 * @returns Log summary object
 */
export function createLogSummary(result: ContainerExecutionResult): {
    totalEntries: number;
    stdoutEntries: number;
    stderrEntries: number;
    stdoutSize: number;
    stderrSize: number;
    executionTime?: Date;
    hasMixedStreams: boolean;
} {
    const stdoutEntries = result.logEntries.filter(entry => entry.stream === LogStreamType.STDOUT).length;
    const stderrEntries = result.logEntries.filter(entry => entry.stream === LogStreamType.STDERR).length;

    return {
        totalEntries: result.logEntries.length,
        stdoutEntries,
        stderrEntries,
        stdoutSize: result.stdout.length,
        stderrSize: result.stderr.length,
        executionTime: result.logEntries[0]?.timestamp,
        hasMixedStreams: stdoutEntries > 0 && stderrEntries > 0
    };
}