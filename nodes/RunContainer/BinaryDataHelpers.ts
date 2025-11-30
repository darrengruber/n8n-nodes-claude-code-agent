/**
 * Binary Data Helpers for Docker Container Node
 * Utilities for handling binary file input/output with Docker containers
 */

import type { IExecuteFunctions, IBinaryData } from 'n8n-workflow';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Binary file mapping configuration
 */
export interface BinaryFileMapping {
    binaryPropertyName: string;
    containerPath: string;
}

/**
 * Prepared binary input information
 */
export interface PreparedBinaryInput {
    tempDir: string;
    mountPoints: Array<{ hostPath: string; containerPath: string }>;
    fileSizes: number[];
}

/**
 * Prepare binary files for container input
 * Extracts binary data from n8n and writes to temporary files
 *
 * @param context - n8n execution context
 * @param itemIndex - Current item index
 * @param fileMappings - Binary file mapping configuration
 * @returns Prepared input with temp directory and mount points
 */
export async function prepareBinaryInput(
    context: IExecuteFunctions,
    itemIndex: number,
    fileMappings: BinaryFileMapping[],
): Promise<PreparedBinaryInput> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8n-docker-binary-'));
    const mountPoints: Array<{ hostPath: string; containerPath: string }> = [];
    const fileSizes: number[] = [];

    try {
        // Create input directory
        const inputDir = path.join(tempDir, 'input');
        await fs.mkdir(inputDir, { recursive: true });

        for (const mapping of fileMappings) {
            // Validate and get binary data
            const binaryData = context.helpers.assertBinaryData(itemIndex, mapping.binaryPropertyName);
            const buffer = await context.helpers.getBinaryDataBuffer(
                itemIndex,
                mapping.binaryPropertyName,
            );

            // Create temporary file
            const fileName = binaryData.fileName || `input_${mapping.binaryPropertyName}.bin`;
            const hostPath = path.join(inputDir, fileName);

            // Write binary data to temporary file
            await fs.writeFile(hostPath, buffer);

            mountPoints.push({
                hostPath,
                containerPath: mapping.containerPath,
            });

            fileSizes.push(buffer.length);
        }

        return { tempDir, mountPoints, fileSizes };
    } catch (error) {
        // Cleanup on failure
        await cleanupTempDirectory(tempDir);
        throw error;
    }
}

/**
 * Prepare binary files for container input (automatic mode)
 * Extracts ALL binary data from n8n item and writes to temporary input directory
 *
 * @param context - n8n execution context
 * @param itemIndex - Current item index
 * @returns Prepared input with temp directory and file information
 */
export async function prepareBinaryInputAuto(
    context: IExecuteFunctions,
    itemIndex: number,
): Promise<{
    tempDir: string;
    inputDir: string;
    fileSizes: number[];
    fileNames: string[];
}> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8n-docker-binary-'));
    const fileSizes: number[] = [];
    const fileNames: string[] = [];

    try {
        // Create input directory
        const inputDir = path.join(tempDir, 'input');
        await fs.mkdir(inputDir, { recursive: true });

        // Get all binary data from the item
        const items = context.getInputData();
        const item = items[itemIndex];

        if (!item.binary) {
            // No binary data, but that's okay - return empty result
            return { tempDir, inputDir, fileSizes, fileNames };
        }

        // Iterate through all binary properties
        for (const [propertyName, binaryData] of Object.entries(item.binary)) {
            try {
                // Get the binary buffer
                const buffer = await context.helpers.getBinaryDataBuffer(
                    itemIndex,
                    propertyName,
                );

                // Determine filename
                const fileName = binaryData.fileName || `${propertyName}.bin`;
                const filePath = path.join(inputDir, fileName);

                // Write binary data to file
                await fs.writeFile(filePath, buffer);

                fileSizes.push(buffer.length);
                fileNames.push(fileName);
            } catch (error) {
                console.error(`Failed to process binary property ${propertyName}:`, error);
                // Continue with other files even if one fails
            }
        }

        return { tempDir, inputDir, fileSizes, fileNames };
    } catch (error) {
        // Cleanup on failure
        await cleanupTempDirectory(tempDir);
        throw error;
    }
}

/**
 * Collect binary output files from container execution
 * Scans output directory and prepares binary data for n8n
 * Automatically excludes temporary tar files (extract-*.tar) created during file copying
 *
 * @param context - n8n execution context
 * @param tempDir - Temporary directory containing output files
 * @param outputPattern - Optional glob pattern to filter files
 * @returns Binary data object with collected files
 */
export async function collectBinaryOutput(
    context: IExecuteFunctions,
    tempDir: string,
    outputPattern?: string,
): Promise<{ [key: string]: IBinaryData }> {
    const outputBinary: { [key: string]: IBinaryData } = {};
    const outputDir = path.join(tempDir, 'output');

    try {
        // Check if output directory exists
        await fs.access(outputDir);
        const files = await fs.readdir(outputDir);

        // Parse output patterns
        const patterns = outputPattern
            ? outputPattern.split(',').map((p) => p.trim())
            : ['*'];

        for (const file of files) {
            // Skip tar files that are temporary artifacts from file copying
            if (file.startsWith('extract-') && file.endsWith('.tar')) {
                continue;
            }

            // Check if file matches any pattern
            const matchesPattern = patterns.some((pattern) => {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
                return regex.test(file);
            });

            if (!matchesPattern) {
                continue;
            }

            const filePath = path.join(outputDir, file);
            const stats = await fs.stat(filePath);

            if (stats.isFile()) {
                const buffer = await fs.readFile(filePath);
                const fileKey = sanitizeFileName(file);

                outputBinary[fileKey] = await context.helpers.prepareBinaryData(
                    buffer,
                    file,
                    getMimeTypeFromFile(file),
                );
            }
        }
    } catch (error) {
        // No output files or can't read output directory
        // This is not necessarily an error - container may not produce output files
    }

    return outputBinary;
}

/**
 * Get MIME type from file extension
 *
 * @param fileName - File name with extension
 * @returns MIME type string
 */
export function getMimeTypeFromFile(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.csv': 'text/csv',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.7z': 'application/x-7z-compressed',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Sanitize file name for use as binary data key
 * Removes invalid characters and replaces with underscores
 *
 * @param fileName - Original file name
 * @returns Sanitized file name
 */
export function sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Calculate container resource limits based on file sizes
 * Provides appropriate memory, CPU, and timeout settings
 *
 * @param fileSizes - Array of file sizes in bytes
 * @returns Resource limits configuration
 */
export function calculateResourceLimits(fileSizes: number[]): {
    memory: number;
    cpuQuota: number;
    timeout: number;
} {
    const totalSize = fileSizes.reduce((sum, size) => sum + size, 0);
    const maxSize = Math.max(...fileSizes, 0);

    // Base memory + processing overhead
    // Formula: Base (256MB) + max(2x total size, 4x largest file)
    const baseMemory = 256 * 1024 * 1024; // 256MB
    const processingMemory = Math.max(totalSize * 2, maxSize * 4);
    const memory = Math.min(
        Math.max(baseMemory + processingMemory, 512 * 1024 * 1024),
        4 * 1024 * 1024 * 1024, // Max 4GB
    );

    // CPU allocation based on workload
    // Use higher CPU quota for larger files
    const cpuQuota = totalSize > 50 * 1024 * 1024 ? 150000 : 75000; // 150% vs 75%

    // Timeout based on file size
    // Base: 1 minute, add 30 seconds per 10MB, max 10 minutes
    const baseTimeout = 60000; // 1 minute
    const processingTimeout = Math.ceil(totalSize / (10 * 1024 * 1024)) * 30000; // 30s per 10MB
    const timeout = Math.min(
        Math.max(baseTimeout + processingTimeout, 120000),
        10 * 60 * 1000, // Max 10 minutes
    );

    return { memory, cpuQuota, timeout };
}

/**
 * Clean up temporary directory with retries
 * Robust cleanup that handles locked files and retries
 *
 * @param tempDir - Temporary directory to clean up
 */
export async function cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
        // Check if directory exists
        await fs.access(tempDir);

        // Remove directory recursively with retries
        await fs.rm(tempDir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 1000,
        });
    } catch (error) {
        // Log cleanup error but don't throw
        // Cleanup failures should not break the workflow
        console.error(`Failed to cleanup temporary directory ${tempDir}:`, error);
    }
}

/**
 * Create output directory in temp directory
 *
 * @param tempDir - Temporary directory
 * @returns Path to created output directory
 */
export async function createOutputDirectory(tempDir: string): Promise<string> {
    const outputDir = path.join(tempDir, 'output');
    await fs.mkdir(outputDir, { recursive: true });
    return outputDir;
}
