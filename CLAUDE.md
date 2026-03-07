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

The server requires CLI flags: `-a APP_ID -s APP_SECRET [-u USER_TOKEN] [-r REFRESH_TOKEN]`

OAuth helper to obtain user tokens:
```sh
npx tsx src/oauth.ts -a APP_ID -s APP_SECRET
```

## Architecture

Two source files:

- **src/index.ts** — The MCP server. Registers 8 tools (document, spreadsheet, bitable readers) via `@modelcontextprotocol/sdk`. Handles two auth modes: tenant token (app-level) and user token (with auto-refresh via refresh token). All tools are read-only GET wrappers around the Feishu Open API (`https://open.feishu.cn/open-apis/...`).

- **src/oauth.ts** — Standalone OAuth helper. Starts a local HTTP server on port 3000, opens the Feishu auth page, and exchanges the callback code for user/refresh tokens.

## Auth Flow

1. Without `-u` flag: uses tenant_access_token (app-level permissions only)
2. With `-u` flag: uses user_access_token (user-scoped permissions)
3. With both `-u` and `-r`: auto-refreshes expired user tokens via the refresh_token
