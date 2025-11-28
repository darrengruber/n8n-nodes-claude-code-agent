# n8n Node Structure Patterns

This document outlines the established patterns and best practices for organizing n8n custom nodes, based on analysis of the official n8n codebase and community conventions.

## Overview

n8n nodes follow different organizational patterns based on their complexity and requirements. Understanding these patterns helps create maintainable, testable, and reusable node implementations.

## Pattern Types

### 1. Simple Node Pattern (ExecuteCommand-style)

**Use Case**: Basic functionality with minimal complexity
**Structure**: Single file implementation

```
SimpleNode/
├── SimpleNode.node.ts          # Main node implementation
├── SimpleNode.node.json        # Node metadata and documentation
└── test/
    ├── SimpleNode.node.test.ts # Unit tests
    └── workflow.json           # Test workflow data
```

**Characteristics**:
- All logic contained in one `.node.ts` file
- Inline property definitions in the description
- Direct execution without complex abstractions
- Minimal utility functions
- Simple test structure

**Example Implementation**:
```typescript
export class SimpleNode implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Simple Node',
        name: 'simpleNode',
        // ... inline properties
        properties: [
            {
                displayName: 'Input',
                name: 'input',
                type: 'string',
                // ... property definition
            }
        ]
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        // Direct implementation
        const input = this.getNodeParameter('input', 0) as string;
        return [{
            json: { result: input.toUpperCase() }
        }];
    }
}
```

### 2. Advanced Node Pattern (HttpRequest-style)

**Use Case**: Complex functionality requiring separation of concerns
**Structure**: Modular file organization

```
AdvancedNode/
├── AdvancedNode.node.ts              # Main entry point
├── AdvancedNode.node.json            # Node metadata
├── GenericFunctions.ts               # Shared utility functions
├── interfaces.ts                     # TypeScript interfaces
├── Description.ts                    # UI properties definitions
├── V1/                               # Version-specific implementations
│   └── AdvancedNodeV1.node.ts
├── V2/
│   ├── AdvancedNodeV2.node.ts        # Version 2 implementation
│   ├── Description.ts               # UI properties for V2
│   └── utils/                       # Version-specific utilities
│       ├── binaryData.ts           # Binary data utilities
│       └── parse.ts                # Response parsing utilities
├── shared/
│   └── optimizeResponse.ts          # Shared response optimization
├── icon.svg                         # Light theme icon
├── icon.dark.svg                    # Dark theme icon
└── test/                            # Comprehensive test suite
    ├── node/                        # Main node tests
    ├── utils/                       # Utility function tests
    └── versions/                    # Version-specific tests
```

**Characteristics**:
- **Separation of concerns**: UI, logic, utilities in separate files
- **Version management**: Multiple versions with upgrade paths
- **Modular utilities**: Organized by functionality
- **Comprehensive testing**: Separate test directories
- **Shared resources**: Common functionality across versions

### 3. API Integration Pattern (Freshservice-style)

**Use Case**: Service integrations with multiple resources/operations
**Structure**: Resource-oriented organization

```
ServiceNode/
├── ServiceNode.node.ts             # Main node implementation
├── ServiceNode.node.json           # Node metadata
├── descriptions/                    # Resource/operation definitions
│   ├── index.ts                     # Export all descriptions
│   ├── TicketDescription.ts         # Ticket operations
│   ├── AgentDescription.ts          # Agent operations
│   ├── AssetDescription.ts          # Asset operations
│   └── ResourceDescription.ts       # Generic resource operations
├── interfaces/                      # API interfaces and types
│   ├── index.ts
│   ├── Ticket.ts
│   ├── Agent.ts
│   └── Asset.ts
├── api/                            # API client logic
│   ├── client.ts                   # HTTP client
│   ├── auth.ts                     # Authentication handling
│   └── endpoints.ts                # API endpoint definitions
└── test/
    └── ServiceNode.node.test.ts    # Tests
```

**Characteristics**:
- **Resource-driven**: Each resource type has its own description file
- **API abstraction**: Separate API client layer
- **Type safety**: Comprehensive TypeScript interfaces
- **Authentication**: Dedicated auth handling

## File Organization Best Practices

### Core Files (Required)

1. **Main Node File** (`[NodeName].node.ts`)
   - Primary node implementation
   - Entry point for n8n
   - Implements `INodeType` interface

2. **Node Metadata** (`[NodeName].node.ts` or `[NodeName].node.json`)
   - Node documentation
   - Category information
   - Default values
   - Examples

### Supporting Files (Recommended)

3. **Description File** (`Description.ts`)
   - UI property definitions
   - Input parameter configurations
   - Dynamic property logic

```typescript
import type { INodeProperties } from 'n8n-workflow';

export const mainProperties: INodeProperties[] = [
    {
        displayName: 'Parameter',
        name: 'parameter',
        type: 'string',
        default: '',
        required: true,
        description: 'Parameter description'
    }
    // ... more properties
];
```

4. **Interfaces File** (`interfaces.ts`)
   - TypeScript type definitions
   - API response types
   - Configuration interfaces

```typescript
export interface NodeConfiguration {
    apiKey: string;
    endpoint: string;
    timeout: number;
}

export interface ApiResponse {
    success: boolean;
    data: any;
    error?: string;
}
```

5. **Generic Functions** (`GenericFunctions.ts`)
   - Shared utility functions
   - Common operations
   - Reusable across node types

```typescript
export async function makeApiRequest(
    this: IExecuteFunctions,
    url: string,
    options: RequestOptions
): Promise<ApiResponse> {
    // Implementation
}

export function validateCredentials(credential: any): boolean {
    // Validation logic
}
```

### Utility Organization (For Complex Nodes)

6. **Utilities Directory** (`utils/`)
   - Feature-specific utilities
   - Modular organization
   - Clear separation of concerns

```
utils/
├── index.ts              # Export all utilities
├── apiClient.ts          # API communication utilities
├── dataProcessor.ts      # Data transformation utilities
├── validator.ts          # Input validation utilities
└── errorHandler.ts       # Error handling utilities
```

7. **Version Directories** (`V1/`, `V2/`, etc.)
   - Version-specific implementations
   - Migration helpers
   - Backward compatibility

## Naming Conventions

### Files
- **Node Files**: `[PascalCase]Node.node.ts`
- **Description Files**: `Description.ts` or `[PascalCase]Description.ts`
- **Utility Files**: `[camelCase].ts` or `[PascalCase]Utilities.ts`
- **Interface Files**: `interfaces.ts` or `[PascalCase]Interfaces.ts`
- **Test Files**: `[PascalCase]Node.test.ts`

### Directories
- **Root**: Node name in PascalCase
- **Utils**: lowercase with hyphens if needed
- **Versions**: `V1`, `V2`, etc. (uppercase V)
- **Tests**: `test/` (plural)

### Exports
- **Default Export**: Node class
- **Named Exports**: Utilities, types, constants
- **Re-exports**: `export * from './utils'` for clean imports

## Implementation Guidelines

### 1. Separation of Concerns

**Good**:
```typescript
// Main node file - orchestration only
async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const config = await this.getNodeParameters();
    const validatedConfig = validateConfig(config);
    const result = await processData(validatedConfig);
    return formatOutput(result);
}

// Utility files - specific logic
export function validateConfig(config: any): ValidatedConfig {
    // Validation logic
}

export async function processData(config: ValidatedConfig): Promise<ProcessedData> {
    // Processing logic
}
```

**Avoid**:
```typescript
// Mixed concerns in main file
async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const data = this.getInputData();
    // Validation mixed with processing
    if (!data[0].json.url) throw new Error('URL required');
    const url = data[0].json.url;
    // Processing mixed with error handling
    try {
        const response = await fetch(url);
        // Formatting mixed with business logic
        return [{
            json: {
                status: response.status,
                data: await response.json(),
                timestamp: new Date().toISOString()
            }
        }];
    } catch (error) {
        return [{
            json: { error: error.message }
        }];
    }
}
```

### 2. Error Handling

**Consistent Error Patterns**:
```typescript
// GenericFunctions.ts
export function formatApiError(error: any, context: string): string {
    const message = error?.response?.data?.message || error.message;
    return `${context} failed: ${message}`;
}

export function isNetworkError(error: any): boolean {
    return error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT';
}

// Main node file
try {
    const result = await operation();
    return formatSuccess(result);
} catch (error) {
    if (isNetworkError(error)) {
        throw new NodeOperationError(this.getNode(),
            'Network connection failed. Check your internet connection.');
    }

    throw new NodeOperationError(this.getNode(),
        formatApiError(error, 'API request'));
}
```

### 3. Testing Structure

**Comprehensive Test Organization**:
```
test/
├── [NodeName].node.test.ts        # Main functionality tests
├── utils/                          # Utility function tests
│   ├── validator.test.ts
│   ├── apiClient.test.ts
│   └── dataProcessor.test.ts
├── integration/                    # Integration tests
│   ├── fullWorkflow.test.ts
│   └── errorScenarios.test.ts
└── fixtures/                       # Test data
    ├── validInputs.json
    ├── invalidInputs.json
    └── mockResponses.json
```

### 4. Documentation

**Node Metadata Structure**:
```json
{
  "documentation": {
    "baseUrl": "https://docs.yourservice.com/n8n-node",
    "examples": [
      {
        "name": "Basic Usage",
        "description": "Simple example showing basic functionality",
        "workflow": { /* workflow JSON */ }
      }
    ]
  },
  "action": "Human-readable description of what the node does",
  "capabilities": ["api", "authentication", "file-processing"],
  "tags": ["category", "service-name", "function-type"]
}
```

## Migration Path

### From Simple to Advanced Pattern

When a simple node grows in complexity:

1. **Extract Properties**: Move inline properties to `Description.ts`
2. **Create Interfaces**: Define types in `interfaces.ts`
3. **Extract Utilities**: Move reusable functions to `GenericFunctions.ts`
4. **Add Tests**: Create comprehensive test suite
5. **Add Metadata**: Create `.node.json` with documentation

### Version Management

For breaking changes:

1. **Create Version Directory**: Copy current implementation to `V1/`
2. **Update Main File**: Make it a version manager
3. **Implement V2**: Create new version with changes
4. **Migration Logic**: Add upgrade functions in main file

```typescript
// Main node becomes version manager
export class AdvancedNode extends VersionedNodeType {
    description = {
        // Version management configuration
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const version = this.getNodeParameter('operationVersion', 0) as string;

        switch (version) {
            case '1':
                return await this.executeV1();
            case '2':
            default:
                return await this.executeV2();
        }
    }
}
```

## Testing Patterns and Best Practices

n8n follows comprehensive testing patterns to ensure node reliability and maintainability. Based on analysis of the official codebase, here's how to properly test n8n nodes.

### Testing Framework Stack

**Core Technologies**:
- **Jest**: Primary testing framework with TypeScript support
- **ts-jest**: TypeScript preprocessor for Jest
- **jest-mock-extended**: Advanced mocking capabilities
- **nock**: HTTP request mocking and interception
- **jest-expect-message**: Enhanced assertion messages

**Configuration**:
```json
// package.json
{
  "devDependencies": {
    "@types/jest": "^29.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "nock": "^13.0.0",
    "jest-mock-extended": "^3.0.0"
  },
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['jest-expect-message'],
  collectCoverageFrom: [
    'nodes/**/*.ts',
    'utils/**/*.ts',
    '!nodes/**/*.d.ts',
    '!**/test/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

### Test Organization Structure

**Complete Test Directory**:
```
NodeName/
├── NodeName.node.ts              # Main node implementation
├── test/                          # Test directory
│   ├── NodeName.node.test.ts     # Node execution tests
│   ├── GenericFunctions.test.ts   # Utility function tests
│   ├── utils/                     # Utility-specific tests
│   │   ├── commandParser.test.ts
│   │   ├── socketDetector.test.ts
│   │   └── logParser.test.ts
│   ├── integration/               # Integration tests
│   │   └── NodeName.workflow.test.ts
│   ├── fixtures/                  # Test data and mocks
│   │   ├── mockResponses.json
│   │   ├── testWorkflows.json
│   │   └── dockerFixtures.ts
│   └── NodeName.workflow.json     # Primary workflow test data
```

### Testing Patterns

#### 1. Node Execution Testing

**Direct Node Testing** (for unit tests):
```typescript
import type { IExecuteFunctions } from 'n8n-workflow';
import { mock } from 'jest-mock-extended';
import { NodeOperationError } from 'n8n-workflow';
import { RunContainer } from '../RunContainer.node';

describe('RunContainer > Node Execution', () => {
  let node: RunContainer;
  let executeFunctions: IExecuteFunctions;

  beforeEach(() => {
    node = new RunContainer();
    executeFunctions = mock<IExecuteFunctions>({
      getInputData: jest.fn(),
      getNodeParameter: jest.fn(),
      continueOnFail: jest.fn(),
      getNode: jest.fn()
    });

    // Default mock implementations
    executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
    executeFunctions.continueOnFail.mockReturnValue(false);
  });

  describe('basic execution', () => {
    it('should execute container with minimal parameters', async () => {
      // Arrange
      executeFunctions.getNodeParameter.mockImplementation((param) => {
        const params = {
          image: 'alpine:latest',
          command: 'echo "Hello World"',
          entrypoint: '',
          sendEnv: false,
          socketPath: '/var/run/docker.sock'
        };
        return params[param];
      });

      // Mock Docker execution
      jest.spyOn(require('../ContainerHelpers'), 'executeContainer')
        .mockResolvedValue({
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
          entrypoint: '',
          environmentVariablesCount: 0
        }
      });
    });

    it('should handle environment variables', async () => {
      // Arrange
      executeFunctions.getNodeParameter.mockImplementation((param) => {
        const params = {
          image: 'python:3.11',
          command: 'python -c "import os; print(os.getenv(\\"TEST_VAR\\", \\"default\\"))"',
          sendEnv: true,
          specifyEnv: 'keypair',
          parametersEnv: {
            values: [{ name: 'TEST_VAR', value: 'test_value' }]
          }
        };
        return params[param];
      });

      jest.spyOn(require('../GenericFunctions'), 'processEnvironmentVariables')
        .mockResolvedValue({
          variables: ['TEST_VAR=test_value'],
          count: 1,
          mode: 'keypair'
        });

      jest.spyOn(require('../ContainerHelpers'), 'executeContainer')
        .mockResolvedValue({
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
      expect(require('../GenericFunctions').processEnvironmentVariables).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle Docker connection errors', async () => {
      // Arrange
      executeFunctions.getNodeParameter.mockReturnValue('nonexistent:latest');

      jest.spyOn(require('../ContainerHelpers'), 'executeContainer')
        .mockRejectedValue(new Error('ECONNREFUSED: Docker daemon not running'));

      // Act & Assert
      await expect(node.execute.call(executeFunctions))
        .rejects.toThrow('Docker connection failed: Make sure Docker is running and accessible');
    });

    it('should continue on fail when configured', async () => {
      // Arrange
      executeFunctions.continueOnFail.mockReturnValue(true);
      executeFunctions.getNodeParameter.mockReturnValue('invalid@image');

      jest.spyOn(require('../ContainerHelpers'), 'executeContainer')
        .mockRejectedValue(new Error('Invalid image format'));

      // Act
      const result = await node.execute.call(executeFunctions);

      // Assert
      expect(result[0][0].json).toMatchObject({
        error: expect.stringContaining('Docker container execution failed'),
        success: false,
        exitCode: -1
      });
    });
  });
});
```

#### 2. Utility Function Testing

**GenericFunctions Testing**:
```typescript
import {
  processEnvironmentVariables,
  validateDockerImageName,
  convertObjectToEnvVars
} from '../GenericFunctions';
import { NodeOperationError } from 'n8n-workflow';

describe('RunContainer > GenericFunctions', () => {
  let mockExecuteFunctions: any;

  beforeEach(() => {
    mockExecuteFunctions = {
      getNodeParameter: jest.fn(),
      getNode: jest.fn()
    };
  });

  describe('processEnvironmentVariables', () => {
    it('should process key-pair environment variables', async () => {
      // Arrange
      mockExecuteFunctions.getNodeParameter.mockImplementation((param) => {
        const params = {
          sendEnv: true,
          specifyEnv: 'keypair',
          parametersEnv: {
            values: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'PORT', value: '3000' }
            ]
          }
        };
        return params[param];
      });

      // Act
      const result = await processEnvironmentVariables.call(mockExecuteFunctions, 0);

      // Assert
      expect(result.variables).toEqual(['NODE_ENV=production', 'PORT=3000']);
      expect(result.count).toBe(2);
      expect(result.mode).toBe('keypair');
    });

    it('should process JSON environment variables', async () => {
      // Arrange
      mockExecuteFunctions.getNodeParameter.mockImplementation((param) => {
        const params = {
          sendEnv: true,
          specifyEnv: 'json',
          jsonEnv: '{"NODE_ENV": "test", "DEBUG": "true"}'
        };
        return params[param];
      });

      // Act
      const result = await processEnvironmentVariables.call(mockExecuteFunctions, 0);

      // Assert
      expect(result.variables).toEqual(['NODE_ENV=test', 'DEBUG=true']);
      expect(result.count).toBe(2);
    });

    it('should return empty variables when sendEnv is false', async () => {
      // Arrange
      mockExecuteFunctions.getNodeParameter.mockReturnValue({
        sendEnv: false
      });

      // Act
      const result = await processEnvironmentVariables.call(mockExecuteFunctions, 0);

      // Assert
      expect(result.variables).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should handle invalid JSON gracefully', async () => {
      // Arrange
      mockExecuteFunctions.getNodeParameter.mockReturnValue({
        sendEnv: true,
        specifyEnv: 'json',
        jsonEnv: 'invalid json'
      });

      // Act & Assert
      await expect(processEnvironmentVariables.call(mockExecuteFunctions, 0))
        .rejects.toThrow(NodeOperationError);
    });
  });

  describe('validateDockerImageName', () => {
    it('should validate correct image names', () => {
      const validImages = [
        'alpine:latest',
        'python:3.11',
        'nginx',
        'docker.io/library/alpine:latest',
        'my-registry.com/my-app:v1.2.3'
      ];

      validImages.forEach(image => {
        const result = validateDockerImageName(image);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });

    it('should reject invalid image names', () => {
      const invalidImages = [
        '',
        'Invalid Image!',
        'image with spaces',
        'UPPERCASE:latest'
      ];

      invalidImages.forEach(image => {
        const result = validateDockerImageName(image);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('convertObjectToEnvVars', () => {
    it('should convert object to environment variables', () => {
      const obj = {
        NODE_ENV: 'production',
        PORT: 3000,
        DEBUG: true,
        EMPTY_STRING: ''
      };

      const result = convertObjectToEnvVars(obj);

      expect(result).toEqual([
        'NODE_ENV=production',
        'PORT=3000',
        'DEBUG=true',
        'EMPTY_STRING='
      ]);
    });

    it('should handle null and undefined values', () => {
      const obj = {
        VALID: 'value',
        NULL_VALUE: null,
        UNDEFINED_VALUE: undefined
      };

      const result = convertObjectToEnvVars(obj);

      expect(result).toEqual(['VALID=value']);
    });
  });
});
```

#### 3. Utility Module Testing

**Command Parser Testing**:
```typescript
import { parseCommand, validateCommandArgs, buildCommandString } from '../utils/commandParser';

describe('RunContainer > utils > commandParser', () => {
  describe('parseCommand', () => {
    it('should parse simple commands', () => {
      expect(parseCommand('echo hello')).toEqual(['echo', 'hello']);
      expect(parseCommand('ls -la')).toEqual(['ls', '-la']);
      expect(parseCommand('python script.py --verbose')).toEqual(['python', 'script.py', '--verbose']);
    });

    it('should handle quoted arguments', () => {
      expect(parseCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
      expect(parseCommand('git commit -m "fix: resolve bug"')).toEqual(['git', 'commit', '-m', 'fix: resolve bug']);
      expect(parseCommand('echo "path with spaces/file.txt"')).toEqual(['echo', 'path with spaces/file.txt']);
    });

    it('should handle escaped quotes', () => {
      expect(parseCommand('echo "hello \\"world\\""')).toEqual(['echo', 'hello "world"']);
      expect(parseCommand('echo "C:\\\\Program Files"')).toEqual(['echo', 'C:\\Program Files']);
    });

    it('should handle empty commands', () => {
      expect(parseCommand('')).toEqual([]);
      expect(parseCommand('   ')).toEqual([]);
    });

    it('should handle complex arguments with mixed quotes', () => {
      const cmd = 'python -c "import json; print(json.dumps({\\"key\\": \\"value\\"}))"';
      expect(parseCommand(cmd)).toEqual([
        'python',
        '-c',
        'import json; print(json.dumps({"key": "value"}))'
      ]);
    });
  });

  describe('validateCommandArgs', () => {
    it('should validate valid arguments', () => {
      const validArgs = ['echo', 'hello', 'world'];
      expect(validateCommandArgs(validArgs)).toEqual(validArgs);
    });

    it('should filter out invalid arguments', () => {
      const mixedArgs = ['echo', '', 'world', null as any, undefined as any, 'test'];
      expect(validateCommandArgs(mixedArgs)).toEqual(['echo', 'world', 'test']);
    });
  });

  describe('buildCommandString', () => {
    it('should build command string from array', () => {
      expect(buildCommandString(['echo', 'hello', 'world'])).toBe('echo hello world');
      expect(buildCommandString(['ls', '-la', '/home'])).toBe('ls -la /home');
    });

    it('should quote arguments with spaces', () => {
      expect(buildCommandString(['echo', 'hello world'])).toBe('"hello world"');
      expect(buildCommandString(['git', 'commit', '-m', 'fix bug'])).toBe('git commit -m "fix bug"');
    });

    it('should escape quotes in arguments', () => {
      expect(buildCommandString(['echo', 'hello "world"'])).toBe('"hello \\"world\\""');
    });
  });
});
```

#### 4. Integration Testing

**Workflow Testing with Test Harness** (if available):
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

describe('RunContainer > Integration > Workflows', () => {
  const testWorkflow = JSON.parse(
    readFileSync(join(__dirname, 'RunContainer.workflow.json'), 'utf8')
  );

  describe('basic container execution workflow', () => {
    it('should execute workflow successfully', async () => {
      // Mock Docker API calls
      const mockDocker = nock('http://localhost:2375');
      mockDocker.post('/v1.41/containers/create')
        .reply(200, { Id: 'container123' });
      mockDocker.post('/v1.41/containers/container123/start')
        .reply(204);
      mockDocker.post('/v1.41/containers/container123/wait')
        .reply(200, { StatusCode: 0 });
      mockDocker.get('/v1.41/containers/container123/logs')
        .query({ stdout: 1, stderr: 1, timestamps: 0 })
        .reply(200, 'Hello World\n');

      // Execute workflow using NodeTestHarness or custom implementation
      const result = await executeWorkflow(testWorkflow);

      expect(result).toMatchObject({
        success: true,
        output: [{
          json: {
            stdout: 'Hello World\n',
            stderr: '',
            exitCode: 0
          }
        }]
      });
    });
  });
});
```

### Mock Patterns for External Dependencies

#### Docker API Mocking
```typescript
import nock from 'nock';

describe('Docker API Integration', () => {
  beforeEach(() => {
    // Disable real network requests
    nock.disableNetConnect();
  });

  afterEach(() => {
    // Clean up nock mocks
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('should mock Docker container lifecycle', async () => {
    const mockDocker = nock('http://localhost:2375');

    // Mock container creation
    mockDocker.post('/v1.41/containers/create')
      .matchHeader('Content-Type', 'application/json')
      .reply(200, {
        Id: 'test-container-123',
        Warnings: []
      });

    // Mock container start
    mockDocker.post('/v1.41/containers/test-container-123/start')
      .reply(204);

    // Mock container logs
    mockDocker.get('/v1.41/containers/test-container-123/logs')
      .query({ stdout: 1, stderr: 1, timestamps: 0 })
      .reply(200, 'Test container output\n');

    // Mock container wait
    mockDocker.post('/v1.41/containers/test-container-123/wait')
      .reply(200, { StatusCode: 0 });

    // Mock container removal
    mockDocker.delete('/v1.41/containers/test-container-123')
      .query({ v: 'true', force: 'true' })
      .reply(204);

    // Test the actual implementation
    const result = await executeContainer({
      image: 'alpine:latest',
      command: 'echo "Hello World"',
      autoRemove: true
    });

    expect(result.stdout).toBe('Hello World\n');
    expect(result.exitCode).toBe(0);
  });
});
```

#### File System Mocking
```typescript
jest.mock('fs');
const mockFs = require('fs');

describe('File System Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle Docker socket detection', async () => {
    mockFs.existsSync.mockImplementation((path) => {
      return path === '/var/run/docker.sock';
    });

    const result = detectDockerSocket('/var/run/docker.sock');
    expect(result.exists).toBe(true);
    expect(result.accessible).toBe(true);
  });
});
```

### Test Fixtures and Data

**Fixture Organization**:
```typescript
// fixtures/dockerFixtures.ts
export const mockContainerResponses = {
  createSuccess: {
    Id: 'test-container-123',
    Warnings: []
  },
  startSuccess: null, // 204 No Content
  waitSuccess: {
    StatusCode: 0
  },
  logsSuccess: 'Container output logs\n',
  containerInfo: {
    Id: 'test-container-123',
    Image: 'alpine:latest',
    State: {
      Status: 'running',
      Running: true,
      ExitCode: 0
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
  }
};
```

### Best Practices Summary

1. **Test Organization**: Group tests by functionality with clear `describe()` blocks
2. **Mock Strategy**: Mock all external dependencies (Docker API, file system, network)
3. **Test Coverage**: Test happy paths, error scenarios, and edge cases
4. **Data Isolation**: Use `beforeEach()`/`afterEach()` for test isolation
5. **Descriptive Naming**: Test names should clearly describe expected behavior
6. **Assertion Quality**: Use specific assertions with meaningful messages
7. **Fixture Management**: Organize test data in fixtures for maintainability

This comprehensive testing approach ensures your n8n nodes meet the same quality standards as the official n8n codebase.

## Conclusion

Following these n8n node structure and testing patterns ensures:

- **Maintainability**: Clear organization and separation of concerns
- **Testability**: Modular structure enables comprehensive testing
- **Reliability**: Comprehensive test coverage catches bugs early
- **Reusability**: Shared utilities can be used across nodes
- **Scalability**: Easy to extend and version as requirements grow
- **Consistency**: Predictable structure for developers and users
- **Quality**: Adherence to n8n's established patterns and standards

Start with the Simple Pattern and graduate to Advanced Pattern as complexity increases. The key is maintaining clear separation of concerns, comprehensive testing, and adherence to n8n conventions at every level of complexity.