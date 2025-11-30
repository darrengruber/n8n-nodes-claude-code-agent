import type { INodeProperties } from 'n8n-workflow';

export const mainProperties: INodeProperties[] = [
    {
        displayName: 'Socket Path',
        name: 'socketPath',
        type: 'string',
        default: '/var/run/docker.sock',
        description: 'Path to the Docker socket. On macOS with Colima, use ~/.colima/default/docker.sock (e.g., /Users/username/.colima/default/docker.sock). On Linux, typically /var/run/docker.sock',
    },
    {
        displayName: 'Tool Description',
        name: 'toolDescription',
        type: 'string',
        default: 'Runs a Docker container with the specified image, entrypoint, and command. Automatically executes the container and returns stdout, stderr, and exit code. Use this tool whenever you need to run code, execute commands, or test something in an isolated Docker environment. Provide the image name (e.g., "alpine:latest", "python:3.11"), optionally an entrypoint (e.g., "/bin/sh", "python"), and the command arguments to pass to it.',
        description: 'Explain to LLM what this tool does and when to use it',
        typeOptions: {
            rows: 3,
        },
        displayOptions: {
            show: {
                '@tool': [true],
            },
        },
    },
    {
        displayName: 'Docker Image',
        name: 'image',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'e.g., alpine:latest, python:3.11, node:20',
        description: 'The Docker image to run. Examples: alpine:latest for minimal shell, python:3.11 for Python scripts, node:20 for JavaScript. The image will be automatically pulled if it does not exist locally.',
    },
    {
        displayName: 'Entrypoint',
        name: 'entrypoint',
        type: 'string',
        default: '',
        placeholder: 'e.g., /bin/sh, python, node',
        description: 'Override the default entrypoint of the image. Leave empty to use the image default. This is the executable that will be run.',
    },
    {
        displayName: 'Command',
        name: 'command',
        type: 'string',
        default: '',
        placeholder: 'e.g., -c "echo Hello World", /app/script.py, --version',
        description: 'The command arguments to pass to the entrypoint. This is what gets executed after the entrypoint.',
    },
    {
        displayName: 'Send Environment Variables',
        name: 'sendEnv',
        type: 'boolean',
        default: false,
        noDataExpression: true,
        description: 'Whether the container has environment variables or not',
    },
    {
        displayName: 'Specify Environment Variables',
        name: 'specifyEnv',
        type: 'options',
        displayOptions: {
            show: {
                sendEnv: [true],
            },
        },
        options: [
            {
                name: 'Using Fields Below',
                value: 'keypair',
            },
            {
                name: 'Using JSON',
                value: 'json',
            },
        ],
        default: 'keypair',
        description: 'How to specify environment variables',
    },
    {
        displayName: 'Environment Variables',
        name: 'parametersEnv',
        type: 'fixedCollection',
        typeOptions: {
            multipleValues: true,
        },
        placeholder: 'Add Environment Variable',
        displayOptions: {
            show: {
                sendEnv: [true],
                specifyEnv: ['keypair'],
            },
        },
        default: {
            values: [
                {
                    name: '',
                    value: '',
                },
            ],
        },
        options: [
            {
                name: 'values',
                displayName: 'Values',
                values: [
                    {
                        displayName: 'Key',
                        name: 'name',
                        type: 'string',
                        default: '',
                        description: 'Environment variable name',
                    },
                    {
                        displayName: 'Value',
                        name: 'value',
                        type: 'string',
                        default: '',
                        description: 'Environment variable value',
                    },
                ],
            },
        ],
    },
    {
        displayName: 'JSON',
        name: 'jsonEnv',
        type: 'json',
        displayOptions: {
            show: {
                sendEnv: [true],
                specifyEnv: ['json'],
            },
        },
        default: '',
        description: 'Environment variables as JSON object',
    },
    {
        displayName: 'Model Input Description',
        name: 'modelInputDescription',
        type: 'string',
        default: 'Environment variables as a JSON object. Provide all environment variables as key-value pairs.',
        description: 'Explain to the LLM how it should generate the environment variables',
        typeOptions: {
            rows: 3,
        },
        displayOptions: {
            show: {
                sendEnv: [true],
                specifyEnv: ['model'],
            },
        },
    },
    {
        displayName: 'Binary Data Input',
        name: 'binaryDataInput',
        type: 'boolean',
        default: false,
        noDataExpression: true,
        description: 'Whether to pass binary files from n8n to the container',
    },
    {
        displayName: 'Binary File Mappings',
        name: 'binaryFileMappings',
        type: 'fixedCollection',
        typeOptions: {
            multipleValues: true,
        },
        placeholder: 'Add Binary File',
        displayOptions: {
            show: {
                // Hidden - we now use automatic mode
                '@version': [999],
            },
        },
        default: {
            mappings: [
                {
                    binaryPropertyName: 'data',
                    containerPath: '/agent/workspace/input/file',
                },
            ],
        },
        options: [
            {
                name: 'mappings',
                displayName: 'File Mappings',
                values: [
                    {
                        displayName: 'Binary Property Name',
                        name: 'binaryPropertyName',
                        type: 'string',
                        default: 'data',
                        required: true,
                        description: 'Name of the binary property containing the file to pass to the container',
                        placeholder: 'data',
                    },
                    {
                        displayName: 'Container Path',
                        name: 'containerPath',
                        type: 'string',
                        default: '/agent/workspace/input/file',
                        required: true,
                        description: 'Path where the file will be available inside the container',
                        placeholder: '/agent/workspace/input/image.png',
                    },
                ],
            },
        ],
    },
    {
        displayName: 'Binary Data Output',
        name: 'binaryDataOutput',
        type: 'boolean',
        default: false,
        noDataExpression: true,
        description: 'Whether to collect binary output files from the container',
    },
    {
        displayName: 'Output Directory',
        name: 'outputDirectory',
        type: 'string',
        default: '/agent/workspace/output',
        displayOptions: {
            show: {
                binaryDataOutput: [true],
            },
        },
        description: 'Directory inside the container where output files will be collected from',
        placeholder: '/agent/workspace/output',
    },
    {
        displayName: 'Output File Pattern',
        name: 'outputFilePattern',
        type: 'string',
        default: '*',
        displayOptions: {
            show: {
                binaryDataOutput: [true],
            },
        },
        description: 'Pattern to filter output files. Use * for all files, or specify patterns like *.pdf, result_*.png (comma-separated)',
        placeholder: '*.pdf, result_*.png',
    },
    {
        displayName: 'Workspace Mount Path',
        name: 'workspaceMountPath',
        type: 'string',
        default: '/agent/workspace',
        description: 'Path inside the container where the workspace volume will be mounted. This is used for binary file operations and output handling.',
        placeholder: '/agent/workspace',
    },
    {
        displayName: 'Binary Input Path',
        name: 'binaryInputPath',
        type: 'string',
        default: '/agent/workspace/input',
        description: 'Path inside the container where binary input files will be mounted. Used when binary data input is enabled.',
        placeholder: '/agent/workspace/input',
    },
];
