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
        description: 'The Docker image to run. Examples: alpine:latest for minimal shell, python:3.11 for Python scripts, node:20 for JavaScript',
    },
    {
        displayName: 'Pull Image If Not Present',
        name: 'pullImage',
        type: 'boolean',
        default: true,
        description: 'Automatically pull the image from the registry if it does not exist locally. If disabled and the image is missing, the operation will fail.',
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
];

