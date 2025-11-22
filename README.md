# Claude Code Agent - n8n Node

This n8n node integrates the Claude Code Agent SDK (`@anthropic-ai/claude-agent-sdk`), enabling powerful agentic AI workflows with tool support and memory.

## Features

- **Claude Code SDK Integration**: Uses the official Anthropic Claude Code SDK
- **Dynamic Model Loading**: Fetches available models from your Anthropic API endpoint
- **Memory Support**: Optional AI Memory input for conversational context
- **Tool Support**: Connect n8n AI Tools via dedicated MCP adapter
- **Verbose Logging**: Optional file-based debug logging to `claude-agent-debug/` directory
- **Custom Endpoints**: Supports custom Anthropic API base URLs

## Installation

```bash
npm install n8n-nodes-claude-code-agent
```

## Configuration
Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Credentials

This node requires **Anthropic API** credentials. You can:
1. Create credentials in n8n's credential manager
2. Enter your Anthropic API key
3. Optionally set a custom base URL for Anthropic-compatible endpoints

The credentials support custom base URLs via the `ANTHROPIC_BASE_URL` environment variable.

## Usage

### Basic Setup
1. Add the **Claude Code Agent** node to your workflow
2. Connect **Anthropic API** credentials
3. Enter your prompt in the **Text** field
4. Select your desired **Model**

### With Tools
1. Connect **AI Tool** nodes (e.g., Calculator, HTTP Request, Custom Tools)
2. The agent will automatically detect and use tools when needed
3. Tools are exposed via MCP protocol to Claude

### With Memory
1. Connect an **AI Memory** node (e.g., Window Buffer Memory, Chat Memory)
2. The agent will include conversation history in its context
3. History is formatted as User/Assistant message pairs

### Advanced Options
- **System Message**: Provide custom instructions for the agent
- **Max Turns**: Limit agent iterations (default: unlimited)
- **Verbose**: Enable detailed console and file logging

## Debug Logging

When verbose mode is enabled, detailed logs are written to `/logs/debug-<timestamp>.log`:
- Configuration and parameters
- Tool schema extraction details
- MCP server status
- Complete SDK message stream
- Tool invocation traces with arguments and results
- Error details and stack traces

Check the logs directory after execution for troubleshooting and monitoring.

## Compatibility

- n8n version: 1.0.0+
- Requires `@anthropic-ai/claude-agent-sdk` package
- Compatible with n8n AI tools and LangChain tools

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Claude Code SDK Documentation](https://github.com/anthropics/claude-code-sdk)
- [Anthropic API Documentation](https://docs.anthropic.com/)

## License

[MIT](LICENSE.md)
