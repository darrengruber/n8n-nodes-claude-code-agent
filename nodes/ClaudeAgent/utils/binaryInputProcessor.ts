/**
 * Binary Input Processor for ClaudeAgent
 * Handles extraction, validation, and preparation of binary data for tool usage
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IExecuteFunctions, ISupplyDataFunctions } from 'n8n-workflow';
import { DebugLogger } from './debugLogger';
import { 
    BinaryInputMetadata, 
    BinaryInputProcessingResult, 
    FileTypeInfo,
    ClaudeAgentOptions 
} from '../interfaces';

// File type mappings
const FILE_TYPE_mappings: Record<string, FileTypeInfo> = {
    image: {
        extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'],
        mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'],
        category: 'image'
    },
    document: {
        extensions: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt'],
        mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
        category: 'document'
    },
    data: {
        extensions: ['.json', '.csv', '.xml', '.yaml', '.yml', '.xlsx', '.xls'],
        mimeTypes: ['application/json', 'text/csv', 'application/xml', 'text/yaml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        category: 'data'
    },
    archive: {
        extensions: ['.zip', '.tar', '.gz', '.7z', '.rar'],
        mimeTypes: ['application/zip', 'application/x-tar', 'application/gzip', 'application/x-7z-compressed'],
        category: 'archive'
    },
    code: {
        extensions: ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r', '.m', '.sh', '.sql', '.html', '.css', '.scss', '.less', '.vue', '.jsx', '.tsx'],
        mimeTypes: ['text/javascript', 'text/typescript', 'text/x-python', 'text/x-java-source', 'text/x-c++src', 'text/x-csrc', 'text/x-csharp', 'text/x-php', 'text/x-ruby', 'text/x-go', 'application/x-rust'],
        category: 'code'
    }
};

/**
 * Calculate file size from base64 data efficiently
 */
export function calculateFileSizeFromBase64(base64Data: string): number {
    // Approximate conversion: base64 is ~33% larger than original
    // This avoids creating a Buffer just for size calculation
    return Math.round(base64Data.length * 0.75);
}

/**
 * Get file category from file extension or MIME type
 */
export function getFileCategory(fileName: string, mimeType: string): 'image' | 'document' | 'data' | 'archive' | 'code' | 'other' {
    const ext = path.extname(fileName).toLowerCase();
    
    // Check by extension first
    for (const [, info] of Object.entries(FILE_TYPE_mappings)) {
        if (info.extensions.includes(ext)) {
            return info.category;
        }
    }
    
    // Check by MIME type
    for (const [, info] of Object.entries(FILE_TYPE_mappings)) {
        if (info.mimeTypes.includes(mimeType)) {
            return info.category;
        }
    }
    
    return 'other';
}

/**
 * Check if a file type is allowed based on user preferences
 */
export function isFileTypeAllowed(
    fileName: string, 
    mimeType: string, 
    allowedTypes: string[]
): boolean {
    if (allowedTypes.includes('all')) {
        return true;
    }
    
    const category = getFileCategory(fileName, mimeType);
    return allowedTypes.includes(category);
}

/**
 * Process binary input data from items
 */
export async function processBinaryInput(
    context: IExecuteFunctions | ISupplyDataFunctions,
    itemIndex: number,
    options: ClaudeAgentOptions,
    logger: DebugLogger
): Promise<BinaryInputProcessingResult> {
    const result: BinaryInputProcessingResult = {
        metadata: [],
        totalSize: 0,
        skippedFiles: []
    };

    // Skip if binary input is disabled
    if (!options.binaryInputMode || options.binaryInputMode === 'disabled') {
        logger.log('Binary input processing disabled');
        return result;
    }

    const items = context.getInputData();
    const item = items[itemIndex];

    if (!item || !item.binary) {
        logger.log('No binary data found in item');
        return result;
    }

    const maxSizeBytes = (options.maxBinaryFileSize || 100) * 1024 * 1024; // Convert MB to bytes
    const allowedTypes = options.allowedBinaryTypes || ['images', 'documents', 'data'];

    logger.log('Processing binary input', {
        fileCount: Object.keys(item.binary).length,
        maxSizeBytes,
        allowedTypes,
        mode: options.binaryInputMode
    });

    let tempDir: string | undefined;

    // Create temporary directory for auto mode
    if (options.binaryInputMode === 'auto') {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8n-claude-binary-'));
        const inputDir = path.join(tempDir, 'input');
        await fs.mkdir(inputDir, { recursive: true });
        result.tempDirectory = tempDir;
        logger.log(`Created temporary directory: ${tempDir}`);
    }

    // Process each binary file
    for (const [key, binaryData] of Object.entries(item.binary)) {
        try {
            const fileName = (binaryData as any).fileName || key;
            const mimeType = (binaryData as any).mimeType || 'application/octet-stream';
            const fileSize = Math.round((binaryData as any).data.length * 0.75); // Approximate base64 to bytes conversion

            // Validate file size
            if (fileSize > maxSizeBytes) {
                result.skippedFiles.push({
                    key,
                    reason: `File too large: ${Math.round(fileSize / 1024 / 1024)}MB (max: ${options.maxBinaryFileSize}MB)`,
                    fileName
                });
                logger.logWarning(`Skipped large file: ${fileName} (${Math.round(fileSize / 1024 / 1024)}MB)`);
                continue;
            }

            // Validate file type
            if (!isFileTypeAllowed(fileName, mimeType, allowedTypes)) {
                const category = getFileCategory(fileName, mimeType);
                result.skippedFiles.push({
                    key,
                    reason: `File type not allowed: ${category}`,
                    fileName
                });
                logger.logWarning(`Skipped disallowed file type: ${fileName} (${category})`);
                continue;
            }

            const metadata: BinaryInputMetadata = {
                originalKey: key,
                fileName,
                mimeType,
                fileSize,
                fileType: getFileCategory(fileName, mimeType)
            };

            // Handle auto mode - create temporary files
            if (options.binaryInputMode === 'auto' && tempDir) {
                const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, key);
                const filePath = path.join(tempDir, 'input', fileName);
                await fs.writeFile(filePath, buffer);
                metadata.filePath = filePath;
                logger.log(`Created temporary file: ${filePath}`);
            }

            result.metadata.push(metadata);
            result.totalSize += fileSize;

            logger.log(`Processed binary file: ${fileName} (${metadata.fileType}, ${Math.round(fileSize / 1024)}KB)`);

        } catch (error) {
            result.skippedFiles.push({
                key,
                reason: `Processing error: ${error.message}`,
                fileName: (binaryData as any).fileName
            });
            logger.logError(`Failed to process binary file ${key}`, error);
        }
    }

    logger.log('Binary input processing completed', {
        processedFiles: result.metadata.length,
        skippedFiles: result.skippedFiles.length,
        totalSize: Math.round(result.totalSize / 1024 / 1024 * 100) / 100 + 'MB'
    });

    return result;
}

/**
 * Clean up temporary directory
 */
export async function cleanupBinaryInput(tempDir: string | undefined): Promise<void> {
    if (!tempDir) {
        return;
    }

    try {
        await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
        console.warn(`Failed to cleanup binary input temp directory ${tempDir}:`, error);
    }
}

/**
 * Generate summary of binary files for tool descriptions
 */
export function generateBinaryFileSummary(metadata: BinaryInputMetadata[]): string {
    if (metadata.length === 0) {
        return '';
    }

    const byType = metadata.reduce((acc, file) => {
        acc[file.fileType!] = (acc[file.fileType!] || []).concat(file);
        return acc;
    }, {} as Record<string, BinaryInputMetadata[]>);

    let summary = '\n\nAvailable Input Files:\n';
    
    for (const [type, files] of Object.entries(byType)) {
        summary += `\n${type.charAt(0).toUpperCase() + type.slice(1)} Files:\n`;
        for (const file of files) {
            const sizeMB = Math.round(file.fileSize / 1024 / 1024 * 100) / 100;
            const location = file.filePath ? ` (available at ${file.filePath})` : '';
            summary += `  - ${file.fileName} (${file.mimeType}, ${sizeMB}MB)${location}\n`;
        }
    }

    return summary;
}