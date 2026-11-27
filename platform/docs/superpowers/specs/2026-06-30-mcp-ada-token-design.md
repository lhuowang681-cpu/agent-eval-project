# MCP Ada Token Design

## Goal

Let signed-in users manually configure the company MCP auth token until an official token API exists, and automatically attach it to company HTTP MCP requests when the request has no `x-bbzai-mcp-token` header.

## Data Model

Add nullable `mcp_ada_token` to the `users` table and expose it as `mcpAdaToken` in user state. Store only the token value, not the pasted MCP JSON. Add a focused user mutation for updating this field so the later official API integration can replace this temporary manual writer without changing unrelated profile fields.

## Token Parsing

Create a shared parser that accepts either a raw `ada_...` token or pasted MCP JSON. For JSON, read the first MCP server config under `mcpServers` and extract `headers["x-bbzai-mcp-token"]`. Trim values and reject empty or missing tokens.

The input placeholder must show:

```json
{
  "mcpServers": {
    "bigdata-metadata-api-mcp": {
      "url": "http://metadata-osg-stream-function.faas.ctripcorp.com/mcp",
      "headers": {
        "x-bbzai-mcp-token": "ada_xxx"
      },
      "type": "streamable-http"
    }
  }
}
```

## User Experience

On web, after user state loads, show a modal on the home page when the signed-in user has no saved token. The modal links to `https://aicoding.portal.ctripcorp.com/mcp-server/market`, explains: `点击链接，进入任意mcp详情页，点击侧边栏cursor，点击复制，粘贴到输入框`, shows `https://dimg04.c-ctrip.com/images/1xt6412000szlw89sADB5.jpg`, and saves the parsed token.

On desktop, add a dedicated post-login onboarding page for this configuration. The page uses the same parser and save mutation. If a token already exists, the page can show it as configured and allow continuing.

In `/settings/profile`, add an editable `x-bbzai-mcp-token` row so users can view and update the saved token. Reuse the same parser, placeholder, and save mutation.

## MCP Header Injection

Add a small helper that fills `x-bbzai-mcp-token` only when HTTP MCP params have no non-empty value for that header. Existing explicit non-empty headers win.

Use the helper in web server MCP routes before calls to `mcpService` and in desktop HTTP MCP manifest creation before creating the MCP client. Stdio MCP params are unchanged.

## Tests

Add focused unit tests for token parsing and header injection. Add or update service tests for the user mutation. Run targeted Vitest files and type-check if feasible.
