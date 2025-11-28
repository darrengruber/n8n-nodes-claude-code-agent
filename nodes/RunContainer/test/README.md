# RunContainer Test Suite

This directory contains comprehensive tests for the RunContainer n8n node, following n8n's established testing patterns.

## Test Structure

```
test/
├── RunContainer.node.test.ts     # Main node execution tests
├── GenericFunctions.test.ts     # Shared utility function tests
├── utils/                        # Utility module tests
│   ├── commandParser.test.ts   # Command parsing logic tests
│   ├── socketDetector.test.ts  # Docker socket detection tests
│   └── logParser.test.ts       # Docker log parsing tests
├── fixtures/                     # Test data and mocks
│   └── dockerFixtures.ts       # Docker-related test fixtures
├── RunContainer.workflow.json   # Workflow test data
└── README.md                    # This file
```

## Running Tests

### All Tests
```bash
npm test
```

### Specific Test Suites
```bash
# Run only RunContainer tests
npm run test:RunContainer

# Run only utility tests
npm run test:utils

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Individual Test Files
```bash
# Run specific test file
npx jest test/RunContainer.node.test.ts

# Run tests with verbose output
npx jest test --verbose
```

## Test Coverage

The test suite aims for comprehensive coverage:

- **Node Execution**: 100% coverage of main node functionality
- **Utility Functions**: 100% coverage of all helper functions
- **Error Handling**: Coverage of all error scenarios
- **Edge Cases**: Coverage of edge cases and boundary conditions

Current coverage thresholds:
- **Branches**: 80%
- **Functions**: 80%
- **Lines**: 80%
- **Statements**: 80%

## Test Categories

### 1. Node Execution Tests (`RunContainer.node.test.ts`)

Tests the main `RunContainer` node functionality:

- **Basic Execution**: Container execution with minimal parameters
- **Parameter Handling**: Socket paths, image names, commands, entrypoints
- **Environment Variables**: Key-pair, JSON, and model input modes
- **Error Handling**: Invalid images, Docker connection failures, continue on fail
- **Multiple Items**: Processing multiple input items
- **Integration**: Interaction with external dependencies

### 2. Generic Functions Tests (`GenericFunctions.test.ts`)

Tests shared utility functions:

- **Environment Variable Processing**: All three modes (key-pair, JSON, model)
- **Image Name Validation**: Docker image name format validation
- **Data Conversion**: Object to environment variables conversion
- **Error Scenarios**: Invalid JSON, malformed inputs

### 3. Utility Module Tests (`utils/`)

#### Command Parser (`commandParser.test.ts`)
- **Command Parsing**: Simple and complex command string parsing
- **Quote Handling**: Single quotes, double quotes, escaped characters
- **Validation**: Command argument validation and sanitization
- **String Building**: Command string reconstruction from arrays

#### Socket Detector (`socketDetector.test.ts`)
- **Socket Detection**: Docker socket detection across platforms
- **Platform Support**: Linux, macOS, Windows socket paths
- **Error Handling**: Permission issues, inaccessible sockets
- **Environment Info**: Socket environment information collection

#### Log Parser (`logParser.test.ts`)
- **Log Parsing**: Docker multiplexed log format parsing
- **Stream Separation**: Stdout/stderr separation
- **Error Parsing**: Container error message parsing
- **Data Sanitization**: Log output sanitization

### 4. Test Fixtures (`fixtures/dockerFixtures.ts`)

Provides test data and mock responses:

- **Container Responses**: Mock Docker API responses
- **Error Scenarios**: Common Docker error responses
- **Log Data**: Various log data samples
- **Environment Variables**: Test environment variable data
- **Workflow Data**: n8n workflow test configurations

## Mocking Strategy

### External Dependencies

All external dependencies are mocked to ensure test isolation and reliability:

```typescript
// Mock ContainerHelpers
jest.mock('../ContainerHelpers');
const mockContainerHelpers = require('../ContainerHelpers');

// Mock GenericFunctions
jest.mock('../GenericFunctions');
const mockGenericFunctions = require('../GenericFunctions');

// Mock Socket Detector
jest.mock('../utils/socketDetector');
const mockSocketDetector = require('../utils/socketDetector');
```

### File System Mocking

When testing file system operations:

```typescript
jest.mock('fs');
jest.mock('os');
const mockFs = require('fs');
const mockOs = require('os');
```

## Test Data Organization

### Fixtures Pattern

Test data is organized in fixtures for maintainability:

```typescript
export const mockContainerResponses = {
    createSuccess: {
        Id: 'test-container-123',
        Warnings: []
    },
    // ... more test data
};
```

### Helper Functions

Reusable test helper functions:

```typescript
function createMockContainer(overrides = {}) {
    return {
        Id: 'test-container-123',
        Image: 'alpine:latest',
        ...overrides
    };
}
```

## Best Practices

### Test Naming
- Use descriptive test names that explain expected behavior
- Follow `it('should do X when Y')` pattern
- Group related tests in nested `describe` blocks

### Test Isolation
- Use `beforeEach()` to reset mocks between tests
- Ensure tests don't depend on each other
- Use test-specific mock data

### Assertion Quality
- Use specific assertions with meaningful matchers
- Test both positive and negative scenarios
- Include edge cases and boundary conditions

### Mock Management
- Mock all external dependencies
- Reset mocks in `beforeEach()`
- Use consistent mock data across related tests

## CI/CD Integration

### Running Tests in CI

The test suite is designed to run in CI/CD environments:

```bash
# Install dependencies
npm ci

# Run tests with coverage
npm run test:coverage

# Generate coverage reports
npm run test:coverage
```

### Coverage Requirements

- All tests must pass before merging
- Coverage thresholds must be met
- No test dependencies on external services

## Debugging Tests

### Running Individual Tests

```bash
# Run specific test file with verbose output
npx jest test/GenericFunctions.test.ts --verbose

# Run tests with debugger
npx jest test --runInBand
```

### Test Output Analysis

Use Jest's built-in reporters to analyze test results:

```bash
# Generate detailed test report
npm test --coverage --coverageReporters=text-lcov

# Run tests with coverage thresholds
npm run test:coverage
```

## Contributing

When adding new tests:

1. **Follow Patterns**: Use existing test patterns and structure
2. **Add Fixtures**: Add new test data to fixtures
3. **Update Coverage**: Ensure new functionality is covered
4. **Test Errors**: Include error scenarios for robustness
5. **Documentation**: Update this README with new test information

## Future Enhancements

Potential improvements to the test suite:

- **Integration Tests**: Add full workflow integration tests
- **Performance Tests**: Add performance benchmarks
- **Contract Tests**: Add contract tests for external APIs
- **Property-Based Testing**: Use property-based testing for complex functions
- **Visual Testing**: Add visual regression tests for UI components