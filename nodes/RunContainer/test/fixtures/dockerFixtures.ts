/**
 * Test fixtures for Docker-related functionality
 * Provides mock responses and test data for Docker operations
 */

export const mockContainerResponses = {
    createSuccess: {
        Id: 'test-container-123',
        Warnings: []
    },
    startSuccess: null, // 204 No Content
    waitSuccess: {
        StatusCode: 0
    },
    waitFailure: {
        StatusCode: 1
    },
    logsSuccess: 'Container output logs\nSecond line of output\n',
    logsEmpty: '',
    logsWithError: 'Warning: deprecated feature\nError: operation failed\n',
    containerInfo: {
        Id: 'test-container-123',
        Image: 'alpine:latest',
        State: {
            Status: 'running',
            Running: true,
            ExitCode: 0,
            StartedAt: '2023-11-27T12:00:00Z',
            FinishedAt: null
        },
        Config: {
            Env: ['NODE_ENV=production', 'PORT=3000'],
            Cmd: ['echo', 'Hello World'],
            Entrypoint: ['/bin/sh']
        }
    }
};

export const mockErrorResponses = {
    imageNotFound: {
        message: 'Error response from daemon: pull access denied for nonexistent, repository does not exist',
        statusCode: 404
    },
    containerNotFound: {
        message: 'Error: No such container: nonexistent-container',
        statusCode: 404
    },
    dockerDaemonNotRunning: {
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED /var/run/docker.sock'
    },
    permissionDenied: {
        code: 'EACCES',
        message: 'permission denied while trying to connect to the Docker daemon socket'
    },
    timeoutError: {
        code: 'ETIMEDOUT',
        message: 'operation timed out'
    },
    invalidImageFormat: {
        message: 'Invalid image format: image name cannot contain special characters',
        statusCode: 400
    }
};

export const mockDockerImages = [
    {
        Id: 'sha256:abc123def456',
        RepoTags: ['alpine:latest', 'alpine:3.18'],
        Size: 5844928,
        Created: 1698451200
    },
    {
        Id: 'sha256:789012345678',
        RepoTags: ['nginx:latest', 'nginx:alpine'],
        Size: 142584041,
        Created: 1698451200
    },
    {
        Id: 'sha256:345678901234',
        RepoTags: ['python:3.11', 'python:3.11-alpine'],
        Size: 49560423,
        Created: 1698451200
    }
];

export const mockEnvironmentVariables = {
    valid: [
        { name: 'NODE_ENV', value: 'production' },
        { name: 'PORT', value: '3000' },
        { name: 'DEBUG', value: 'true' }
    ],
    invalid: [
        { name: 'INVALID-KEY', value: 'test' }, // Invalid key format
        { name: '', value: 'test' }, // Empty key
        { name: 'VALID_KEY', value: '' }, // Empty value (should be allowed)
    ],
    json: {
        'API_KEY': 'secret-key',
        'ENDPOINT': 'https://api.example.com',
        'TIMEOUT': '30'
    }
};

export const mockDockerCommands = [
    {
        input: 'echo "Hello World"',
        parsed: ['echo', 'Hello World'],
        built: 'echo "Hello World"'
    },
    {
        input: 'git commit -m "fix: resolve bug"',
        parsed: ['git', 'commit', '-m', 'fix: resolve bug'],
        built: 'git commit -m "fix: resolve bug"'
    },
    {
        input: 'python -c "import json; print(json.dumps({\\"key\\": \\"value\\"}))"',
        parsed: ['python', '-c', 'import json; print(json.dumps({"key": "value"}))'],
        built: 'python -c "import json; print(json.dumps({\\"key\\": \\"value\\"}))"'
    },
    {
        input: 'ls -la /home/user',
        parsed: ['ls', '-la', '/home/user'],
        built: 'ls -la /home/user'
    },
    {
        input: 'curl -X POST -H "Content-Type: application/json" -d \'{"test": true}\' http://example.com',
        parsed: ['curl', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', '{"test": true}', 'http://example.com'],
        built: 'curl -X POST -H "Content-Type: application/json" -d "{\\"test\\": true}" http://example.com'
    }
];

export const mockDockerSocketPaths = {
    linux: [
        '/var/run/docker.sock',
        '/run/docker.sock',
        '/var/snap/docker/current/run/docker.sock'
    ],
    macos: [
        '/var/run/docker.sock',
        '/Users/testuser/.docker/run/docker.sock',
        '/Users/testuser/.colima/default/docker.sock',
        '/Users/testuser/.colima/colima/docker.sock',
        '/Users/docker/.docker/run/docker.sock'
    ],
    windows: [
        '//./pipe/docker_engine',
        '\\\\.\\pipe\\docker_engine'
    ]
};

export const mockLogEntries = [
    {
        stream: 1, // stdout
        data: Buffer.from('Application started\n'),
        text: 'Application started\n',
        timestamp: new Date('2023-11-27T12:00:00Z')
    },
    {
        stream: 2, // stderr
        data: Buffer.from('Warning: deprecated API used\n'),
        text: 'Warning: deprecated API used\n',
        timestamp: new Date('2023-11-27T12:00:01Z')
    },
    {
        stream: 1, // stdout
        data: Buffer.from('Processing request...\n'),
        text: 'Processing request...\n',
        timestamp: new Date('2023-11-27T12:00:02Z')
    }
];

export const mockMultiplexedLogs = {
    simple: Buffer.concat([
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 11]), // stdout, 11 bytes
        Buffer.from('Hello World\n')
    ]),
    mixed: Buffer.concat([
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 15]), // stdout, 15 bytes
        Buffer.from('Application started\n'),
        Buffer.from([2, 0, 0, 0, 0, 0, 0, 21]), // stderr, 21 bytes
        Buffer.from('Warning: configuration issue\n')
    ]),
    empty: Buffer.alloc(0),
    large: Buffer.concat([
        Buffer.from([1, 0, 0, 0, 0, 3, 232, 4]), // stdout, 1000 bytes
        Buffer.from('A'.repeat(1000))
    ])
};

export const mockContainerStats = {
    basic: {
        cpuUsage: 15.5,
        memoryUsage: 52428800, // 50MB
        networkIO: {
            rxBytes: 1024,
            txBytes: 2048
        }
    },
    noNetwork: {
        cpuUsage: 8.2,
        memoryUsage: 33554432 // 32MB
    },
    highResource: {
        cpuUsage: 85.7,
        memoryUsage: 1073741824, // 1GB
        networkIO: {
            rxBytes: 1048576, // 1MB
            txBytes: 2097152  // 2MB
        }
    }
};

export const mockTestWorkflows = {
    basicContainerExecution: {
        name: 'Basic Container Execution',
        nodes: [
            {
                parameters: {},
                name: 'Manual Trigger',
                type: 'n8n-nodes-base.manualTrigger',
                typeVersion: 1,
                position: [240, 300],
                id: 'trigger-node'
            },
            {
                parameters: {
                    image: 'alpine:latest',
                    command: 'echo "Hello from container!"',
                    sendEnv: false
                },
                name: 'Run Container',
                type: 'n8n-nodes-base.runContainer',
                typeVersion: 1,
                position: [460, 300],
                id: 'container-node'
            }
        ],
        connections: {
            'Manual Trigger': {
                main: [[{
                    node: 'Run Container',
                    type: 'main',
                    index: 0
                }]]
            }
        }
    },
    containerWithEnvironmentVariables: {
        name: 'Container with Environment Variables',
        nodes: [
            {
                parameters: {},
                name: 'Manual Trigger',
                type: 'n8n-nodes-base.manualTrigger',
                typeVersion: 1,
                position: [240, 300],
                id: 'trigger-node'
            },
            {
                parameters: {
                    image: 'python:3.11-alpine',
                    command: 'python -c "import os; print(f\\"Hello {os.getenv(\\"NAME\\", \\"World\\\")}!\\""',
                    sendEnv: true,
                    specifyEnv: 'keypair',
                    parametersEnv: {
                        values: [
                            { name: 'NAME', value: 'Docker' },
                            { name: 'VERSION', value: '3.11' }
                        ]
                    }
                },
                name: 'Run Container',
                type: 'n8n-nodes-base.runContainer',
                typeVersion: 1,
                position: [460, 300],
                id: 'container-node'
            }
        ],
        connections: {
            'Manual Trigger': {
                main: [[{
                    node: 'Run Container',
                    type: 'main',
                    index: 0
                }]]
            }
        }
    },
    errorScenario: {
        name: 'Container Error Scenario',
        nodes: [
            {
                parameters: {},
                name: 'Manual Trigger',
                type: 'n8n-nodes-base.manualTrigger',
                typeVersion: 1,
                position: [240, 300],
                id: 'trigger-node'
            },
            {
                parameters: {
                    image: 'nonexistent:latest',
                    command: 'echo "This should fail"',
                    sendEnv: false
                },
                name: 'Run Container',
                type: 'n8n-nodes-base.runContainer',
                typeVersion: 1,
                position: [460, 300],
                id: 'container-node'
            }
        ],
        connections: {
            'Manual Trigger': {
                main: [[{
                    node: 'Run Container',
                    type: 'main',
                    index: 0
                }]]
            }
        }
    }
};

export const mockFileOperations = {
    dockerSocketExists: {
        '/var/run/docker.sock': true,
        '/run/docker.sock': false,
        '/Users/testuser/.colima/default/docker.sock': true,
        '/custom/docker.sock': false
    },
    dockerSocketAccessible: {
        '/var/run/docker.sock': true,
        '/run/docker.sock': false,
        '/Users/testuser/.colima/default/docker.sock': true,
        '/custom/docker.sock': false
    }
};

// Helper function to create mock container execution result
export function createMockContainerResult(overrides: Partial<any> = {}) {
    return {
        stdout: 'Mock output\n',
        stderr: '',
        exitCode: 0,
        success: true,
        hasOutput: true,
        container: {
            image: 'alpine:latest',
            command: 'echo "Mock"',
            entrypoint: '',
            environmentVariablesCount: 0,
            socketPath: '/var/run/docker.sock'
        },
        ...overrides
    };
}

// Helper function to create mock Docker log entry
export function createMockLogEntry(overrides: Partial<any> = {}) {
    return {
        stream: 1, // stdout
        data: Buffer.from('Mock log entry\n'),
        text: 'Mock log entry\n',
        timestamp: new Date(),
        ...overrides
    };
}