/**
 * Command parsing utilities for Docker container execution
 * Handles complex command parsing with quotes, escaping, and argument separation
 */

/**
 * Parse a command string into an array of arguments
 * Handles quoted arguments, escaped characters, and proper spacing
 *
 * @param cmd - Command string to parse
 * @returns Array of parsed arguments
 */
export function parseCommand(cmd: string): string[] {
    if (!cmd) return [];

    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < cmd.length) {
        const char = cmd[i];

        // Handle escaped characters (including escaped quotes)
        if (char === '\\' && i + 1 < cmd.length) {
            const nextChar = cmd[i + 1];
            if (nextChar === '"' || nextChar === '\\') {
                // Include the escaped character literally
                current += nextChar;
                i += 2;
                continue;
            }
        }

        // Handle quote toggling (but not escaped quotes)
        if (char === '"' && (i === 0 || cmd[i - 1] !== '\\')) {
            inQuotes = !inQuotes;
            i++;
            continue;
        }

        // Handle space outside of quotes
        if (char === ' ' && !inQuotes) {
            if (current.trim()) {
                parts.push(current.trim());
                current = '';
            }
            i++;
            continue;
        }

        // Regular character
        current += char;
        i++;
    }

    // Add the last part if there's anything left
    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts;
}

/**
 * Validate and sanitize parsed command arguments
 *
 * @param args - Parsed command arguments
 * @returns Validated and sanitized arguments
 */
export function validateCommandArgs(args: string[]): string[] {
    return args.filter(arg => typeof arg === 'string' && arg.length > 0);
}

/**
 * Build a command string from an array of arguments
 * Properly quotes arguments when necessary
 *
 * @param args - Array of command arguments
 * @returns Properly quoted command string
 */
export function buildCommandString(args: string[]): string {
    return args.map(arg => {
        // If argument contains spaces or special characters, quote it
        if (arg.includes(' ') || arg.includes('"') || arg.includes('\\')) {
            return `"${arg.replace(/"/g, '\\"').replace(/\\/g, '\\\\')}"`;
        }
        return arg;
    }).join(' ');
}