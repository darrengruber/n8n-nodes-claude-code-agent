# Claude Agent Tool Orchestration Architecture

This document illustrates how the Claude Agent node organizes tools into three buckets (native, n8n LangChain tools, and MCP clients) and feeds them into the Claude SDK runtime.

## High-level flow

```
+----------------------------+
| Incoming tool instances    |
| (n8n LangChain & MCP)      |
+-------------+--------------+
              |
              v
      groupTools(): classify
      - by sourceNodeName
      - detect execute/http
      - collect MCP clients
              |
              v
+-------------+--------------------------+
| buildNativeToolPolicy()               |
| - Apply allowlist                     |
| - Gate Bash/WebFetch by connected     |
|   Execute Command/HTTP Request nodes  |
+-------------+--------------------------+
              |
              v
+-------------+---------------------------+
| adaptN8nToolsToMcp()                   |
| - Extract schema                       |
| - Rename Execute Command -> Bash       |
| - Rename HTTP Request -> WebFetch      |
| - Harden Bash against curl/wget w/o    |
|   HTTP Request node                    |
+-------------+---------------------------+
              |
              v
+-------------+---------------------------+
| adaptMcpClientTool()                   |
| - listTools() discovery -> SDK tools   |
| - listResources() discovery captured   |
|   for observability                    |
+-------------+---------------------------+
              |
              v
+-------------+---------------------------+
| createSdkMcpServer() per source        |
| - One server per sourceNodeName        |
| - Allowed tool names accumulated       |
+-------------+---------------------------+
              |
              v
+-------------+---------------------------+
| processToolsForAgent() result          |
| - mcpServers map for SDK               |
| - allowed/disallowed natives           |
| - resourceDiscoveries from MCP clients |
+----------------------------------------+
```

## Execution path inside ClaudeAgentExecute

```
ClaudeAgentExecute
  ├─ get input tools (AiTool input)
  ├─ processToolsForAgent()
  │    ├─ native allowlist policy
  │    ├─ n8n tool adaptation -> MCP servers
  │    └─ MCP client discovery (tools + resources)
  ├─ query() from @anthropic-ai/claude-agent-sdk
  │    └─ receives mcpServers + allowed/disallowed
  └─ returns node output
```

The additional resource discovery hook ensures Claude's native `ListMcpResources` tool can interrogate attached MCP servers with pre-fetched resource metadata for auditability and debugging.
