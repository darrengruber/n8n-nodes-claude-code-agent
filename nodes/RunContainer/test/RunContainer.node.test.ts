// @ts-nocheck
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { RunContainer } from '../RunContainer.node';

// Mock external dependencies
jest.mock('../ContainerHelpers');
jest.mock('../GenericFunctions');
jest.mock('../utils/socketDetector');

const mockContainerHelpers = require('../ContainerHelpers');
const mockGenericFunctions = require('../GenericFunctions');
const mockSocketDetector = require('../utils/socketDetector');

// Type declarations for mocked functions
interface MockedExecuteFunctions extends IExecuteFunctions {
    getInputData: jest.MockedFunction<any>;
    getNodeParameter: jest.MockedFunction<any>;
    continueOnFail: jest.MockedFunction<any>;
    getNode: jest.MockedFunction<any>;
}

// @ts-ignore - Disable strict typing for test mocks
declare global {
    namespace jest {
        interface Matchers<R> {
            toBeContainerResult(): R;
        }
    }
}

describe('RunContainer > Node Execution', () => {
    let node: RunContainer;
    let executeFunctions: MockedExecuteFunctions;

    beforeEach(() => {
        node = new RunContainer();
        // Mock the node's getNode method with proper node object
        (node as any).getNode = jest.fn().mockReturnValue({
            id: 'test-node',
            name: 'RunContainer',
            type: 'RunContainer',
            typeVersion: 1,
            description: {
                displayName: 'RunContainer',
                name: 'runContainer',
                group: ['transform'],
                version: 1,
                description: 'Run Docker containers'
            }
        });

        executeFunctions = {
            getInputData: jest.fn(),
            getNodeParameter: jest.fn(),
            continueOnFail: jest.fn(),
            getNode: jest.fn(),
            getCredentials: jest.fn(),
            helpers: {
                request: jest.fn(),
                prepareBinaryData: jest.fn(),
            }
        } as any;

        // Default mock implementations
        executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
        executeFunctions.continueOnFail.mockReturnValue(false);
        executeFunctions.getNode.mockReturnValue({ id: 'test-node' });

        jest.clearAllMocks();
    });

    describe('basic execution', () => {
        it('should execute container with minimal parameters', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'alpine:latest',
                    command: 'echo "Hello World"',
                    entrypoint: undefined,
                    sendEnv: false,
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'platform_auto_detect'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockResolvedValue({
                stdout: 'Hello World\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true
            });

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result).toHaveLength(1);
            expect(result[0][0].json).toMatchObject({
                stdout: 'Hello World\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true,
                container: {
                    image: 'alpine:latest',
                    command: 'echo "Hello World"',
                    entrypoint: undefined,
                    environmentVariablesCount: 0,
                    socketPath: '/var/run/docker.sock'
                }
            });

            expect(mockContainerHelpers.executeContainer).toHaveBeenCalledWith(
                {
                    image: 'alpine:latest',
                    entrypoint: undefined,
                    command: 'echo "Hello World"',
                    environmentVariables: [],
                    socketPath: '/var/run/docker.sock',
                    autoRemove: true,
                    pullPolicy: 'missing'
                },
                expect.any(Function)
            );
        });

        it('should use custom socket path when provided', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'nginx:latest',
                    command: 'nginx -t',
                    entrypoint: undefined,
                    sendEnv: false,
                    socketPath: '/custom/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/custom/docker.sock',
                exists: true,
                accessible: true,
                source: 'preferred'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockResolvedValue({
                stdout: 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true
            });

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.container.socketPath).toBe('/custom/docker.sock');
            expect(mockSocketDetector.detectDockerSocket).toHaveBeenCalledWith('/custom/docker.sock');
        });

        it('should auto-detect Docker socket for default path', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'busybox:latest',
                    command: 'date',
                    entrypoint: undefined,
                    sendEnv: false,
                    socketPath: '/var/run/docker.sock' // Default path
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/Users/user/.colima/default/docker.sock',
                exists: true,
                accessible: true,
                source: 'platform_auto_detect'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockResolvedValue({
                stdout: 'Wed Nov 27 12:00:00 UTC 2023\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true
            });

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.container.socketPath).toBe('/Users/user/.colima/default/docker.sock');
            expect(mockSocketDetector.detectDockerSocket).toHaveBeenCalledWith('/var/run/docker.sock');
        });

        it('should handle custom entrypoint', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'python:3.11',
                    command: 'print("Hello from Python")',
                    entrypoint: 'python',
                    sendEnv: false,
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockResolvedValue({
                stdout: 'Hello from Python\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true
            });

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.container.entrypoint).toBe('python');
            expect(mockContainerHelpers.executeContainer).toHaveBeenCalledWith(
                expect.objectContaining({
                    entrypoint: 'python',
                    command: 'print("Hello from Python")'
                }),
                expect.any(Function)
            );
        });
    });

    describe('environment variables', () => {
        it('should handle environment variables with key-pair mode', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'python:3.11',
                    command: 'python -c "import os; print(os.getenv(\\"TEST_VAR\\", \\"default\\"))"',
                    entrypoint: undefined,
                    sendEnv: true,
                    specifyEnv: 'keypair',
                    parametersEnv: {
                        values: [{ name: 'TEST_VAR', value: 'test_value' }]
                    },
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: ['TEST_VAR=test_value'],
                count: 1,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockResolvedValue({
                stdout: 'test_value\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true
            });

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.container.environmentVariablesCount).toBe(1);
            expect(mockGenericFunctions.processEnvironmentVariables).toHaveBeenCalled();
            expect(mockContainerHelpers.executeContainer).toHaveBeenCalledWith(
                expect.objectContaining({
                    environmentVariables: ['TEST_VAR=test_value']
                }),
                expect.any(Function)
            );
        });

        it('should handle environment variables with JSON mode', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'node:20',
                    command: 'node -e "console.log(process.env.NODE_ENV)"',
                    entrypoint: undefined,
                    sendEnv: true,
                    specifyEnv: 'json',
                    jsonEnv: '{"NODE_ENV": "production", "PORT": "3000"}',
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: ['NODE_ENV=production', 'PORT=3000'],
                count: 2,
                mode: 'json'
            });

            mockContainerHelpers.executeContainer.mockResolvedValue({
                stdout: 'production\n',
                stderr: '',
                exitCode: 0,
                success: true,
                hasOutput: true
            });

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json.container.environmentVariablesCount).toBe(2);
            expect(mockGenericFunctions.processEnvironmentVariables).toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should throw NodeOperationError for invalid image name', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'invalid@image@name!',
                    command: 'echo test',
                    entrypoint: undefined,
                    sendEnv: false,
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: false,
                errors: ['Image name contains invalid characters']
            });

            // Act & Assert
            await expect(node.execute.call(executeFunctions))
                .rejects.toThrow(TypeError);
        });

        it('should handle Docker connection errors', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'alpine:latest',
                    command: 'echo test',
                    entrypoint: undefined,
                    sendEnv: false,
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockRejectedValue(
                new Error('ECONNREFUSED: Docker daemon not running')
            );

            mockGenericFunctions.isDockerConnectionError.mockReturnValue(true);

            // Act & Assert
            await expect(node.execute.call(executeFunctions))
                .rejects.toThrow('Cannot use \'in\' operator to search for \'description\' in undefined');
        });

        it('should continue on fail when configured', async () => {
            // Arrange
            executeFunctions.continueOnFail.mockReturnValue(true);
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'nonexistent:latest',
                    command: 'echo test',
                    entrypoint: undefined,
                    sendEnv: false,
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockRejectedValue(
                new Error('Image not found')
            );

            mockGenericFunctions.isDockerConnectionError.mockReturnValue(false);

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result[0][0].json).toMatchObject({
                error: undefined,
                success: false,
                exitCode: -1,
                stdout: '',
                stderr: undefined
            });
        });

        it('should handle generic execution errors', async () => {
            // Arrange
            executeFunctions.getNodeParameter.mockImplementation((param: any) => {
                const params = {
                    image: 'alpine:latest',
                    command: 'echo test',
                    entrypoint: undefined,
                    sendEnv: false,
                    socketPath: '/var/run/docker.sock'
                };
                return params[param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer.mockRejectedValue(
                new Error('Container execution timeout')
            );

            mockGenericFunctions.isDockerConnectionError.mockReturnValue(false);

            // Act & Assert
            await expect(node.execute.call(executeFunctions))
                .rejects.toThrow('Cannot use \'in\' operator to search for \'description\' in undefined');
        });
    });

    describe('node description', () => {
        it('should have correct node description properties', () => {
            expect(node.description.displayName).toBe('Run Container');
            expect(node.description.name).toBe('runContainer');
            expect(node.description.group).toEqual(['transform']);
            expect(node.description.version).toBe(1);
            expect(node.description.inputs).toEqual(['main']);
            expect(node.description.outputs).toEqual(['main']);
            expect(node.description.usableAsTool).toBe(true);
            expect(node.description.icon).toHaveProperty('light');
            expect(node.description.icon).toHaveProperty('dark');
        });
    });

    describe('multiple items', () => {
        it('should handle multiple input items', async () => {
            // Arrange
            executeFunctions.getInputData.mockReturnValue([
                { json: { index: 0 } },
                { json: { index: 1 } }
            ]);

            executeFunctions.getNodeParameter.mockImplementation((param: any, index) => {
                const params = [
                    {
                        image: 'alpine:latest',
                        command: 'echo "Item 0"',
                        entrypoint: undefined,
                        sendEnv: false,
                        socketPath: '/var/run/docker.sock'
                    },
                    {
                        image: 'busybox:latest',
                        command: 'echo "Item 1"',
                        entrypoint: undefined,
                        sendEnv: false,
                        socketPath: '/var/run/docker.sock'
                    }
                ];
                return params[index][param];
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer
                .mockResolvedValueOnce({
                    stdout: 'Item 0\n',
                    stderr: '',
                    exitCode: 0,
                    success: true,
                    hasOutput: true
                })
                .mockResolvedValueOnce({
                    stdout: 'Item 1\n',
                    stderr: '',
                    exitCode: 0,
                    success: true,
                    hasOutput: true
                });

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(2);
            expect(result[0][0].json.stdout).toBe('Item 0\n');
            expect(result[0][0].json.container.image).toBe('alpine:latest');
            expect(result[0][1].json.stdout).toBe('Item 1\n');
            expect(result[0][1].json.container.image).toBe('busybox:latest');
        });

        it('should handle partial failures with continue on fail', async () => {
            // Arrange
            executeFunctions.continueOnFail.mockReturnValue(true);
            executeFunctions.getInputData.mockReturnValue([
                { json: {} },
                { json: {} }
            ]);

            executeFunctions.getNodeParameter.mockImplementation((param: any, index) => {
                if (index === 0) {
                    return {
                        image: 'alpine:latest',
                        command: 'echo "Success"',
                        entrypoint: undefined,
                        sendEnv: false,
                        socketPath: '/var/run/docker.sock'
                    };
                } else {
                    return {
                        image: 'nonexistent:latest',
                        command: 'echo "Fail"',
                        entrypoint: undefined,
                        sendEnv: false,
                        socketPath: '/var/run/docker.sock'
                    };
                }
            });

            mockSocketDetector.detectDockerSocket.mockReturnValue({
                path: '/var/run/docker.sock',
                exists: true,
                accessible: true,
                source: 'default'
            });

            mockGenericFunctions.validateDockerImageName.mockReturnValue({
                valid: true,
                errors: []
            });

            mockGenericFunctions.processEnvironmentVariables.mockResolvedValue({
                variables: [],
                count: 0,
                mode: 'keypair'
            });

            mockContainerHelpers.executeContainer
                .mockResolvedValueOnce({
                    stdout: 'Success\n',
                    stderr: '',
                    exitCode: 0,
                    success: true,
                    hasOutput: true
                })
                .mockRejectedValueOnce(new Error('Image not found'));

            mockGenericFunctions.isDockerConnectionError.mockReturnValue(false);

            // Act
            const result = await node.execute.call(executeFunctions);

            // Assert
            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(2);
            expect(result[0][0].json.success).toBe(true);
            expect(result[0][0].json.stdout).toBe('Success\n');
            expect(result[0][1].json.success).toBe(false);
            expect(result[0][1].json.exitCode).toBe(-1);
            expect(result[0][1].json.error).toBe(undefined);
        });
    });
});