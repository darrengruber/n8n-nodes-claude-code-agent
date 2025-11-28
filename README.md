# Claude Agent for n8n

![n8n-nodes-claude-agent](https://img.shields.io/npm/v/n8n-nodes-claude-agent?color=orange&label=npm%20version)
![License](https://img.shields.io/npm/l/n8n-nodes-claude-agent?color=blue)
![Downloads](https://img.shields.io/npm/dt/n8n-nodes-claude-agent?color=green)

> [!IMPORTANT]
> **Disclaimer**: Claude, Claude Agent, and the Claude logo are trademarks of Anthropic, PBC. This project is an unofficial community integration and is not affiliated with, endorsed by, or sponsored by Anthropic or n8n.
>
> **Docker Disclaimer**: Docker is a trademark of Docker, Inc. This project uses Docker for container execution capabilities but is not affiliated with, endorsed by, or sponsored by Docker, Inc.

A powerful n8n community node package that brings **Claude Agent SDK** capabilities to your workflows, along with **Docker container execution** for running isolated code and commands. Build intelligent, tool-using AI agents that can execute code, run containers, and interact with your entire n8n workflow ecosystem.

> **🎉 Recent Improvements**: The codebase has been completely refactored to follow n8n's best practices with improved modularity, comprehensive test coverage, and better maintainability. See the Architecture section for details on the new structure.

## 🎯 What's Included

This package provides **four powerful custom nodes**:

### 1. **Claude Agent** Node (v3)
The main agent node that runs Claude AI agents with full tool support, memory, and output parsing capabilities. Features conditional UI that adapts based on whether used as a standalone node or as a tool.

### 2. **Claude Agent Tool** Node (v1)
Legacy version maintained for backward compatibility. For new workflows, prefer using the Claude Agent v3 node in tool mode.

### 3. **Run Container** Node
Execute Docker containers with automatic image pulling, environment variable support, and clean output capture.

### 4. **Run Container Tool** Node
Run Docker containers as reusable tools that can be connected to AI nodes in your workflows.

## ✨ Key Features

### 🤖 Claude Agent Capabilities

- **Official SDK Integration**: Built on top of the robust `@anthropic-ai/claude-agent-sdk` for reliable, production-ready agent execution
- **Dynamic Model Loading**: Automatically fetches available models from your Anthropic API endpoint
- **Multi-Model Support**: Works with Claude Sonnet, Haiku, and other compatible models
- **Custom Endpoints**: Support for custom API endpoints (e.g., proxy servers, compatible APIs)

### 🛠️ Comprehensive Tool Support

- **n8n Native Tools**: Seamlessly connect any n8n AI Tool node (Calculator, HTTP Request, Code, etc.)
- **Model Context Protocol (MCP)**: Connect to local MCP servers for extended capabilities
- **Tool Grouping**: Automatically groups tools by source for better organization
- **Tool Metadata**: Rich metadata extraction for better tool understanding

### 🧠 Memory & Context Management

- **AI Memory Integration**: Connect n8n AI Memory nodes to maintain conversational context across turns
- **Session Management**: Built-in session handling for multi-turn conversations
- **Context Awareness**: Agents maintain awareness of previous interactions

### 📊 Output Parsing & Structure

- **Structured Output**: Connect n8n Output Parser nodes to enforce specific JSON schemas
- **Automatic Parsing**: Output is automatically validated and parsed according to your schema
- **Type Safety**: Ensures consistent output formats for downstream processing

### 🐳 Docker Container Execution

- **Robust Docker API**: Uses the industry-standard `dockerode` library for reliable container operations
- **Automatic Image Pulling**: Automatically pulls Docker images if they don't exist locally
- **Flexible Execution**: Support for custom entrypoints and commands
- **Environment Variables**: Pass environment variables via JSON, key-value pairs, or model input
- **Clean Output Capture**: Separates stdout, stderr, and exit codes for easy processing
- **Auto-Cleanup**: Containers are automatically removed after execution
- **Cross-Platform**: Works on macOS (including Colima), Linux, and Windows

### 📝 Advanced Logging & Debugging

- **File-Based Logging**: Detailed execution logs written to the filesystem
- **Markdown Format**: Logs are available in both raw and markdown formats for easy reading
- **Real-Time Monitoring**: Watch logs in real-time during execution
- **Verbose Mode**: Optional verbose logging for deep debugging
- **Structured Logs**: JSON-structured logs with timestamps and context

### 🔄 Workflow Integration

- **Chat Trigger Support**: Automatically detects and uses input from Chat Trigger nodes
- **Guardrails Integration**: Works seamlessly with n8n Guardrails nodes
- **Expression Support**: Use n8n expressions for dynamic prompt generation
- **Tool Mode**: Use agents as tools in other AI workflows

## 🚀 Installation

> [!IMPORTANT]
> **Installation Method**: This package is **not eligible** for the standard Community Nodes installation method (Settings > Community Nodes). It must be installed as a **custom extension** using npm in your n8n installation directory.

### Self-Hosted Installation (Required)

Since this package requires custom extension installation, you must be running a **self-hosted n8n instance** (not n8n.cloud). Choose one of the following methods:

#### Method 1: npm Installation (Node.js)

1. Navigate to your n8n installation directory (where n8n is installed globally or locally)
2. Install the package:
   ```bash
   npm install n8n-nodes-claude-agent
   ```
3. Restart your n8n instance

**For global n8n installations:**
```bash
# If n8n is installed globally
cd $(npm root -g)/n8n
npm install n8n-nodes-claude-agent
```

**For local n8n installations:**
```bash
# Navigate to your n8n project directory
cd /path/to/your/n8n/project
npm install n8n-nodes-claude-agent
```

#### Method 2: Docker Installation

If you're running n8n in Docker, you have two options:

**Option A: Install in the container (temporary)**
```bash
docker exec -it <n8n-container-name> npm install n8n-nodes-claude-agent
docker restart <n8n-container-name>
```

**Option B: Create a custom Docker image (recommended for production)**

Create a `Dockerfile`:
```dockerfile
FROM n8nio/n8n:latest

# Install the custom extension
RUN npm install -g n8n-nodes-claude-agent
```

Build and run:
```bash
docker build -t n8n-custom .
docker run -d --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  n8n-custom
```

**Option C: Use N8N_CUSTOM_EXTENSIONS environment variable**

Set the environment variable to install extensions automatically:
```bash
docker run -d --name n8n \
  -p 5678:5678 \
  -e N8N_CUSTOM_EXTENSIONS=n8n-nodes-claude-agent \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n:latest
```

#### Method 3: Docker Compose

Add to your `docker-compose.yml`:
```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    environment:
      - N8N_CUSTOM_EXTENSIONS=n8n-nodes-claude-agent
    volumes:
      - ~/.n8n:/home/node/.n8n
    ports:
      - "5678:5678"
```

### Verification

After installation and restart, you should see the following nodes available in the n8n node palette:
- **Claude Agent** (v3) - Main node with dual-mode support
- **Claude Agent Tool** (v1) - Legacy compatibility node
- **Run Container** - Container execution node
- **Run Container Tool** - Container tool node

If the nodes don't appear, check:
1. The package is installed in the correct directory
2. n8n has been restarted
3. Check n8n logs for any installation errors

## ⚙️ Configuration

### Anthropic API Credentials

1. Create a new credential in n8n
2. Search for **Anthropic API**
3. Enter your API Key
4. (Optional) Set a custom Base URL if using a compatible endpoint

### Docker Setup

The **Run Container** node requires Docker to be installed and running:

- **macOS**: Install Docker Desktop or Colima
- **Linux**: Install Docker Engine
- **Windows**: Install Docker Desktop

The node automatically detects Docker socket paths:
- Linux: `/var/run/docker.sock` (default)
- macOS with Colima: `~/.colima/default/docker.sock` (auto-detected)

## 📖 Usage Examples

### Basic Claude Agent

1. Add the **Claude Agent** node to your canvas
2. Connect an **Anthropic Chat Model** node
3. Enter your prompt in the **Text** field
4. Execute the workflow

### Agent with Tools

1. Add **Claude Agent** node
2. Connect your **Anthropic Chat Model**
3. Add tool nodes (e.g., HTTP Request, Calculator, Code)
4. Connect tools to the **Tools** input of Claude Agent
5. The agent will automatically discover and use available tools

### Running Docker Containers

1. Add the **Run Container** node
2. Specify the Docker image (e.g., `python:3.11`, `node:18-alpine`)
3. Set entrypoint (e.g., `python`, `/bin/sh`)
4. Provide command arguments
5. (Optional) Add environment variables
6. The container runs, captures output, and cleans up automatically

**Example**: Run Python code in a container:
- Image: `python:3.11-alpine`
- Entrypoint: `python`
- Command: `-c "print('Hello from Docker!')"`

### Agent Using Docker Containers

1. Connect **Run Container** as a tool to **Claude Agent**
2. The agent can now execute code in isolated Docker environments
3. Perfect for running untrusted code or testing in clean environments

### Multi-Turn Conversations

1. Connect an **AI Memory** node to the **Memory** input
2. The agent maintains context across multiple turns
3. Perfect for conversational workflows

### Structured Output

1. Add a **Structured Output Parser** node
2. Define your JSON schema
3. Connect it to the **Output Parser** input
4. The agent will format output according to your schema

## 🔍 Debugging

### Log Files

Detailed logs are automatically written to help you debug agent behavior:

- **Default Location**: `~/claude-agent-logs/`
- **Custom Location**: Set `CLAUDE_AGENT_LOG_DIR` environment variable

### Viewing Logs

**Real-time monitoring:**
```bash
ls -t ~/claude-agent-logs/debug-*.log | head -1 | xargs tail -f
```

**Latest log file:**
```bash
ls -t ~/claude-agent-logs/debug-*.log | head -1
```

**Markdown formatted logs:**
```bash
ls -t ~/claude-agent-logs/debug-*.md | head -1 | xargs cat
```

### Verbose Mode

Enable **Verbose** in the node options for detailed execution logs in the n8n console.

See [LOGGING.md](./LOGGING.md) for comprehensive logging documentation.

## 🐛 Troubleshooting

Common issues and solutions are documented in [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

### Quick Fixes

**Node Type Error**: If you see `Unrecognized node type: CUSTOM.claudeAgent`, delete the copied node and add a fresh one from the palette. See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for details.

**Docker Connection Issues**: Ensure Docker is running and the socket path is correct. On macOS with Colima, the node auto-detects the socket path.

**Tool Connection Issues**: Verify tool nodes are properly connected and have valid configurations.

## 🏗️ Architecture

### Modern Node Structure (Following n8n Best Practices)

The codebase follows n8n's **Advanced Node Pattern** with modular organization:

#### Claude Agent Nodes
- **ClaudeAgent.node.ts** (v3) - Main node with version management and dual-mode support
- **V1/ClaudeAgentTool.node.ts** - Legacy version for backward compatibility
- **ClaudeAgentExecute.ts** - Shared execution logic for both node variants
- **Description.ts** - Unified UI properties with conditional display options
- **interfaces.ts** - Comprehensive TypeScript type definitions
- **GenericFunctions.ts** - Shared validation and utility functions
- **utils/** - Modular utilities organized by functionality:
  - `debugLogger.ts` - Comprehensive logging with file output
  - `memoryProcessor.ts` - AI Memory integration and context management
  - `mcpAdapter.ts` - Model Context Protocol server integration
  - `toolProcessor.ts` - n8n AI Tool processing and metadata extraction
  - `promptBuilder.ts` - Prompt construction with memory context
  - `outputFormatter.ts` - Result formatting and structured output

#### RunContainer Nodes
- **RunContainer.node.ts** - Main container execution node
- **RunContainerTool.node.ts** - Container execution as a reusable tool
- **ContainerHelpers.ts** - Core Docker operations and lifecycle management
- **utils/** - Modular utilities:
  - `socketDetector.ts` - Cross-platform Docker socket detection
  - `commandParser.ts` - Shell command parsing and validation
  - `logParser.ts` - Container output processing and formatting

### Key Dependencies

- **`@anthropic-ai/claude-agent-sdk`** - Official Claude Agent SDK for reliable agent execution
- **`dockerode`** - Industry-standard Docker API client for container operations
- **`zod`** - Runtime type validation and schema enforcement
- **`@n8n/node-cli`** - n8n-specific build and development tooling

### Testing Architecture

Comprehensive test suite following n8n patterns:
- **Unit Tests** - Individual utility function testing with proper mocking
- **Integration Tests** - End-to-end node execution with mock external services
- **Fixtures** - Reusable test data and mock responses
- **Coverage** - High test coverage ensuring reliability and maintainability

## 🤝 Contributing

Contributions are welcome! This codebase follows established n8n patterns and maintains comprehensive test coverage.

### Development Setup
```bash
# Clone and install dependencies
git clone https://github.com/darrengruber/n8n-nodes-claude-agent.git
cd n8n-nodes-claude-agent
npm install

# Run tests and linting
npm test
npm run lint

# Build for development
npm run build:watch
```

### Code Standards
- Follow the **Advanced Node Pattern** outlined in `NODE_STRUCTURE_PATTERNS.md`
- Maintain comprehensive test coverage for all new functionality
- Use TypeScript interfaces defined in `interfaces.ts`
- Organize utilities in the `utils/` directory with proper exports via `index.ts`
- Include proper error handling with `NodeOperationError` and context preservation

### Testing Requirements
- Unit tests for all utility functions with proper mocking
- Integration tests for node execution flows
- Update fixtures when adding new test scenarios
- Ensure all tests pass before submitting PRs

See the [GitHub repository](https://github.com/darrengruber/n8n-nodes-claude-agent) for:
- Issue reporting and feature requests
- Pull request guidelines and code review process
- Documentation improvements and examples

## 📄 License

[MIT](LICENSE.md)

## 🙏 Acknowledgments

- Built with the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) by Anthropic
- Uses [dockerode](https://github.com/apocas/dockerode) for Docker integration
- Part of the n8n community ecosystem

---

**Made with ❤️ for the n8n community**
