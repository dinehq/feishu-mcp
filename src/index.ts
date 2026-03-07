#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://open.feishu.cn";

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-a" && args[i + 1]) parsed.appId = args[++i];
    else if (args[i] === "-s" && args[i + 1]) parsed.appSecret = args[++i];
    else if (args[i] === "-u" && args[i + 1]) parsed.userToken = args[++i];
    else if (args[i] === "-r" && args[i + 1]) parsed.refreshToken = args[++i];
  }
  return parsed;
}

const config = parseArgs();

// Token management
let tenantToken: string | null = null;
let tenantTokenExpiry = 0;
let userToken: string | null = config.userToken || null;
let refreshToken: string | null = config.refreshToken || null;
let userTokenExpiry = config.userToken ? Date.now() + 6000 * 1000 : 0; // assume ~100min initially

async function getTenantToken(): Promise<string> {
  if (tenantToken && Date.now() < tenantTokenExpiry) return tenantToken;

  const res = await fetch(
    `${BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret,
      }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Auth failed: ${data.msg}`);

  tenantToken = data.tenant_access_token;
  tenantTokenExpiry = Date.now() + (data.expire - 60) * 1000;
  return tenantToken!;
}

async function getAppAccessToken(): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/open-apis/auth/v3/app_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret,
      }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`App auth failed: ${data.msg}`);
  return data.app_access_token;
}

async function refreshUserToken(): Promise<string> {
  if (!refreshToken) throw new Error("No refresh token available");

  const appToken = await getAppAccessToken();
  const res = await fetch(
    `${BASE_URL}/open-apis/authen/v1/oidc/refresh_access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appToken}`,
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Token refresh failed: ${data.msg}`);

  userToken = data.data.access_token;
  refreshToken = data.data.refresh_token;
  userTokenExpiry = Date.now() + (data.data.expires_in - 60) * 1000;
  return userToken!;
}

async function getUserToken(): Promise<string> {
  if (userToken && Date.now() < userTokenExpiry) return userToken;
  return refreshUserToken();
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = userToken ? await getUserToken() : await getTenantToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function feishuGet(path: string, params?: Record<string, string>) {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const headers = await getAuthHeader();
  const res = await fetch(url.toString(), { headers });
  return res.json();
}

// MCP Server
const server = new McpServer({
  name: "feishu-reader",
  version: "1.0.0",
});

// --- Spreadsheet tools ---

server.tool(
  "list_sheets",
  "List all sheets (tabs) in a Feishu spreadsheet",
  { spreadsheet_token: z.string().describe("Spreadsheet token from the URL") },
  async ({ spreadsheet_token }) => {
    const data = await feishuGet(
      `/open-apis/sheets/v3/spreadsheets/${spreadsheet_token}/sheets/query`
    );
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    const sheets = data.data.sheets.map((s: any) => ({
      sheetId: s.sheet_id,
      title: s.title,
      rowCount: s.grid_properties?.row_count,
      columnCount: s.grid_properties?.column_count,
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(sheets, null, 2) }] };
  }
);

server.tool(
  "read_spreadsheet_range",
  "Read a range of cells from a Feishu spreadsheet. Range format: sheetId!A1:C10 or sheetTitle!A1:C10",
  {
    spreadsheet_token: z.string().describe("Spreadsheet token from the URL"),
    range: z
      .string()
      .describe(
        "Range to read, e.g. 'Sheet1!A1:C10' or 'abc123!A1:Z100'. Use sheet title or sheet ID."
      ),
    render_option: z
      .enum(["ToString", "FormattedValue", "UnformattedValue"])
      .optional()
      .describe("How to render cell values. Default: ToString"),
  },
  async ({ spreadsheet_token, range, render_option }) => {
    const params: Record<string, string> = {};
    if (render_option) params.valueRenderOption = render_option;

    const data = await feishuGet(
      `/open-apis/sheets/v2/spreadsheets/${spreadsheet_token}/values/${range}`,
      params
    );
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    const values = data.data?.valueRange?.values ?? [];
    return { content: [{ type: "text" as const, text: JSON.stringify(values, null, 2) }] };
  }
);

server.tool(
  "get_spreadsheet_info",
  "Get metadata about a Feishu spreadsheet (title, owner, etc.)",
  { spreadsheet_token: z.string().describe("Spreadsheet token from the URL") },
  async ({ spreadsheet_token }) => {
    const data = await feishuGet(
      `/open-apis/sheets/v3/spreadsheets/${spreadsheet_token}`
    );
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.data.spreadsheet, null, 2) }],
    };
  }
);

// --- Document tools ---

server.tool(
  "get_document_info",
  "Get metadata about a Feishu document",
  { document_id: z.string().describe("Document ID from the URL") },
  async ({ document_id }) => {
    const data = await feishuGet(`/open-apis/docx/v1/documents/${document_id}`);
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.data.document, null, 2) }],
    };
  }
);

server.tool(
  "read_document_content",
  "Read the raw text content of a Feishu document",
  { document_id: z.string().describe("Document ID from the URL") },
  async ({ document_id }) => {
    const data = await feishuGet(
      `/open-apis/docx/v1/documents/${document_id}/raw_content`
    );
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    return { content: [{ type: "text" as const, text: data.data.content }] };
  }
);

server.tool(
  "read_document_blocks",
  "Read all content blocks from a Feishu document (structured content with formatting)",
  {
    document_id: z.string().describe("Document ID from the URL"),
    page_token: z.string().optional().describe("Pagination token for next page"),
  },
  async ({ document_id, page_token }) => {
    const params: Record<string, string> = { page_size: "500" };
    if (page_token) params.page_token = page_token;

    const data = await feishuGet(
      `/open-apis/docx/v1/documents/${document_id}/blocks`,
      params
    );
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.data, null, 2) }],
    };
  }
);

// --- Bitable (multidimensional table) tools ---

server.tool(
  "list_bitable_tables",
  "List all tables in a Feishu Bitable (multidimensional spreadsheet)",
  { app_token: z.string().describe("Bitable app token from the URL") },
  async ({ app_token }) => {
    const data = await feishuGet(
      `/open-apis/bitable/v1/apps/${app_token}/tables`
    );
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.data, null, 2) }],
    };
  }
);

server.tool(
  "read_bitable_records",
  "Read records from a Feishu Bitable table",
  {
    app_token: z.string().describe("Bitable app token from the URL"),
    table_id: z.string().describe("Table ID"),
    page_size: z.number().optional().describe("Number of records per page (max 500, default 20)"),
    page_token: z.string().optional().describe("Pagination token"),
    filter: z.string().optional().describe("Filter expression, e.g. AND(CurrentValue.[field]=\"value\")"),
  },
  async ({ app_token, table_id, page_size, page_token, filter }) => {
    const params: Record<string, string> = {};
    if (page_size) params.page_size = String(page_size);
    if (page_token) params.page_token = page_token;
    if (filter) params.filter = filter;

    const data = await feishuGet(
      `/open-apis/bitable/v1/apps/${app_token}/tables/${table_id}/records`,
      params
    );
    if (data.code !== 0) {
      return { content: [{ type: "text" as const, text: `Error: ${data.msg}` }] };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.data, null, 2) }],
    };
  }
);

// Start server
async function main() {
  if (!config.appId || !config.appSecret) {
    console.error("Usage: feishu-mcp -a APP_ID -s APP_SECRET [-u USER_TOKEN]");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
