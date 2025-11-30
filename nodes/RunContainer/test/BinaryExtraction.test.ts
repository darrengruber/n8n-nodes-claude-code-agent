
import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { copyFilesFromVolume } from '../ContainerHelpers';
import { Readable } from 'stream';
import { execSync } from 'child_process';

// Mock Dockerode
jest.mock('dockerode');

describe('Binary Extraction Logic', () => {
    let tmpDir: string;
    let tarFilePath: string;

    beforeEach(() => {
        jest.setTimeout(10000);
        // Create a temporary directory for the test
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-test-binary-'));

        // Create a dummy file to tar
        const dummyFile = path.join(tmpDir, 'test.png');
        fs.writeFileSync(dummyFile, 'fake-png-data');

        // Create a valid tar file containing the dummy file
        tarFilePath = path.join(tmpDir, 'test.tar');
        // Create tar with just the file at root
        execSync(`tar -cf "${tarFilePath}" -C "${tmpDir}" test.png`);
    });

    afterEach(() => {
        // Cleanup
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        jest.clearAllMocks();
    });

    it('should correctly extract a single file from a tar stream without stripping components', async () => {
        const mockDocker = new Docker();
        const mockContainer = {
            start: jest.fn().mockResolvedValue(undefined),
            exec: jest.fn(),
            getArchive: jest.fn(),
            remove: jest.fn().mockResolvedValue(undefined),
        };

        (mockDocker.createContainer as jest.Mock).mockResolvedValue(mockContainer);

        // Mock exec to simulate finding the file
        const mockExec = {
            start: jest.fn().mockImplementation(async () => {
                // Return a stream that simulates the output of the find/ls command
                // We need to simulate the multiplexed Docker log format
                // Header: [STREAM_TYPE, 0, 0, 0, SIZE_B1, SIZE_B2, SIZE_B3, SIZE_B4]
                // Stream Type: 1 = stdout

                const filename = 'test.png\n';
                const payload = Buffer.from(filename);
                const header = Buffer.alloc(8);
                header.writeUInt8(1, 0); // stdout
                header.writeUInt32BE(payload.length, 4);

                const output = Buffer.concat([header, payload]);

                const stream = new Readable();
                stream.push(output);
                stream.push(null);
                return stream;
            }),
        };
        (mockContainer.exec as jest.Mock).mockResolvedValue(mockExec);

        // Mock getArchive to return the valid tar stream
        (mockContainer.getArchive as jest.Mock).mockImplementation(() => {
            console.log('Mock getArchive called');
            return fs.createReadStream(tarFilePath);
        });

        const outputDir = path.join(tmpDir, 'output');

        console.log('Calling copyFilesFromVolume');
        // Execute
        const result = await copyFilesFromVolume(
            mockDocker,
            'test-volume',
            '/agent/workspace',
            '/agent/workspace/output/test.png', // Requesting specific file
            outputDir
        );
        console.log('copyFilesFromVolume returned');

        // Verify
        expect(result.tarContents).toContain('test.png');

        // Check if file exists in output directory
        const extractedFile = path.join(outputDir, 'test.png');
        expect(fs.existsSync(extractedFile)).toBe(true);
        expect(fs.readFileSync(extractedFile, 'utf8')).toBe('fake-png-data');
    }, 20000);
});
