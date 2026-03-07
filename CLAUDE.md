# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Feishu/Lark MCP (Model Context Protocol) server that provides read-only access to Feishu documents, spreadsheets, and Bitables. It runs as a stdio transport server consumed by Claude.

## Commands

```sh
pnpm install          # Install dependencies
pnpm dev              # Run the server in dev mode (tsx)
pnpm build            # Compile TypeScript to dist/
```

The server requires CLI flags: `-a APP_ID -s APP_SECRET`

User tokens are auto-loaded from `~/.feishu-mcp/tokens.json` (created by the OAuth helper). The `-u` and `-r` flags are supported but optional.

OAuth helper to obtain user tokens:
```sh
npx tsx src/oauth.ts -a APP_ID -s APP_SECRET
```

## Architecture

Two source files:

- **src/index.ts** — The MCP server. Registers 8 tools (document, spreadsheet, bitable readers) via `@modelcontextprotocol/sdk`. Handles two auth modes: tenant token (app-level) and user token (with auto-refresh via refresh token). Tokens are persisted to `~/.feishu-mcp/tokens.json` and auto-refreshed on expiry. All tools are read-only GET wrappers around the Feishu Open API (`https://open.feishu.cn/open-apis/...`).

- **src/oauth.ts** — Standalone OAuth helper. Starts a local HTTP server on port 3000, opens the Feishu auth page, and exchanges the callback code for user/refresh tokens. Saves tokens to `~/.feishu-mcp/tokens.json`.

## Auth Flow

1. Without user token: uses tenant_access_token (app-level permissions only)
2. With user token (from `~/.feishu-mcp/tokens.json` or `-u` flag): uses user_access_token (user-scoped permissions)
3. Auto-refresh: when user token expires, refreshes via refresh_token and persists new tokens
4. Retry: if an API call gets a token-expired error, refreshes and retries once
