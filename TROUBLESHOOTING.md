# Known Issues

## Copy/Paste Node Type Error

### Symptom
Error when executing a workflow: `Unrecognized node type: CUSTOM.claudeAgent`

### Cause
When copying/pasting nodes in n8n, the node type identifier is preserved. If the node was saved with an old identifier format (e.g., `CUSTOM.claudeAgent`), n8n cannot resolve it to the current format (`CUSTOM.n8n-nodes-claude-agent.claudeAgent`).

This is a limitation of how n8n handles custom node type identifiers - they're prefixed with the package name, and copied nodes preserve the old identifier.

### Solution

**Option 1: Delete and Re-add (Recommended)**
1. Delete the copied node
2. Add a fresh "Claude Agent" node from the node palette
3. Reconfigure and reconnect it

**Option 2: Fix Workflow JSON**
1. Export your workflow
2. Find the node with `"type": "CUSTOM.claudeAgent"`
3. Change it to `"type": "CUSTOM.n8n-nodes-claude-agent.claudeAgent"`
4. Import the workflow back

### Prevention
- Avoid copying agent nodes - add new ones from the palette instead
- If you must copy, verify the node type identifier matches the current format

### Note
n8n's built-in nodes (like `@n8n/n8n-nodes-langchain.agent`) don't have this issue because they use a consistent namespace that's handled by n8n core. This limitation only affects custom/community nodes.

## Claude Code SDK Process Exit Error

### Symptom
The node fails with error: `Claude Code process exited with code 1`

### Potential Causes

1. **Custom Base URL Compatibility**: The Claude Code SDK spawns a subprocess that might not fully respect `ANTHROPIC_BASE_URL` for all operations. If you're using a custom endpoint (e.g., `https://api.z.ai/api/anthropic`), the subprocess might fail to authenticate or connect.

2. **Tool Server Issues**: If you have tools connected, the MCP server creation might be causing the subprocess to fail. Try running without tools to isolate the issue.

3. **Model Name Mismatch**: Ensure the model name is valid for your endpoint. Custom endpoints might have different model names than the standard Anthropic API.

### Debugging Steps

1. **Enable Verbose Mode**: In the node options, enable "Verbose" to see detailed logs in the n8n console.

2. **Check n8n Logs**: The detailed error logs will be printed to the n8n console with the `[ClaudeAgent]` prefix.

3. **Test Without Tools**: Disconnect any tool inputs to see if the issue is related to MCP tool server creation.

4. **Verify Endpoint**: If using a custom base URL, verify it's compatible with the Claude Code SDK's subprocess requirements.

5. **Try Standard Endpoint**: Temporarily test with the standard Anthropic API endpoint to confirm the issue is related to the custom endpoint.

### Workarounds

- Use the standard Anthropic API endpoint (`https://api.anthropic.com`) if possible
- If using a proxy, ensure it fully supports the Claude API including streaming and subprocess operations
- Consider using a different node type if Claude Code SDK is incompatible with your setup
