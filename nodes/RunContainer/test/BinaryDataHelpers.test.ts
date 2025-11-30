// @ts-nocheck
import type { IExecuteFunctions } from 'n8n-workflow';
import {
    getMimeTypeFromFile,
    sanitizeFileName,
    calculateResourceLimits,
    prepareBinaryInput,
    collectBinaryOutput,
    createOutputDirectory,
    cleanupTempDirectory,
} from '../BinaryDataHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock modules
jest.mock('fs/promises');
jest.mock('os');
jest.mock('path', () => {
    const actual = jest.requireActual('path');
    return {
        ...actual,
        join: jest.fn(actual.join),
        extname: jest.fn(actual.extname),
    };
});

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;
const mockPath = path as jest.Mocked<typeof path>;

describe('RunContainer > BinaryDataHelpers', () => {
    describe('getMimeTypeFromFile', () => {
        it('should return correct MIME type for common image formats', () => {
            expect(getMimeTypeFromFile('image.png')).toBe('image/png');
            expect(getMimeTypeFromFile('photo.jpg')).toBe('image/jpeg');
            expect(getMimeTypeFromFile('photo.jpeg')).toBe('image/jpeg');
            expect(getMimeTypeFromFile('animation.gif')).toBe('image/gif');
            expect(getMimeTypeFromFile('picture.webp')).toBe('image/webp');
        });

        it('should return correct MIME type for document formats', () => {
            expect(getMimeTypeFromFile('document.pdf')).toBe('application/pdf');
            expect(getMimeTypeFromFile('spreadsheet.xlsx')).toBe(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            );
            expect(getMimeTypeFromFile('presentation.pptx')).toBe(
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            );
        });

        it('should return correct MIME type for archive formats', () => {
            expect(getMimeTypeFromFile('archive.zip')).toBe('application/zip');
            expect(getMimeTypeFromFile('archive.tar')).toBe('application/x-tar');
            expect(getMimeTypeFromFile('archive.gz')).toBe('application/gzip');
        });

        it('should return correct MIME type for text formats', () => {
            expect(getMimeTypeFromFile('file.txt')).toBe('text/plain');
            expect(getMimeTypeFromFile('data.json')).toBe('application/json');
            expect(getMimeTypeFromFile('data.csv')).toBe('text/csv');
            expect(getMimeTypeFromFile('page.html')).toBe('text/html');
        });

        it('should return octet-stream for unknown extensions', () => {
            expect(getMimeTypeFromFile('file.unknown')).toBe('application/octet-stream');
            expect(getMimeTypeFromFile('noextension')).toBe('application/octet-stream');
        });

        it('should be case-insensitive', () => {
            expect(getMimeTypeFromFile('IMAGE.PNG')).toBe('image/png');
            expect(getMimeTypeFromFile('DOCUMENT.PDF')).toBe('application/pdf');
        });
    });

    describe('sanitizeFileName', () => {
        it('should replace invalid characters with underscores', () => {
            expect(sanitizeFileName('file name.pdf')).toBe('file_name.pdf');
            expect(sanitizeFileName('file@#$.txt')).toBe('file___.txt');
            expect(sanitizeFileName('file/path/name.pdf')).toBe('file_path_name.pdf');
        });

        it('should preserve valid characters', () => {
            expect(sanitizeFileName('valid-file_name.123.txt')).toBe('valid-file_name.123.txt');
            expect(sanitizeFileName('file.tar.gz')).toBe('file.tar.gz');
        });

        it('should handle empty strings', () => {
            expect(sanitizeFileName('')).toBe('');
        });

        it('should handle strings with only invalid characters', () => {
            expect(sanitizeFileName('!@#$%^&*()')).toBe('__________');
        });
    });

    describe('calculateResourceLimits', () => {
        it('should return minimum resources for small files', () => {
            const limits = calculateResourceLimits([1024]); // 1KB
            expect(limits.memory).toBeGreaterThanOrEqual(512 * 1024 * 1024); // At least 512MB
            expect(limits.cpuQuota).toBe(75000); // 75%
            expect(limits.timeout).toBeGreaterThanOrEqual(60000); // At least 1 minute
        });

        it('should increase resources for larger files', () => {
            const smallLimits = calculateResourceLimits([1024 * 1024]); // 1MB
            const largeLimits = calculateResourceLimits([100 * 1024 * 1024]); // 100MB

            expect(largeLimits.memory).toBeGreaterThan(smallLimits.memory);
            expect(largeLimits.cpuQuota).toBeGreaterThanOrEqual(smallLimits.cpuQuota);
            expect(largeLimits.timeout).toBeGreaterThan(smallLimits.timeout);
        });

        it('should use higher CPU quota for files over 50MB', () => {
            const smallLimits = calculateResourceLimits([40 * 1024 * 1024]); // 40MB
            const largeLimits = calculateResourceLimits([60 * 1024 * 1024]); // 60MB

            expect(smallLimits.cpuQuota).toBe(75000); // 75%
            expect(largeLimits.cpuQuota).toBe(150000); // 150%
        });

        it('should cap memory at 4GB', () => {
            const limits = calculateResourceLimits([10 * 1024 * 1024 * 1024]); // 10GB file
            expect(limits.memory).toBeLessThanOrEqual(4 * 1024 * 1024 * 1024); // Max 4GB
        });

        it('should cap timeout at 10 minutes', () => {
            const limits = calculateResourceLimits([10 * 1024 * 1024 * 1024]); // Very large file
            expect(limits.timeout).toBeLessThanOrEqual(10 * 60 * 1000); // Max 10 minutes
        });

        it('should handle multiple files', () => {
            const limits = calculateResourceLimits([
                10 * 1024 * 1024, // 10MB
                20 * 1024 * 1024, // 20MB
                30 * 1024 * 1024, // 30MB
            ]);

            // Should account for total size of 60MB
            expect(limits.memory).toBeGreaterThanOrEqual(512 * 1024 * 1024);
            expect(limits.cpuQuota).toBe(150000); // Over 50MB total
        });

        it('should handle empty array', () => {
            const limits = calculateResourceLimits([]);
            expect(limits.memory).toBeGreaterThanOrEqual(512 * 1024 * 1024);
            expect(limits.cpuQuota).toBe(75000);
            expect(limits.timeout).toBeGreaterThanOrEqual(60000);
        });
    });

    describe('prepareBinaryInput', () => {
        let mockContext: Partial<IExecuteFunctions>;

        beforeEach(() => {
            jest.clearAllMocks();

            mockContext = {
                helpers: {
                    assertBinaryData: jest.fn(),
                    getBinaryDataBuffer: jest.fn(),
                    prepareBinaryData: jest.fn(),
                },
                getNode: jest.fn().mockReturnValue({ id: 'test-node' }),
            };

            mockOs.tmpdir.mockReturnValue('/tmp');
            mockFs.mkdtemp.mockResolvedValue('/tmp/n8n-docker-binary-abc123');
            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.writeFile.mockResolvedValue(undefined);
        });

        it('should prepare single binary file', async () => {
            const mockBinaryData = {
                fileName: 'test.pdf',
                mimeType: 'application/pdf',
                data: 'base64data',
            };
            const mockBuffer = Buffer.from('test content');

            mockContext.helpers!.assertBinaryData.mockReturnValue(mockBinaryData);
            mockContext.helpers!.getBinaryDataBuffer.mockResolvedValue(mockBuffer);

            const result = await prepareBinaryInput(mockContext as IExecuteFunctions, 0, [
                { binaryPropertyName: 'data', containerPath: '/input/test.pdf' },
            ]);

            expect(result.tempDir).toBe('/tmp/n8n-docker-binary-abc123');
            expect(result.mountPoints).toHaveLength(1);
            expect(result.mountPoints[0].containerPath).toBe('/input/test.pdf');
            expect(result.fileSizes).toEqual([mockBuffer.length]);
            expect(mockFs.writeFile).toHaveBeenCalledWith(expect.any(String), mockBuffer);
        });

        it('should prepare multiple binary files', async () => {
            const mockBinaryData1 = { fileName: 'file1.pdf', mimeType: 'application/pdf' };
            const mockBinaryData2 = { fileName: 'file2.png', mimeType: 'image/png' };
            const mockBuffer1 = Buffer.from('content1');
            const mockBuffer2 = Buffer.from('content2');

            mockContext.helpers!.assertBinaryData
                .mockReturnValueOnce(mockBinaryData1)
                .mockReturnValueOnce(mockBinaryData2);
            mockContext.helpers!.getBinaryDataBuffer
                .mockResolvedValueOnce(mockBuffer1)
                .mockResolvedValueOnce(mockBuffer2);

            const result = await prepareBinaryInput(mockContext as IExecuteFunctions, 0, [
                { binaryPropertyName: 'file1', containerPath: '/input/file1.pdf' },
                { binaryPropertyName: 'file2', containerPath: '/input/file2.png' },
            ]);

            expect(result.mountPoints).toHaveLength(2);
            expect(result.fileSizes).toEqual([mockBuffer1.length, mockBuffer2.length]);
            expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
        });

        it('should use default filename if not provided', async () => {
            const mockBinaryData = { mimeType: 'application/pdf' }; // No fileName
            const mockBuffer = Buffer.from('test content');

            mockContext.helpers!.assertBinaryData.mockReturnValue(mockBinaryData);
            mockContext.helpers!.getBinaryDataBuffer.mockResolvedValue(mockBuffer);

            await prepareBinaryInput(mockContext as IExecuteFunctions, 0, [
                { binaryPropertyName: 'data', containerPath: '/input/file' },
            ]);

            mockFs.readdir.mockResolvedValue(['output1.pdf', 'output2.png'] as any);
            mockFs.stat.mockResolvedValue({ isFile: () => true } as any);
            mockFs.readFile.mockResolvedValue(Buffer.from('file content') as any);

            mockContext.helpers!.prepareBinaryData.mockImplementation(
                async (buffer, fileName, mimeType) => ({
                    data: buffer.toString('base64'),
                    mimeType,
                    fileName,
                }),
            );

            const result = await collectBinaryOutput(
                mockContext as IExecuteFunctions,
                '/tmp/test',
                '*',
            );

            expect(Object.keys(result)).toHaveLength(2);
            expect(result['output1.pdf']).toBeDefined();
            expect(result['output2.png']).toBeDefined();
        });

        it('should filter files by pattern', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readdir.mockResolvedValue(['output1.pdf', 'output2.png', 'log.txt'] as any);
            mockFs.stat.mockResolvedValue({ isFile: () => true } as any);
            mockFs.readFile.mockResolvedValue(Buffer.from('file content') as any);
            mockContext.helpers!.prepareBinaryData.mockImplementation(
                async (buffer, fileName, mimeType) => ({
                    data: buffer.toString('base64'),
                    mimeType,
                    fileName,
                }),
            );

            const result = await collectBinaryOutput(
                mockContext as IExecuteFunctions,
                '/tmp/test',
                '*.pdf',
            );

            expect(Object.keys(result)).toHaveLength(1);
            expect(result['output1.pdf']).toBeDefined();
            expect(result['output2.png']).toBeUndefined();
        });

        it('should handle multiple patterns', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readdir.mockResolvedValue(['file.pdf', 'image.png', 'data.json'] as any);
            mockFs.stat.mockResolvedValue({ isFile: () => true } as any);
            mockFs.readFile.mockResolvedValue(Buffer.from('file content') as any);
            mockContext.helpers!.prepareBinaryData.mockImplementation(
                async (buffer, fileName, mimeType) => ({
                    data: buffer.toString('base64'),
                    mimeType,
                    fileName,
                }),
            );

            const result = await collectBinaryOutput(
                mockContext as IExecuteFunctions,
                '/tmp/test',
                '*.pdf, *.png',
            );

            expect(Object.keys(result)).toHaveLength(2);
            expect(result['file.pdf']).toBeDefined();
            expect(result['image.png']).toBeDefined();
            expect(result['data.json']).toBeUndefined();
        });

        it('should return empty object when output directory does not exist', async () => {
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            const result = await collectBinaryOutput(
                mockContext as IExecuteFunctions,
                '/tmp/test',
            );

            expect(result).toEqual({});
        });

        it('should skip non-file entries', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readdir.mockResolvedValue(['file.pdf', 'subdir'] as any);
            mockFs.stat
                .mockResolvedValueOnce({ isFile: () => true } as any)
                .mockResolvedValueOnce({ isFile: () => false } as any);
            mockFs.readFile.mockResolvedValue(Buffer.from('file content') as any);
            mockContext.helpers!.prepareBinaryData.mockImplementation(
                async (buffer, fileName, mimeType) => ({
                    data: buffer.toString('base64'),
                    mimeType,
                    fileName,
                }),
            );

            const result = await collectBinaryOutput(
                mockContext as IExecuteFunctions,
                '/tmp/test',
            );

            expect(Object.keys(result)).toHaveLength(1);
            expect(result['file.pdf']).toBeDefined();
        });

        it('should skip tar files that are temporary artifacts', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readdir.mockResolvedValue(['output.pdf', 'extract-1234567890.tar', 'image.png'] as any);
            
            mockFs.stat.mockImplementation((filePath: string) => {
                const fileName = path.basename(filePath);
                return Promise.resolve({
                    isFile: () => !fileName.endsWith('.tar'),
                } as any);
            });

            mockContext.helpers.prepareBinaryData.mockResolvedValue({
                data: Buffer.from('mock content'),
                mimeType: 'application/pdf',
                fileName: 'output.pdf',
            });

            const result = await collectBinaryOutput(
                mockContext as IExecuteFunctions,
                '/tmp/test',
            );

            expect(Object.keys(result)).toHaveLength(2);
            expect(result['output.pdf']).toBeDefined();
            expect(result['image.png']).toBeDefined();
            // Tar file should be excluded
            expect(result['extract-1234567890.tar']).toBeUndefined();
        });
    });

    describe('createOutputDirectory', () => {
        beforeEach(() => {
            jest.clearAllMocks();
            mockPath.join.mockImplementation((...args) => args.join('/'));
            mockFs.mkdir.mockResolvedValue(undefined);
        });

        it('should create output directory', async () => {
            const outputDir = await createOutputDirectory('/tmp/test');

            expect(outputDir).toBe('/tmp/test/output');
            expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp/test/output', { recursive: true });
        });
    });

    describe('cleanupTempDirectory', () => {
        beforeEach(() => {
            jest.clearAllMocks();
            mockFs.access.mockResolvedValue(undefined);
            mockFs.rm.mockResolvedValue(undefined);
        });

        it('should remove directory successfully', async () => {
            await cleanupTempDirectory('/tmp/test');

            expect(mockFs.access).toHaveBeenCalledWith('/tmp/test');
            expect(mockFs.rm).toHaveBeenCalledWith('/tmp/test', {
                recursive: true,
                force: true,
                maxRetries: 3,
                retryDelay: 1000,
            });
        });

        it('should not throw if directory does not exist', async () => {
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            await expect(cleanupTempDirectory('/tmp/test')).resolves.not.toThrow();
            expect(mockFs.rm).not.toHaveBeenCalled();
        });

        it('should not throw if removal fails', async () => {
            mockFs.rm.mockRejectedValue(new Error('Permission denied'));

            await expect(cleanupTempDirectory('/tmp/test')).resolves.not.toThrow();
        });
    });
});
