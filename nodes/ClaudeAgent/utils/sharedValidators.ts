/**
 * Shared validation utilities for binary data processing
 * Extracted to eliminate code duplication between modules
 */

export interface FileValidationConfig {
    maxFileSize?: number;
    allowedTypes?: string[];
    allowedExtensions?: string[];
    allowAll?: boolean;
}

/**
 * Validate file type against allowed types and extensions
 */
export function validateFileType(
    fileName: string, 
    mimeType: string, 
    config: FileValidationConfig
): { valid: boolean; reason?: string } {
    if (config.allowAll) {
        return { valid: true };
    }

    // Check MIME type if specified
    if (config.allowedTypes && config.allowedTypes.length > 0) {
        if (!config.allowedTypes.includes(mimeType)) {
            return { 
                valid: false, 
                reason: `MIME type ${mimeType} not allowed. Allowed types: ${config.allowedTypes.join(', ')}` 
            };
        }
    }

    // Check file extension if specified
    if (config.allowedExtensions && config.allowedExtensions.length > 0) {
        const fileExtension = fileName.toLowerCase().split('.').pop();
        if (!fileExtension || !config.allowedExtensions.includes(`.${fileExtension}`)) {
            return { 
                valid: false, 
                reason: `File extension .${fileExtension} not allowed. Allowed extensions: ${config.allowedExtensions.join(', ')}` 
            };
        }
    }

    return { valid: true };
}

/**
 * Validate file size against maximum limit
 */
export function validateFileSize(
    fileName: string, 
    fileSize: number, 
    maxSize?: number
): { valid: boolean; reason?: string } {
    if (maxSize && fileSize > maxSize) {
        return { 
            valid: false, 
            reason: `File ${fileName} size (${fileSize} bytes) exceeds maximum allowed size (${maxSize} bytes)` 
        };
    }
    return { valid: true };
}

/**
 * Sanitize filename to prevent path traversal
 */
export function sanitizeFileName(fileName: string): string {
    // Remove path separators and dangerous characters
    return fileName
        .replace(/[\\/]/g, '_')  // Replace path separators
        .replace(/\.\./g, '_')   // Remove directory traversal attempts
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control characters
        .trim();
}

/**
 * Get file category from extension or MIME type
 */
export function getFileCategory(
    fileName: string, 
    mimeType: string
): 'image' | 'document' | 'data' | 'archive' | 'code' | 'other' {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    
    // Image files
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext) ||
        mimeType.startsWith('image/')) {
        return 'image';
    }
    
    // Document files
    if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext) ||
        ['application/pdf', 'text/plain'].includes(mimeType)) {
        return 'document';
    }
    
    // Data files
    if (['json', 'csv', 'xml', 'yaml', 'yml', 'xlsx', 'xls'].includes(ext) ||
        ['application/json', 'text/csv', 'application/xml'].includes(mimeType)) {
        return 'data';
    }
    
    // Archive files
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext) ||
        ['application/zip', 'application/x-tar', 'application/gzip'].includes(mimeType)) {
        return 'archive';
    }
    
    // Code files
    if (['js', 'ts', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'r', 'm', 'sh', 'sql', 'html', 'css', 'scss', 'less', 'vue', 'jsx', 'tsx'].includes(ext) ||
        mimeType.startsWith('text/') && !mimeType.includes('plain')) {
        return 'code';
    }
    
    return 'other';
}