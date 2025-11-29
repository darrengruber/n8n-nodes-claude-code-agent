import { prepareBinaryInputAuto, cleanupTempDirectory } from '../BinaryDataHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock IExecuteFunctions
const createMockContext = (binaryData: any) => ({
    getInputData: jest.fn().mockReturnValue([{ json: {}, binary: binaryData }]),
    helpers: {
        getBinaryDataBuffer: jest.fn().mockImplementation(async (itemIndex: number, propertyName: string) => {
            const item = [{ json: {}, binary: binaryData }][itemIndex];
            if (!item.binary || !item.binary[propertyName]) {
                throw new Error(`Binary property ${propertyName} not found`);
            }
            // Return mock buffer based on property
            return Buffer.from(`test-content-${propertyName}`);
        }),
    },
} as any);

describe('BinaryDataHelpers > prepareBinaryInputAuto', () => {
    afterEach(async () => {
        // Note: Each test cleans up its own tempDir
    });

    it('should extract all binary data with filenames', async () => {
        const binaryData = {
            image: {
                fileName: 'test-image.png',
                mimeType: 'image/png',
            },
            document: {
                fileName: 'document.pdf',
                mimeType: 'application/pdf',
            },
        };

        const context = createMockContext(binaryData);
        const result = await prepareBinaryInputAuto(context, 0);

        try {
            // Verify temp directory was created
            expect(result.tempDir).toBeTruthy();
            expect(result.inputDir).toBeTruthy();
            expect(result.inputDir).toContain('input');

            // Verify files were extracted
            expect(result.fileNames).toEqual(['test-image.png', 'document.pdf']);
            expect(result.fileSizes).toHaveLength(2);

            // Verify files exist on disk
            const imagePath = path.join(result.inputDir, 'test-image.png');
            const docPath = path.join(result.inputDir, 'document.pdf');

            const imageContent = await fs.readFile(imagePath, 'utf-8');
            const docContent = await fs.readFile(docPath, 'utf-8');

            expect(imageContent).toBe('test-content-image');
            expect(docContent).toBe('test-content-document');
        } finally {
            // Cleanup
            await cleanupTempDirectory(result.tempDir);
        }
    });

    it('should handle binary data without explicit filenames', async () => {
        const binaryData = {
            data: {
                mimeType: 'application/octet-stream',
                // No fileName property
            },
        };

        const context = createMockContext(binaryData);
        const result = await prepareBinaryInputAuto(context, 0);

        try {
            // Should use property name + .bin as filename
            expect(result.fileNames).toEqual(['data.bin']);
            expect(result.fileSizes).toHaveLength(1);

            const filePath = path.join(result.inputDir, 'data.bin');
            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('test-content-data');
        } finally {
            await cleanupTempDirectory(result.tempDir);
        }
    });

    it('should handle items with no binary data', async () => {
        const context = createMockContext(undefined);
        const result = await prepareBinaryInputAuto(context, 0);

        try {
            // Should return empty arrays
            expect(result.fileNames).toEqual([]);
            expect(result.fileSizes).toEqual([]);

            // Input directory should still exist
            const stats = await fs.stat(result.inputDir);
            expect(stats.isDirectory()).toBe(true);

            // Directory should be empty
            const files = await fs.readdir(result.inputDir);
            expect(files).toEqual([]);
        } finally {
            await cleanupTempDirectory(result.tempDir);
        }
    });

    it('should handle multiple binary files', async () => {
        const binaryData = {
            file1: { fileName: 'file1.txt' },
            file2: { fileName: 'file2.txt' },
            file3: { fileName: 'file3.txt' },
            file4: { fileName: 'file4.txt' },
        };

        const context = createMockContext(binaryData);
        const result = await prepareBinaryInputAuto(context, 0);

        try {
            expect(result.fileNames).toHaveLength(4);
            expect(result.fileSizes).toHaveLength(4);

            // Verify all files exist
            for (const fileName of result.fileNames) {
                const filePath = path.join(result.inputDir, fileName);
                const stats = await fs.stat(filePath);
                expect(stats.isFile()).toBe(true);
            }
        } finally {
            await cleanupTempDirectory(result.tempDir);
        }
    });

    it('should continue processing if one file fails', async () => {
        const binaryData = {
            good: { fileName: 'good.txt' },
            bad: { fileName: 'bad.txt' },
            alsoGood: { fileName: 'also-good.txt' },
        };

        // Mock context that fails on 'bad' property
        const context = {
            getInputData: jest.fn().mockReturnValue([{ json: {}, binary: binaryData }]),
            helpers: {
                getBinaryDataBuffer: jest.fn().mockImplementation(async (itemIndex: number, propertyName: string) => {
                    if (propertyName === 'bad') {
                        throw new Error('Simulated failure');
                    }
                    return Buffer.from(`test-content-${propertyName}`);
                }),
            },
        } as any;

        const result = await prepareBinaryInputAuto(context, 0);

        try {
            // Should have processed the other two files
            expect(result.fileNames).toEqual(['good.txt', 'also-good.txt']);
            expect(result.fileSizes).toHaveLength(2);
        } finally {
            await cleanupTempDirectory(result.tempDir);
        }
    });

    it('should properly calculate file sizes', async () => {
        const binaryData = {
            small: { fileName: 'small.txt' },
            large: { fileName: 'large.txt' },
        };

        const context = {
            getInputData: jest.fn().mockReturnValue([{ json: {}, binary: binaryData }]),
            helpers: {
                getBinaryDataBuffer: jest.fn().mockImplementation(async (itemIndex: number, propertyName: string) => {
                    if (propertyName === 'small') {
                        return Buffer.from('small');
                    } else {
                        return Buffer.from('a'.repeat(1000));
                    }
                }),
            },
        } as any;

        const result = await prepareBinaryInputAuto(context, 0);

        try {
            expect(result.fileSizes).toHaveLength(2);
            expect(result.fileSizes[0]).toBe(5); // 'small' = 5 bytes
            expect(result.fileSizes[1]).toBe(1000); // 1000 'a's
        } finally {
            await cleanupTempDirectory(result.tempDir);
        }
    });
});
