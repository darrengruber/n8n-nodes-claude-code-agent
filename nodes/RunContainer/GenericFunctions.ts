/**
 * Generic Docker utilities and shared functions
 * Reusable across different node types and contexts
 */

import { IExecuteFunctions, NodeOperationError, jsonParse } from 'n8n-workflow';

/**
 * Environment variable processing modes
 */
export enum EnvironmentVariableMode {
    KEY_PAIR = 'keypair',
    JSON = 'json',
    MODEL = 'model'
}

/**
 * Environment variable key-value pair
 */
export interface EnvironmentVariable {
    name: string;
    value: string;
}

/**
 * Processed environment variables
 */
export interface ProcessedEnvironmentVariables {
    variables: string[];
    count: number;
    mode: EnvironmentVariableMode;
}

/**
 * Process environment variables from n8n node parameters
 *
 * @param this - n8n execution context
 * @param itemIndex - Item index for parameter retrieval
 * @returns Processed environment variables
 */
export async function processEnvironmentVariables(
    this: IExecuteFunctions,
    itemIndex: number
): Promise<ProcessedEnvironmentVariables> {
    const sendEnv = this.getNodeParameter('sendEnv', itemIndex, false) as boolean;

    if (!sendEnv) {
        return {
            variables: [],
            count: 0,
            mode: EnvironmentVariableMode.KEY_PAIR
        };
    }

    const specifyEnv = this.getNodeParameter('specifyEnv', itemIndex, 'keypair') as string;
    const envMode = specifyEnv as EnvironmentVariableMode;

    let envVars: string[] = [];

    switch (envMode) {
        case EnvironmentVariableMode.JSON:
            envVars = await processJsonEnvironmentVariables.call(this, itemIndex);
            break;

        case EnvironmentVariableMode.KEY_PAIR:
            envVars = await processKeyPairEnvironmentVariables.call(this, itemIndex);
            break;

        case EnvironmentVariableMode.MODEL:
            envVars = await processModelEnvironmentVariables.call(this, itemIndex);
            break;

        default:
            throw new NodeOperationError(
                this.getNode(),
                `Unsupported environment variable mode: ${envMode}`,
                { itemIndex }
            );
    }

    return {
        variables: envVars,
        count: envVars.length,
        mode: envMode
    };
}

/**
 * Process JSON environment variables
 *
 * @param this - n8n execution context
 * @param itemIndex - Item index
 * @returns Array of environment variable strings
 */
async function processJsonEnvironmentVariables(
    this: IExecuteFunctions,
    itemIndex: number
): Promise<string[]> {
    const jsonEnv = this.getNodeParameter('jsonEnv', itemIndex, '') as string;

    try {
        const envData = jsonParse(jsonEnv) as Record<string, any>;
        return convertObjectToEnvVars(envData);
    } catch (error) {
        throw new NodeOperationError(
            this.getNode(),
            `Failed to parse JSON environment variables: ${error.message}`,
            { itemIndex }
        );
    }
}

/**
 * Process key-pair environment variables
 *
 * @param this - n8n execution context
 * @param itemIndex - Item index
 * @returns Array of environment variable strings
 */
async function processKeyPairEnvironmentVariables(
    this: IExecuteFunctions,
    itemIndex: number
): Promise<string[]> {
    const envCollection = this.getNodeParameter('parametersEnv', itemIndex, {}) as {
        values: Array<{ name: string; value?: string }>;
    };

    const envVars: string[] = [];
    for (const envVar of envCollection.values || []) {
        if (envVar.name && envVar.value !== undefined) {
            envVars.push(`${envVar.name}=${envVar.value}`);
        }
    }

    return envVars;
}

/**
 * Process model environment variables
 *
 * @param this - n8n execution context
 * @param itemIndex - Item index
 * @returns Array of environment variable strings
 */
async function processModelEnvironmentVariables(
    this: IExecuteFunctions,
    itemIndex: number
): Promise<string[]> {
    const modelInput = this.getNodeParameter('modelInput', itemIndex) as string | Record<string, any>;

    let envData: Record<string, any>;
    try {
        envData = typeof modelInput === 'string' ? jsonParse(modelInput) : modelInput;
    } catch (error) {
        throw new NodeOperationError(
            this.getNode(),
            `Failed to parse model input for environment variables: ${error.message}`,
            { itemIndex }
        );
    }

    if (typeof envData !== 'object' || envData === null) {
        throw new NodeOperationError(
            this.getNode(),
            'Model input must be a valid object for environment variables',
            { itemIndex }
        );
    }

    return convertObjectToEnvVars(envData);
}

/**
 * Convert an object to environment variable strings
 *
 * @param obj - Object to convert
 * @returns Array of environment variable strings
 */
export function convertObjectToEnvVars(obj: Record<string, any>): string[] {
    const envVars: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && value !== null) {
            const stringValue = String(value);
            envVars.push(`${key}=${stringValue}`);
        }
    }

    return envVars;
}

/**
 * Parse environment variable string into key-value pairs
 *
 * @param envVarString - Environment variable string (KEY=VALUE format)
 * @returns Parsed key-value pair or null if invalid
 */
export function parseEnvironmentVariable(envVarString: string): { key: string; value: string } | null {
    const equalIndex = envVarString.indexOf('=');

    if (equalIndex === -1) {
        return null;
    }

    const key = envVarString.substring(0, equalIndex);
    const value = envVarString.substring(equalIndex + 1);

    if (!key) {
        return null;
    }

    return { key, value };
}

/**
 * Validate environment variable key format
 *
 * @param key - Environment variable key to validate
 * @returns True if valid
 */
export function validateEnvironmentVariableKey(key: string): boolean {
    // Environment variable keys should:
    // - Not be empty
    // - Start with a letter or underscore
    // - Contain only letters, digits, and underscores
    // - Not contain spaces
    const envKeyRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return envKeyRegex.test(key) && !key.includes(' ');
}

/**
 * Sanitize environment variable value
 *
 * @param value - Environment variable value to sanitize
 * @returns Sanitized value
 */
export function sanitizeEnvironmentVariableValue(value: string): string {
    // Remove null characters and other problematic characters
    return value
        .replace(/\0/g, '') // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters except tab, LF, CR
        .trim();
}

/**
 * Merge environment variable arrays with precedence
 *
 * @param baseVars - Base environment variables
 * @param overrideVars - Override environment variables (higher precedence)
 * @returns Merged environment variables
 */
export function mergeEnvironmentVariables(
    baseVars: string[],
    overrideVars: string[]
): string[] {
    const envMap = new Map<string, string>();

    // Process base variables first
    for (const envVar of baseVars) {
        const parsed = parseEnvironmentVariable(envVar);
        if (parsed) {
            envMap.set(parsed.key, parsed.value);
        }
    }

    // Process override variables (they overwrite base variables)
    for (const envVar of overrideVars) {
        const parsed = parseEnvironmentVariable(envVar);
        if (parsed) {
            envMap.set(parsed.key, parsed.value);
        }
    }

    // Convert back to array
    const mergedVars: string[] = [];
    for (const [key, value] of envMap.entries()) {
        mergedVars.push(`${key}=${value}`);
    }

    return mergedVars;
}

/**
 * Get common Docker environment variables
 *
 * @returns Array of common Docker environment variables
 */
export function getCommonDockerEnvironmentVariables(): string[] {
    return [
        'DOCKER_HOST=docker', // Common for container-to-container communication
        'DOCKER_API_VERSION=1.41', // Specify API version for compatibility
        'DOCKER_TLS_VERIFY=0', // Disable TLS verification for local development
    ];
}

/**
 * Validate Docker image name format
 *
 * @param imageName - Image name to validate
 * @returns Validation result
 */
export function validateDockerImageName(imageName: string): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!imageName || imageName.trim().length === 0) {
        errors.push('Image name cannot be empty');
        return { valid: false, errors };
    }

    const trimmedName = imageName.trim();

    // Check for valid characters (basic validation)
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/i.test(trimmedName)) {
        errors.push('Image name contains invalid characters');
    }

    // Check if tag is valid (if present)
    const tagMatch = trimmedName.match(/:([^:]+)$/);
    if (tagMatch) {
        const tag = tagMatch[1];
        if (!/^[a-zA-Z0-9._-]+$/.test(tag)) {
            errors.push('Image tag contains invalid characters');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Extract image name components
 *
 * @param imageName - Full image name
 * @returns Image name components
 */
export function parseDockerImageName(imageName: string): {
    registry?: string;
    repository: string;
    tag?: string;
    digest?: string;
} {
    const result: {
        registry?: string;
        repository: string;
        tag?: string;
        digest?: string;
    } = {
        repository: imageName
    };

    // Extract registry (contains at least one dot or localhost with port)
    const registryMatch = imageName.match(/^((?:[a-z0-9-]+\.)+[a-z0-9]+(?::\d+)?|localhost:\d+)\/(.+)$/);
    if (registryMatch) {
        result.registry = registryMatch[1];
        result.repository = registryMatch[2];
    }

    // Extract digest (SHA256) - check before tag since @ takes precedence over :
    const digestMatch = result.repository.match(/^(.+?)@sha256:([a-f0-9]+)$/);
    if (digestMatch) {
        result.repository = digestMatch[1];
        result.digest = digestMatch[2];
    }

    // Extract tag (only if no digest was found)
    const tagMatch = result.repository.match(/^(.+?):([^:@]+)$/);
    if (tagMatch) {
        result.repository = tagMatch[1];
        result.tag = tagMatch[2];
    }

    return result;
}

/**
 * Get default tag for an image if not specified
 *
 * @param imageName - Image name
 * @returns Image name with default tag if needed
 */
export function ensureDefaultImageTag(imageName: string): string {
    // If image has no tag or digest, add 'latest' tag
    if (!imageName.includes(':') && !imageName.includes('@')) {
        return `${imageName}:latest`;
    }
    return imageName;
}

/**
 * Generate a unique container name
 *
 * @param baseName - Base name for the container
 * @param maxLength - Maximum length for container name
 * @returns Unique container name
 */
export function generateUniqueContainerName(baseName: string, maxLength: number = 63): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    let containerName = `${baseName}-${timestamp}-${random}`;

    // Ensure name doesn't exceed Docker limits
    if (containerName.length > maxLength) {
        containerName = containerName.substring(0, maxLength - random.length) + random;
    }

    // Ensure name starts with alphanumeric and contains only valid characters
    containerName = containerName.replace(/[^a-zA-Z0-9_.-]/g, '');

    return containerName;
}

/**
 * Create a timeout promise for container operations
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise that rejects after timeout
 */
export function createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
}

/**
 * Execute function with timeout
 *
 * @param fn - Function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise that resolves with function result or rejects on timeout
 */
export async function executeWithTimeout<T>(
    fn: Promise<T>,
    timeoutMs: number
): Promise<T> {
    return Promise.race([fn, createTimeoutPromise(timeoutMs)]);
}

/**
 * Format error message for Docker operations
 *
 * @param error - Error object or message
 * @param operation - Docker operation being performed
 * @param context - Additional context information
 * @returns Formatted error message
 */
export function formatDockerError(
    error: Error | string,
    operation: string,
    context?: string
): string {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const contextStr = context ? ` (${context})` : '';

    return `Docker ${operation} failed${contextStr}: ${errorMessage}`;
}

/**
 * Check if error is a Docker connection error
 *
 * @param error - Error to check
 * @returns True if it's a Docker connection error
 */
export function isDockerConnectionError(error: Error | string): boolean {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const connectionErrorPatterns = [
        /connect ECONNREFUSED/i,
        /connection refused/i,
        /docker daemon/i,
        /docker socket/i,
        /ENOENT/i,
        /no such file or directory/i,
        /permission denied/i
    ];

    return connectionErrorPatterns.some(pattern => pattern.test(errorMessage));
}