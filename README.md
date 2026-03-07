# Feishu MCP Server

让 Claude 读取飞书文档、电子表格和多维表格。

## 安装

```sh
pnpm install
```

## 使用

### 0. 创建飞书应用

前往[飞书开放平台](https://open.feishu.cn/app)创建一个**自建应用**：

1. 登录开放平台，点击「创建自建应用」
2. 进入应用，在「权限管理」中开通以下权限：
   - `sheets:spreadsheet:readonly` — 读取电子表格
   - `docx:document:readonly` — 读取文档
   - `bitable:app:readonly` — 读取多维表格
   - `drive:drive:readonly` — 读取云空间
3. 在「安全设置」中添加重定向 URL：`http://localhost:3000/callback`
4. 在「凭证与基础信息」中获取 **App ID** 和 **App Secret**

> 应用需要发布版本后，权限才会生效。如果只在开发环境使用，可以创建测试版本并添加可用性范围。

### 1. 获取用户令牌

```sh
npx tsx src/oauth.ts -a <APP_ID> -s <APP_SECRET>
```

浏览器会打开飞书授权页面，登录授权后脚本会输出 `user_access_token` 和 `refresh_token`。

### 2. 配置 Claude MCP

在 Claude 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": [
        "tsx", "/absolute/path/to/src/index.ts",
        "-a", "<APP_ID>",
        "-s", "<APP_SECRET>",
        "-u", "<USER_ACCESS_TOKEN>",
        "-r", "<REFRESH_TOKEN>"
      ]
    }
  }
}
```

| 参数 | 说明 |
|------|------|
| `-a` | 飞书应用 App ID |
| `-s` | 飞书应用 App Secret |
| `-u` | 用户令牌（来自步骤 1） |
| `-r` | 刷新令牌（令牌过期后自动续期） |

省略 `-u` `-r` 则使用 tenant token，只能访问应用本身有权限的资源。

## 可用工具

- **get_document_info / read_document_content / read_document_blocks** — 读取文档
- **get_spreadsheet_info / list_sheets / read_spreadsheet_range** — 读取电子表格
- **list_bitable_tables / read_bitable_records** — 读取多维表格

## 从 URL 提取 ID

| URL 路径 | 提取内容 |
|---|---|
| `larksuite.com/wiki/<id>` | 文档 ID |
| `larksuite.com/sheets/<token>` | 电子表格 token |
| `larksuite.com/base/<token>` | 多维表格 app token |

## 凭据共享

- **App ID / App Secret**：应用级凭据，可通过私密渠道分享给团队成员。勿提交到 git。
- **用户令牌**：个人凭据，每人需自行运行步骤 1 获取。勿共享。
