# Kiro 本地浏览器化账号管理器

Kiro Account Manager 是一个本机运行的 Kiro 多账号管理工具。当前代码已从旧 Electron 桌面外壳迁移为普通 Node 本地管理服务 + Vite/React 浏览器界面：

```text
Node 本地服务 -> REST/SSE 本地管理 API -> 浏览器 UI
```

当前仓库不再包含 Electron runtime、preload bridge、BrowserWindow 生命周期、Electron 打包配置或 `src/main` 目录。原来被主进程复用的代理、K-Proxy、注册、机器码等核心逻辑已迁到 `src/core`。

## 当前状态

已完成：

- 删除 Electron preload、IPC bridge、BrowserWindow 生命周期和桌面打包工具链。
- 删除 `electron`、`electron-vite`、`electron-builder`、`@electron-toolkit/*`、`electron-store` 等依赖。
- 删除 `src/main/**` 和 `src/preload/**`；纯业务核心迁入 `src/core/**`。
- `src/server/standalone.ts` 作为纯 Node 本地管理服务入口。
- `src/renderer` 作为浏览器 UI，通过 REST/SSE 调用本地管理服务。
- 本地管理服务已覆盖账号、Auth、API 反代、Kiro 本地集成、注册、机器码、Kiro 设置、K-Proxy、诊断、订阅、Webhook、配置同步等 API。
- `/api/events` 提供 SSE 事件流，替代旧 renderer IPC 事件监听。
- 浏览器端文件导入/导出已改为上传/Blob 下载，不再依赖 Electron `dialog`。
- 打开外链和本地路径改为浏览器能力或 standalone Node `spawn` 能力，不再依赖 Electron `shell`。

仍需注意：

- `npm run serve` 当前只启动本地 API/SSE 服务，不内置托管 `out/renderer` 静态页面。
- 开发浏览器 UI 时需要单独运行 `npm run dev:web`，并通过 `VITE_KIRO_ADMIN_BASE_URL` 指向本地服务。
- `AGENTS.md` 和 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md` 仍可能含旧 Electron 过渡态说明；最新清理状态以 `docs/ELECTRON-CLEANUP-TASK-BREAKDOWN.md` 和当前代码为准。

## 快速开始

安装依赖：

```powershell
npm install
```

启动本地管理服务：

```powershell
$env:KIRO_ADMIN_HOST = "127.0.0.1"
$env:KIRO_ADMIN_PORT = "9527"
$env:KIRO_ADMIN_TOKEN = "your-local-admin-token"
npm run serve
```

另开一个 PowerShell 启动浏览器 UI：

```powershell
$env:VITE_KIRO_ADMIN_BASE_URL = "http://127.0.0.1:9527"
npm run dev:web
```

打开 Vite 打印的页面地址，并在 URL 上带上 token，例如：

```text
http://127.0.0.1:5173/?token=your-local-admin-token
```

如果没有设置 `KIRO_ADMIN_TOKEN`，请从 `npm run serve` 输出里复制 `Access token`。

## 常用命令

```powershell
npm run dev:web          # 启动 Vite 浏览器 UI
npm run serve            # 构建并启动 Node 本地管理服务
npm run serve:build      # 只构建 out/server/standalone.mjs
npm run serve:smoke      # 构建并烟测本地管理服务
npm run build:web        # 构建浏览器 UI 到 out/renderer
npm run preview:web      # 预览 out/renderer
npm run typecheck        # Node + Web 类型检查
npm run typecheck:node   # 只检查 server/core
npm run typecheck:web    # 只检查 renderer
npm run lint             # ESLint
npm run build            # typecheck + server build + web build
```

预览已构建浏览器 UI 时，`VITE_KIRO_ADMIN_BASE_URL` 需要在 `build:web` 前设置，因为它会被 Vite 写入产物：

```powershell
$env:VITE_KIRO_ADMIN_BASE_URL = "http://127.0.0.1:9527"
npm run build:web
npm run preview:web
```

## 本地服务

默认监听：

```text
http://127.0.0.1:9527
```

访问规则：

- `GET /api/health` 不需要 token。
- 其他 API 需要 local-admin token。
- token 可通过 `Authorization: Bearer <token>` 或查询参数 `?token=<token>` 传入。
- 服务只允许本机 loopback 访问，并只接受 localhost / 127.0.0.1 origin。

常用健康检查：

```powershell
Invoke-RestMethod "http://127.0.0.1:9527/api/health"
```

带 token 调用：

```powershell
$headers = @{ Authorization = "Bearer your-local-admin-token" }
Invoke-RestMethod "http://127.0.0.1:9527/api/proxy/status" -Headers $headers
```

## API 覆盖

当前 standalone 会挂载以下 controller：

- `/api/accounts/*`：账号数据、刷新、批量刷新、状态检查、模型查询。
- `/api/auth/*`：Builder ID、IAM SSO、Social Auth、SSO 导入。
- `/api/proxy/*`：OpenAI/Claude 兼容 API 反代、API Key、日志、模型、账号池、客户端配置。
- `/api/kiro-local/*`：Kiro IDE/CLI 本地账号切换、凭证读取、登出。
- `/api/registration/*`：自动注册、手动注册、任务状态、取消。
- `/api/machine-id/*`：机器码读取、生成、设置、备份、恢复、管理员状态。
- `/api/kiro-settings/*`：Kiro settings、MCP、Steering 文件管理和本地路径打开。
- `/api/kproxy/*`：K-Proxy MITM、CA 证书、设备 ID、设备映射。
- `/api/diagnostics/*`：一键诊断、HTTP 探测、代理池验证。
- `/api/subscriptions/*`：订阅计划、订阅入口、overage 开关。
- `/api/webhooks/*`：Webhook 配置、测试、触发。
- `/api/config-sync/*`：配置导出/导入。
- `/api/events`：SSE 事件流。

`npm run serve:smoke` 会构建 `out/server/standalone.mjs`，启动随机端口服务，并检查核心健康端点。

## 当前目录结构

```text
src/
  core/
    proxy/                    # OpenAI/Claude-compatible API 反代核心
    kproxy/                   # K-Proxy MITM/device-id 核心
    registration/             # 注册核心流程
    machine-id.ts             # 机器码核心操作
    network/
    kiro-settings/
    runtime/
  server/
    standalone.ts             # 纯 Node 本地管理服务入口
    events.ts                 # SSE 事件总线
    http/
      local-admin-server.ts   # 本地 HTTP/SSE 服务
      controllers/            # REST controller
    services/                 # HTTP service 包装和业务编排
    storage/                  # 本地 JSON/加密存储
  renderer/
    index.html
    src/
      services/local-admin-*  # 浏览器端 REST/SSE client
      store/
      components/
docs/
  ELECTRON-CLEANUP-TASK-BREAKDOWN.md
  LOCAL-BROWSER-MIGRATION-PLAN.md
```

## 反代使用

本地 API 反代默认建议只监听本机：

```text
http://127.0.0.1:5580
```

可通过 UI 或 `/api/proxy/start` 启动：

```json
{
  "config": {
    "host": "127.0.0.1",
    "port": 5580,
    "apiKey": "your-local-proxy-key",
    "enableMultiAccount": true,
    "logRequests": true,
    "clientDrivenToolExecution": true
  }
}
```

OpenAI-compatible 客户端配置示例：

```powershell
$env:OPENAI_BASE_URL = "http://127.0.0.1:5580/v1"
$env:OPENAI_API_KEY = "your-local-proxy-key"
```

常用端点：

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/messages
```

## 数据和安全

- 默认数据目录由 `src/server/runtime/paths.ts` 解析，Windows 下通常位于 `%APPDATA%\kiro-account-manager`。
- 可通过 `KIRO_ADMIN_DATA_DIR` 指定数据目录。
- 可通过 `KIRO_ADMIN_ENCRYPTION_KEY` 指定本地加密 key。
- 账号文件可能包含 `accessToken`、`refreshToken`、`clientSecret` 等敏感信息，不要提交到仓库或粘贴到日志。
- `test/test_usage_api.py` 和 `test/test_kiro_apis.py` 是 live integration probes，会访问外部 Kiro 接口，且历史上包含硬编码 token；不要随意执行或输出其内容。

## 验证建议

普通代码改动后至少运行：

```powershell
npm run typecheck
```

涉及本地服务或 API 的改动建议运行：

```powershell
$env:KIRO_ADMIN_PORT = "0"
npm run serve:smoke
```

最终收口建议运行：

```powershell
npm run lint
npm run build
```

当前没有独立 JS 单元测试框架。`npm run test:e2e` 和 `npm run test:e2e:only` 是完整集成测试，需要运行中的本地代理/应用和可用账号，不是普通快速测试。

## 交接文档

最新 Electron 清理状态：

- [docs/ELECTRON-CLEANUP-TASK-BREAKDOWN.md](docs/ELECTRON-CLEANUP-TASK-BREAKDOWN.md)

历史迁移记录：

- [docs/LOCAL-BROWSER-MIGRATION-PLAN.md](docs/LOCAL-BROWSER-MIGRATION-PLAN.md)

后续若继续文档收尾，应同步更新 `AGENTS.md` 和 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md` 中仍保留的旧 Electron 过渡态描述。
