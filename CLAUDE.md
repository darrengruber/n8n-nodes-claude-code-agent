# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Development
- `npm run build` - Build the project (compiles TypeScript to dist/)
- `npm run build:watch` - Watch mode for TypeScript compilation
- `npm run dev` - Development mode with hot reloading
- `npm run lint` - Run ESLint for code quality checks
- `npm run lint:fix` - Automatically fix linting issues

### Testing
- `npm test` - Run all tests
- `npm run test:watch` - Watch mode for continuous testing
- `npm run test:coverage` - Generate test coverage report
- `npm run test:RunContainer` - Run only RunContainer node tests
- `npm run test:utils` - Run only utility function tests
- `npm test -- --testPathPattern="filename"` - Run specific test file
- `npm test -- --testNamePattern="test name"` - Run tests matching specific name

### Release
- `npm run release` - Create a new release version

## Architecture Overview

This is an n8n custom node package containing two main node families that follow the **Advanced Node Pattern** from `NODE_STRUCTURE_PATTERNS.md`.

### Node Structure
The project follows n8n's established patterns with modular organization:

```
nodes/
├── ClaudeAgent/           # Claude AI agent nodes
│   ├── ClaudeAgent.node.ts          # Main node (v3) with version management
│   ├── ClaudeAgentExecute.ts        # Shared execution logic
│   ├── Description.ts               # UI properties with conditional display
│   ├── GenericFunctions.ts          # Shared utilities and validation
│   ├── interfaces.ts                # TypeScript type definitions
│   ├── V1/ClaudeAgentTool.node.ts   # Legacy version for backward compatibility
│   ├── utils/                       # Modular utilities
│   └── test/                        # Comprehensive test suite
└── RunContainer/          # Docker container execution nodes
    ├── RunContainer.node.ts         # Main container execution node
    ├── RunContainerTool.node.ts     # Tool version for AI workflows
    ├── ContainerHelpers.ts          # Core Docker operations
    ├── GenericFunctions.ts          # Container-specific utilities
    ├── Description.ts               # UI properties
    ├── interfaces.ts                # Type definitions
    ├── utils/                       # Utility modules
    └── test/                        # Test suite
```

### Claude Agent Architecture

**Core Execution Flow:**
1. **ClaudeAgentExecute.ts** - Shared execution function that handles both main node and tool variants
2. **Tool Processing** - `utils/toolProcessor.ts` processes n8n AI Tools and MCP servers
3. **Memory Management** - `utils/memoryProcessor.ts` handles AI Memory integration
4. **Prompt Building** - `utils/promptBuilder.ts` constructs prompts with memory context
5. **SDK Integration** - Uses `@anthropic-ai/claude-agent-sdk` for actual agent execution
6. **Output Processing** - `utils/outputFormatter.ts` handles structured output and memory saving

**Key Components:**
- **Version Management**: Main node supports both standalone and tool modes via versioning
- **MCP Integration**: Model Context Protocol servers are adapted via `utils/mcpAdapter.ts`
- **Debug Logging**: Comprehensive logging system in `utils/debugLogger.ts` with file output
- **Error Handling**: Centralized error processing with context preservation

### RunContainer Architecture

**Docker Integration Pattern:**
1. **ContainerHelpers.ts** - High-level Docker operations using dockerode
2. **Socket Detection** - `utils/socketDetector.ts` auto-detects Docker socket paths across platforms
3. **Command Processing** - `utils/commandParser.ts` parses and validates shell commands
4. **Log Parsing** - `utils/logParser.ts` processes container stdout/stderr streams
5. **Environment Variables** - Multiple input methods (key-value, JSON, model input)

**Key Features:**
- **Cross-Platform Support**: Automatic Docker socket detection for macOS/Colima, Linux, Windows
- **Container Lifecycle**: Complete container management with auto-cleanup
- **Security**: Command validation and sanitization before execution
- **Error Handling**: Detailed error reporting with Docker-specific context

### Testing Strategy

**Test Organization Following n8n Patterns:**
- **Unit Tests**: Individual utility functions with comprehensive mocking
- **Integration Tests**: End-to-end node execution with mock external services
- **Fixtures**: Reusable test data in `test/fixtures/` directories
- **Workflow Tests**: Complete n8n workflow definitions for testing

**Key Testing Patterns:**
- Mock all external dependencies (Docker API, Claude SDK, file system)
- Test both success and failure scenarios
- Use descriptive test names that explain expected behavior
- Follow arrange-act-assert pattern consistently

### Development Patterns

**When Adding New Features:**
1. Follow the established directory structure for the appropriate node family
2. Add TypeScript interfaces to `interfaces.ts` for new data structures
3. Include comprehensive tests in the appropriate `test/` directory
4. Update `Description.ts` for new UI properties
5. Add utility functions to `utils/` if reusable across the node family

**Error Handling:**
- Use `NodeOperationError` for n8n-specific error context
- Preserve original error context in enhanced error objects
- Include detailed logging via `DebugLogger` for debugging
- Support `continueOnFail` mode where appropriate

**Memory and Tool Integration:**
- Always handle missing connections gracefully
- Process tools in a standardized way with metadata extraction
- Support both direct tool connections and MCP server integration
- Maintain backward compatibility for existing workflows

## Dependencies

**Core Dependencies:**
- `@anthropic-ai/claude-agent-sdk` - Official Claude Agent SDK for agent execution
- `dockerode` - Docker API client for container operations
- `zod` - Schema validation for structured outputs

**Development Dependencies:**
- `@n8n/node-cli` - n8n-specific build and development tools
- `jest` with `ts-jest` - TypeScript-aware testing framework
- ESLint and Prettier - Code quality and formatting

## Important Notes

- This package must be installed as a custom extension, not via n8n's community nodes
- All external API calls should be properly mocked in tests
- Docker functionality requires Docker daemon to be running
- Claude Agent requires valid Anthropic API credentials in n8n