import {
    parseDockerLogs,
    separateLogStreams,
    parseContainerResult,
    formatContainerResult,
    parseContainerError,
    sanitizeLogOutput,
    createLogSummary,
    LogStreamType,
    ParsedLogEntry,
    ContainerExecutionResult
} from '../../utils/logParser';

describe('RunContainer > utils > logParser', () => {
    describe('parseDockerLogs', () => {
        it('should parse empty logs', () => {
            const emptyBuffer = Buffer.alloc(0);
            const result = parseDockerLogs(emptyBuffer);
            expect(result).toEqual([]);
        });

        it('should parse single stdout entry', () => {
            // Create a mock Docker log entry with stdout (type 1)
            const logData = Buffer.concat([
                Buffer.from([1, 0, 0, 0, 0, 0, 0, 13]), // Header: stdout, 13 bytes
                Buffer.from('Hello World!\n') // Data
            ]);

            const result = parseDockerLogs(logData);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                stream: LogStreamType.STDOUT,
                text: 'Hello World!\n'
            });
            expect(result[0].data).toEqual(Buffer.from('Hello World!\n'));
            expect(result[0].timestamp).toBeInstanceOf(Date);
        });

        it('should parse single stderr entry', () => {
            // Create a mock Docker log entry with stderr (type 2)
            const logData = Buffer.concat([
                Buffer.from([2, 0, 0, 0, 0, 0, 0, 7]), // Header: stderr, 7 bytes
                Buffer.from('Error!\n') // Data
            ]);

            const result = parseDockerLogs(logData);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                stream: LogStreamType.STDERR,
                text: 'Error!\n'
            });
        });

        it('should parse multiple log entries', () => {
            // Create mock Docker log entries with both stdout and stderr
            const logData = Buffer.concat([
                Buffer.from([1, 0, 0, 0, 0, 0, 0, 6]), // Header: stdout, 6 bytes
                Buffer.from('stdout'), // Data
                Buffer.from([2, 0, 0, 0, 0, 0, 0, 7]), // Header: stderr, 7 bytes
                Buffer.from('stderr\n') // Data
            ]);

            const result = parseDockerLogs(logData);

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                stream: LogStreamType.STDOUT,
                text: 'stdout'
            });
            expect(result[1]).toMatchObject({
                stream: LogStreamType.STDERR,
                text: 'stderr\n'
            });
        });

        it('should handle incomplete log entries', () => {
            // Create incomplete log data (missing data for last entry)
            const logData = Buffer.concat([
                Buffer.from([1, 0, 0, 0, 0, 0, 0, 5]), // Header: stdout, 5 bytes
                Buffer.from('test'), // Data (4 bytes, should be 5)
                Buffer.from([2, 0, 0, 0, 0, 0, 0, 3]) // Header: stderr, 3 bytes (no data)
            ]);

            const result = parseDockerLogs(logData);

            expect(result).toHaveLength(1); // Only complete entry
            expect(result[0]).toMatchObject({
                stream: LogStreamType.STDOUT,
                text: 'test'
            });
        });

        it('should handle invalid stream types', () => {
            // Create log data with invalid stream type
            const logData = Buffer.concat([
                Buffer.from([3, 0, 0, 0, 0, 0, 0, 4]), // Header: invalid type (3), 4 bytes
                Buffer.from('test') // Data
            ]);

            const result = parseDockerLogs(logData);

            expect(result).toEqual([]); // Should ignore invalid stream types
        });

        it('should handle large log entries', () => {
            const largeMessage = 'A'.repeat(1000);
            const logData = Buffer.concat([
                Buffer.from([1, 0, 0, 0, 0, 0, 3, 232]), // Header: stdout, 1000 bytes (0x03E8)
                Buffer.from(largeMessage) // Data
            ]);

            const result = parseDockerLogs(logData);

            expect(result).toHaveLength(1);
            expect(result[0].text).toBe(largeMessage);
            expect(result[0].data.length).toBe(1000);
        });
    });

    describe('separateLogStreams', () => {
        it('should separate stdout and stderr logs', () => {
            const entries: ParsedLogEntry[] = [
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from('Output 1\n'),
                    text: 'Output 1\n'
                },
                {
                    stream: LogStreamType.STDERR,
                    data: Buffer.from('Error 1\n'),
                    text: 'Error 1\n'
                },
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from('Output 2\n'),
                    text: 'Output 2\n'
                }
            ];

            const result = separateLogStreams(entries);

            expect(result.stdoutText).toBe('Output 1\nOutput 2\n');
            expect(result.stderrText).toBe('Error 1\n');
            expect(result.stdout).toEqual(Buffer.concat([
                Buffer.from('Output 1\n'),
                Buffer.from('Output 2\n')
            ]));
            expect(result.stderr).toEqual(Buffer.from('Error 1\n'));
        });

        it('should handle empty entries', () => {
            const entries: ParsedLogEntry[] = [
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from('Valid output\n'),
                    text: 'Valid output\n'
                },
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from(''),
                    text: ''
                }
            ];

            const result = separateLogStreams(entries);

            expect(result.stdoutText).toBe('Valid output\n');
            expect(result.stderrText).toBe('');
        });

        it('should handle entries with only stdout', () => {
            const entries: ParsedLogEntry[] = [
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from('Only stdout\n'),
                    text: 'Only stdout\n'
                }
            ];

            const result = separateLogStreams(entries);

            expect(result.stdoutText).toBe('Only stdout\n');
            expect(result.stderrText).toBe('');
            expect(result.stderr.length).toBe(0);
        });

        it('should handle entries with only stderr', () => {
            const entries: ParsedLogEntry[] = [
                {
                    stream: LogStreamType.STDERR,
                    data: Buffer.from('Only stderr\n'),
                    text: 'Only stderr\n'
                }
            ];

            const result = separateLogStreams(entries);

            expect(result.stdoutText).toBe('');
            expect(result.stderrText).toBe('Only stderr\n');
            expect(result.stdout.length).toBe(0);
        });
    });

    describe('parseContainerResult', () => {
        it('should parse successful container result', () => {
            const logsBuffer = Buffer.concat([
                Buffer.from([1, 0, 0, 0, 0, 0, 0, 8]), // stdout: "Success\n" (8 bytes)
                Buffer.from('Success\n'),
                Buffer.from([2, 0, 0, 0, 0, 0, 0, 8]), // stderr: "Warning\n" (8 bytes)
                Buffer.from('Warning\n')
            ]);

            const result = parseContainerResult(logsBuffer, 0);

            expect(result).toMatchObject({
                stdoutText: 'Success\n',
                stderrText: 'Warning\n',
                exitCode: 0,
                hasStdout: true,
                hasStderr: true
            });
            expect(result.stdout).toEqual(Buffer.from('Success\n'));
            expect(result.stderr).toEqual(Buffer.from('Warning\n'));
            expect(result.logEntries).toHaveLength(2);
        });

        it('should handle failed container result', () => {
            const logsBuffer = Buffer.concat([
                Buffer.from([2, 0, 0, 0, 0, 0, 0, 14]), // stderr: "Error: failed\n" (14 bytes)
                Buffer.from('Error: failed\n')
            ]);

            const result = parseContainerResult(logsBuffer, 1);

            expect(result.exitCode).toBe(1);
            expect(result.stdoutText).toBe('');
            expect(result.stderrText).toBe('Error: failed\n');
            expect(result.hasStdout).toBe(false);
            expect(result.hasStderr).toBe(true);
        });

        it('should handle container with no output', () => {
            const logsBuffer = Buffer.alloc(0);
            const result = parseContainerResult(logsBuffer, 0);

            expect(result.stdoutText).toBe('');
            expect(result.stderrText).toBe('');
            expect(result.hasStdout).toBe(false);
            expect(result.hasStderr).toBe(false);
            expect(result.logEntries).toEqual([]);
        });
    });

    describe('formatContainerResult', () => {
        it('should format successful container result', () => {
            const containerResult: ContainerExecutionResult = {
                stdout: Buffer.from('Hello World\n'),
                stderr: Buffer.from(''),
                stdoutText: 'Hello World\n',
                stderrText: '',
                exitCode: 0,
                logEntries: [],
                hasStdout: true,
                hasStderr: false
            };

            const result = formatContainerResult(containerResult);

            expect(result).toMatchObject({
                stdout: 'Hello World\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true
            });
        });

        it('should format failed container result', () => {
            const containerResult: ContainerExecutionResult = {
                stdout: Buffer.from('Partial output\n'),
                stderr: Buffer.from('Fatal error\n'),
                stdoutText: 'Partial output\n',
                stderrText: 'Fatal error\n',
                exitCode: 1,
                logEntries: [],
                hasStdout: true,
                hasStderr: true
            };

            const result = formatContainerResult(containerResult);

            expect(result).toMatchObject({
                stdout: 'Partial output\n',
                stderr: 'Fatal error\n',
                exitCode: 1,
                success: false,
                hasOutput: true
            });
        });
    });

    describe('parseContainerError', () => {
        it('should parse no error case', () => {
            const result = parseContainerError('');

            expect(result).toMatchObject({
                hasError: false
            });
            expect(result.errorMessage).toBeUndefined();
            expect(result.errorType).toBeUndefined();
        });

        it('should parse no error case with whitespace', () => {
            const result = parseContainerError('   \n\t  ');

            expect(result.hasError).toBe(false);
        });

        it('should parse basic error message', () => {
            const result = parseContainerError('Command not found');

            expect(result).toMatchObject({
                hasError: true,
                errorMessage: 'Command not found',
                errorType: 'COMMAND_NOT_FOUND'
            });
        });

        it('should parse image not found error', () => {
            const result = parseContainerError('Error: No such image: nonexistent:latest');

            expect(result).toMatchObject({
                hasError: true,
                errorMessage: 'Error: No such image: nonexistent:latest',
                errorType: 'IMAGE_NOT_FOUND'
            });
        });

        it('should parse permission denied error', () => {
            const result = parseContainerError('Permission denied while accessing file');

            expect(result).toMatchObject({
                hasError: true,
                errorMessage: 'Permission denied while accessing file',
                errorType: 'PERMISSION_ERROR'
            });
        });

        it('should parse exit code error', () => {
            const result = parseContainerError('Script failed with exit code 127');

            expect(result).toMatchObject({
                hasError: true,
                errorMessage: 'Script failed with exit code 127',
                errorType: 'NON_ZERO_EXIT',
                errorCode: '127'
            });
        });

        it('should handle multi-line errors (use last line)', () => {
            const multiLineError = 'Warning: deprecated feature\nError: fatal error occurred\nExit code: 1';
            const result = parseContainerError(multiLineError);

            expect(result.errorMessage).toBe('Exit code: 1');
        });
    });

    describe('sanitizeLogOutput', () => {
        it('should sanitize null characters', () => {
            const result = sanitizeLogOutput('Hello\x00World');

            expect(result).toBe('HelloWorld');
        });

        it('should sanitize control characters', () => {
            const result = sanitizeLogOutput('Hello\x07World\x1FTest');

            expect(result).toBe('HelloWorldTest');
        });

        it('should preserve whitespace characters', () => {
            const result = sanitizeLogOutput('Line 1\n\tLine 2\r\nLine 3');

            expect(result).toBe('Line 1\n\tLine 2\r\nLine 3');
        });

        it('should handle empty input', () => {
            expect(sanitizeLogOutput('')).toBe('');
            expect(sanitizeLogOutput(null as any)).toBe('');
            expect(sanitizeLogOutput(undefined as any)).toBe('');
        });

        it('should trim whitespace', () => {
            const result = sanitizeLogOutput('  Hello World  \t\n');

            expect(result).toBe('Hello World  \t');
        });
    });

    describe('createLogSummary', () => {
        it('should create summary for mixed output', () => {
            const entries: ParsedLogEntry[] = [
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from('Output 1'),
                    text: 'Output 1',
                    timestamp: new Date('2023-01-01T12:00:00Z')
                },
                {
                    stream: LogStreamType.STDERR,
                    data: Buffer.from('Error 1'),
                    text: 'Error 1',
                    timestamp: new Date('2023-01-01T12:00:01Z')
                },
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from('Output 2'),
                    text: 'Output 2',
                    timestamp: new Date('2023-01-01T12:00:02Z')
                }
            ];

            const result = createLogSummary({
                stdout: Buffer.from('Output 1Output 2'),
                stderr: Buffer.from('Error 1'),
                stdoutText: 'Output 1Output 2',
                stderrText: 'Error 1',
                exitCode: 0,
                logEntries: entries,
                hasStdout: true,
                hasStderr: true
            });

            expect(result).toMatchObject({
                totalEntries: 3,
                stdoutEntries: 2,
                stderrEntries: 1,
                stdoutSize: 16, // "Output 1Output 2".length
                stderrSize: 7, // "Error 1".length
                executionTime: expect.any(Date),
                hasMixedStreams: true
            });
        });

        it('should handle output with only stdout', () => {
            const entries: ParsedLogEntry[] = [
                {
                    stream: LogStreamType.STDOUT,
                    data: Buffer.from('Only stdout'),
                    text: 'Only stdout',
                    timestamp: new Date()
                }
            ];

            const result = createLogSummary({
                stdout: Buffer.from('Only stdout'),
                stderr: Buffer.alloc(0),
                stdoutText: 'Only stdout',
                stderrText: '',
                exitCode: 0,
                logEntries: entries,
                hasStdout: true,
                hasStderr: false
            });

            expect(result).toMatchObject({
                totalEntries: 1,
                stdoutEntries: 1,
                stderrEntries: 0,
                hasMixedStreams: false
            });
        });

        it('should handle empty logs', () => {
            const result = createLogSummary({
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
                stdoutText: '',
                stderrText: '',
                exitCode: 0,
                logEntries: [],
                hasStdout: false,
                hasStderr: false
            });

            expect(result).toMatchObject({
                totalEntries: 0,
                stdoutEntries: 0,
                stderrEntries: 0,
                stdoutSize: 0,
                stderrSize: 0,
                hasMixedStreams: false
            });
            expect(result.executionTime).toBeUndefined();
        });
    });
});