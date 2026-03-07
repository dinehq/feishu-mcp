#!/usr/bin/env node

/**
 * Feishu OAuth helper — run this to get a user_access_token.
 *
 * Usage: npx tsx src/oauth.ts -a APP_ID -s APP_SECRET
 *
 * 1. Opens the Feishu auth page in your browser
 * 2. You log in and authorize
 * 3. Feishu redirects to localhost:3000/callback
 * 4. This script exchanges the code for a user_access_token and prints it
 */

import { createServer } from "node:http";
import { execSync } from "node:child_process";

const BASE_URL = "https://open.feishu.cn";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-a" && args[i + 1]) parsed.appId = args[++i];
    else if (args[i] === "-s" && args[i + 1]) parsed.appSecret = args[++i];
  }
  return parsed;
}

const config = parseArgs();
if (!config.appId || !config.appSecret) {
  console.error("Usage: npx tsx src/oauth.ts -a APP_ID -s APP_SECRET");
  process.exit(1);
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

async function exchangeCodeForToken(code: string) {
  const appAccessToken = await getAppAccessToken();

  const res = await fetch(
    `${BASE_URL}/open-apis/authen/v1/oidc/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appAccessToken}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
      }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  return data.data;
}

const REDIRECT_URI = "http://localhost:3000/callback";

const scopes = [
  "sheets:spreadsheet:readonly",
  "docx:document:readonly",
  "bitable:app:readonly",
  "drive:drive:readonly",
].join("+");

const authUrl = `${BASE_URL}/open-apis/authen/v1/authorize?app_id=${config.appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}`;

console.log("\nOpening Feishu authorization page in your browser...\n");
console.log(`If it doesn't open, visit:\n${authUrl}\n`);

try {
  execSync(`open "${authUrl}"`);
} catch {
  // ignore if open command fails
}

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost:3000");
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400);
    res.end("Missing code parameter");
    return;
  }

  try {
    const tokenData = await exchangeCodeForToken(code);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Authorization successful!</h1><p>You can close this tab.</p>");

    console.log("--- Token obtained successfully ---\n");
    console.log(`user_access_token:  ${tokenData.access_token}`);
    console.log(`refresh_token:      ${tokenData.refresh_token}`);
    console.log(`expires_in:         ${tokenData.expires_in}s`);
    console.log(`refresh_expires_in: ${tokenData.refresh_expires_in}s`);
    console.log(`\nAdd -u flag to your MCP config:\n`);
    console.log(`  "-u", "${tokenData.access_token}"`);
    console.log(`\nOr to auto-refresh, add both -u and -r:\n`);
    console.log(`  "-u", "${tokenData.access_token}",`);
    console.log(`  "-r", "${tokenData.refresh_token}"`);
  } catch (err) {
    res.writeHead(500);
    res.end(`Error: ${err}`);
    console.error(err);
  }

  server.close();
});

server.listen(3000, () => {
  console.log("Waiting for callback on http://localhost:3000/callback ...\n");
});
