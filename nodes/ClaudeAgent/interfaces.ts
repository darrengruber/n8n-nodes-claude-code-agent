export interface ClaudeAgentOptions {
    systemMessage?: string;
    maxTurns?: number;
    verbose?: boolean;
    workingDirectory?: string;
    binaryInputMode?: 'disabled' | 'auto' | 'manual';
    maxBinaryFileSize?: number;
    allowedBinaryTypes?: string[];
}

export interface ClaudeAgentConfiguration {
    model: string;
    systemPrompt?: string;
    maxTurns?: number;
    permissionMode: 'bypassPermissions';
    mcpServers?: Record<string, any>;
    disallowedTools?: string[];
    workingDirectory?: string;
}

export interface ClaudeAgentResult {
    output: any;
    logs?: string[];
}

// Extend IDataObject compatibility
export interface ClaudeAgentResultData extends ClaudeAgentResult, Record<string, any> {}

export interface ToolProcessingResult {
    mcpServers: Record<string, any>;
    disallowedTools: string[];
}

export interface ExecutionErrorDetails {
    message: string;
    stack?: string;
    code?: string;
    context?: any;
    apiKeyPresent: boolean;
    baseUrl?: string;
    toolsCount: number;
    logFile?: string;
}

export interface SdkConfiguration {
    model: string;
    systemPrompt: string | undefined;
    maxTurns: number | undefined;
    mcpServerCount: number;
    mcpServerNames: string[];
    toolsCount: number;
    apiKeyPresent: boolean;
    baseUrl?: string;
    promptLength: number;
    workingDirectory: string;
}

export interface PromptType {
    auto: 'auto';
    guardrails: 'guardrails';
    define: 'define';
}

export interface EnvironmentVariable {
    name: string;
    value: string;
}

export interface EnvironmentVariablesResult {
    variables: string[];
    count: number;
    mode?: 'keypair' | 'json' | 'model';
}

export interface BinaryInputMetadata {
    originalKey: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    filePath?: string; // Path when mounted for tools
    fileType?: 'image' | 'document' | 'data' | 'archive' | 'code' | 'other';
}

export interface BinaryInputProcessingResult {
    metadata: BinaryInputMetadata[];
    totalSize: number;
    skippedFiles: Array<{
        key: string;
        reason: string;
        fileName?: string;
    }>;
    tempDirectory?: string; // For auto mode
}

export interface FileTypeInfo {
    extensions: string[];
    mimeTypes: string[];
    category: 'image' | 'document' | 'data' | 'archive' | 'code' | 'other';
}

export interface BinaryArtifact {
    readonly toolName: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly data: string; // base64 encoded
    readonly fileSize?: number;
    readonly description: string;
    readonly timestamp?: Date;
}