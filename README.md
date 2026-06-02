# Kiro 本地浏览器化账号管理器

这是一个正在重构中的 Kiro 多账号管理项目。

当前重构目标是把原 Electron 桌面软件迁移为：

```text
本机启动服务 -> 浏览器打开管理后台 -> 本地完成账号、登录、代理、机器码等管理操作
```

第一轮重构只做代码删减和服务化边界建设，暂时不实现新的浏览器管理界面。

## 当前状态

项目仍处在 Electron 过渡态。

已经完成：

- 删除低风险桌面外壳组件。
- 删除系统托盘逻辑。
- 删除自动更新逻辑。
- 删除全局快捷键逻辑。
- 删除自定义标题栏和窗口控制 IPC。
- 删除机器码模块里的 Electron 弹窗和自动重启行为。
- 新增 runtime 适配层。
- 新增 `src/server/events.ts` 事件总线。
- 新增本地管理服务骨架 `src/server/http/local-admin-server.ts`。
- 新增账号/Auth 服务层与 REST API。
- 新增独立 Node 服务入口，可通过 `npm run serve` 启动本地管理服务。
- 新增 API 反代 HTTP controller，可通过 `/api/proxy/*` 管理启动、配置、统计、日志、API Key、账号池和模型。
- 新增 Webhook REST controller，并接入 standalone 与 Electron 本地管理服务。
- 独立本地服务已支持账号、Auth、API 反代、Kiro 本地集成、注册、机器码、Kiro 设置、K-Proxy、诊断、订阅、Webhook 等 API。
- API 反代已验证 `claude-sonnet-4.5` 的 OpenAI-compatible 与 Anthropic-compatible 调用。
- 多账号 round-robin 轮询与额度耗尽后的账号跳过/切换逻辑已验证。
- `docs/` 目录已清理为单一交接计划书。

仍未完成：

- 刷新/检查/注册/代理等事件尚未由 SSE 完整替代 renderer IPC。
- 当前 UI 仍依赖 Electron preload 和 IPC。
- 新浏览器后台 UI 暂未实现；standalone 模式目前是无界面 API 服务。
- Electron 窗口生命周期和桌面打包配置仍未完全删除。

所以请不要把当前仓库当成已经完成的纯浏览器项目。

## 新项目目标

最终项目形态：

- 管理服务默认只监听 `127.0.0.1`。
- 用户在本机启动服务后，通过浏览器访问管理后台。
- 不默认开放局域网访问。
- 不保留 Electron 桌面软件外壳。
- 不保留系统托盘、自动更新、自定义标题栏、桌面关闭确认等桌面专属逻辑。
- 核心账号能力尽量完整保留。

已确认取舍：

- Google/GitHub 社交登录短期接受手动粘贴回调 URL/code。
- 机器码修改、K-Proxy CA 证书安装等系统级操作接受管理员权限启动本地服务后再执行。
- 采用后端优先剪枝策略：先抽服务，再删 Electron 外壳，最后做浏览器 UI。

详细交接和后续任务见：

- [docs/LOCAL-BROWSER-MIGRATION-PLAN.md](docs/LOCAL-BROWSER-MIGRATION-PLAN.md)

## 必须保留的核心能力

账号管理：

- 多账号增删改查。
- 分组、标签、筛选、排序。
- 批量导入导出。
- 账号凭证存储、备份、恢复。

刷新和查询：

- Token 刷新。
- 批量后台刷新。
- 轮询查询。
- 批量检查账号状态。
- 自动刷新。
- 自动换号。
- 余额阈值切换。

登录：

- Builder ID device flow。
- IAM Identity Center SSO。
- Google/GitHub 社交登录，短期改为手动粘贴回调 URL/code。

本地 Kiro 集成：

- 切换 Kiro IDE 账号。
- 切换 Kiro CLI 账号。
- 从本地 Kiro 凭证导入账号。
- Kiro 设置、MCP、Steering 文件管理。

代理和注册：

- OpenAI/Claude 兼容 API 反代。
- 代理池。
- 代理验证、轮询、随机、最少使用、最快优先。
- 账号绑定代理。
- K-Proxy MITM、CA 证书、设备 ID 映射。
- 自动注册、手动注册、批量注册。

其他：

- 机器码读取、生成、设置、备份、恢复。
- 订阅管理。
- Webhook 通知。
- 日志。
- 诊断。
- 配置同步。

## 当前重要目录

```text
src/
  main/
    index.ts                  # 当前过渡态集成 hub，仍混有 Electron 生命周期和核心业务
    proxy/                    # API 反代核心，必须保留
    kproxy/                   # K-Proxy MITM 核心，必须保留
    registration/             # 注册核心，必须保留；ipc-handlers 后续替换为 HTTP controller
    services/
      runtime/                # 当前 Electron runtime 适配层
      storage/
      network/
      kiro/
  server/
    standalone.ts              # 独立 Node 服务入口
    events.ts                 # 新增事件总线
    http/
      local-admin-server.ts   # 本地管理服务
      controllers/            # 账号/Auth/API 反代/Kiro 本地/注册/机器码/Kiro 设置/K-Proxy/诊断/订阅 REST controller 已就位
    services/
      accounts/               # AccountService、Token 刷新、批量操作、standalone Kiro API client
      auth/                   # AuthService
      kiro-local/             # Kiro IDE/CLI 本地凭证集成
      registration/           # 注册任务编排
      machine-id/             # 机器码读写/备份/恢复
      kiro-settings/          # Kiro 设置、MCP、Steering 文件管理
      proxy/                  # API 反代 HTTP service 包装
      kproxy/                 # K-Proxy MITM HTTP service 包装
      diagnostics/            # 一键诊断与代理池验活
      subscriptions/          # 订阅计划、订阅入口、超额开关
  preload/                    # Electron 过渡桥，暂时不能整体删除
  renderer/                   # 旧 React UI，暂时保留作迁移参考
docs/
  LOCAL-BROWSER-MIGRATION-PLAN.md
```

## 不要误删

接手时尤其注意：

- 不要直接删除 `src/main/index.ts`。
- 不要直接删除 `src/preload/**`。
- 不要直接删除 `src/renderer/**`。
- 不要删除 `src/main/proxy/**`。
- 不要删除 `src/main/kproxy/**`。
- 不要删除 `src/main/registration/registrar.ts`。
- 不要把 `src/renderer/src/store/accounts.ts` 当成纯 UI 状态文件，它里面还有大量业务规则。
- 不要运行 live integration probes，除非明确知道它们会访问外部 Kiro 服务并可能使用敏感 token。

下一步优先做 Webhook、配置同步 controller，或推进浏览器 UI 接入现有 HTTP/SSE。

## 当前命令

安装依赖：

```powershell
npm install
```

当前过渡态开发运行：

```powershell
npm run dev
```

独立本地服务：

```powershell
npm run serve:smoke
npm run serve
```

类型检查：

```powershell
npm run typecheck:node
npm run typecheck:web
npm run typecheck
```

构建：

```powershell
npm run build
```

说明：

- 当前脚本仍是 Electron 过渡态脚本。
- `npm run dev` 仍启动 Electron + renderer。
- `npm run serve` 会构建并启动 `out/server/standalone.mjs`，当前已挂载账号/Auth/API 反代/Kiro 本地集成/注册/机器码/Kiro 设置/K-Proxy/诊断/订阅 API 和 SSE 事件。

## 无界面 standalone 使用

当前 `npm run serve` 启动的是本地 API 服务，不是浏览器后台页面。

默认监听：

```text
http://127.0.0.1:9527
```

访问 `/api/health` 不需要 token；其他 API 需要 local-admin token。可以通过环境变量固定 token：

```powershell
$env:KIRO_ADMIN_HOST = "127.0.0.1"
$env:KIRO_ADMIN_PORT = "9527"
$env:KIRO_ADMIN_TOKEN = "your-local-admin-token"
npm run serve
```

常用接口：

```text
GET  /api/accounts
POST /api/accounts
GET  /api/proxy/status
POST /api/proxy/accounts/sync
POST /api/proxy/start
POST /api/proxy/stop
GET  /api/proxy/models
GET  /api/webhooks/health
```

### 导入账号

完整导出文件格式为：

```json
{
  "version": "1.x.x",
  "exportedAt": 0,
  "accounts": [],
  "groups": [],
  "tags": []
}
```

standalone 模式没有可视化导入按钮。导入时需要把 `accounts` 数组合并为存储结构里的 `accounts` 对象，再通过 `POST /api/accounts` 保存。保存后再调用 `/api/proxy/accounts/sync` 把 active 且带 `accessToken` 的账号同步到代理账号池。

注意：账号文件包含 `accessToken`、`refreshToken`、`clientSecret` 等敏感信息，不要提交到仓库或粘贴到日志。

### 启动 API 反代

本地 API 反代默认使用 OpenAI/Claude 兼容接口。推荐只监听本机：

```text
http://127.0.0.1:5580
```

启动代理时通过 `/api/proxy/start` 设置：

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

客户端配置：

```powershell
$env:OPENAI_BASE_URL = "http://127.0.0.1:5580/v1"
$env:OPENAI_API_KEY = "your-local-proxy-key"
```

已验证模型：

```text
claude-sonnet-4.5
```

已验证端点：

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/messages
```

### OpenCode 配置

OpenCode 可使用 `@ai-sdk/openai-compatible` provider 指向本地代理，并只暴露 `claude-sonnet-4.5`：

```json
{
  "provider": {
    "kiro-account-manager": {
      "models": {
        "claude-sonnet-4.5": {
          "limit": {
            "context": 128000,
            "output": 16384
          },
          "name": "claude-sonnet-4.5"
        }
      },
      "name": "kiro-account-manager",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "apiKey": "your-local-proxy-key",
        "baseURL": "http://127.0.0.1:5580/v1"
      }
    }
  }
}
```

### 多账号轮询

`src/main/proxy/accountPool.ts` 默认使用 `round-robin` 策略。非流式请求遇到账号级错误时会按错误类型处理：

- `402`、`429`、`quota`、`limit exceeded` 等配额/限流错误会记录为 recoverable。
- 配额错误会标记账号 `quotaExhaustedAt`，后续选择账号时跳过。
- 多账号模式下会继续选择下一个可用账号。
- 如果所有账号都耗尽，会返回 `All accounts quota exhausted ...`。

已通过受控模拟验证：

- 账号池临时缩到 2 个账号。
- 第 1 个账号模拟额度耗尽。
- `claude-sonnet-4.5` 请求实际使用第 2 个账号。
- 测试后恢复 11 个账号，`availableCount = 11`。

流式请求中途出错时不能保证同一条流无感续接，但会记录账号错误，后续请求会避开不可用账号。

## 验证要求

常规代码改动后至少运行：

```powershell
npm run typecheck:node
npm run typecheck:web
```

涉及 lint 的改动可运行：

```powershell
npm run lint
```

注意：

- 当前没有 JS 单元测试框架。
- `npm run test:e2e` 和 `npm run test:e2e:only` 是 live integration 测试，不是普通单元测试。
- `test/test_usage_api.py` 和 `test/test_kiro_apis.py` 会访问外部 Kiro 接口，并且历史上包含硬编码 token，不要随意执行或粘贴内容。

## 当前交接节点

接手前先运行：

```powershell
git status --short
git diff --stat
```

当前预期工作区包含：

- 删除 `README_CN.md`。
- 重写中文 `README.md`。
- 删除 `docs/` 下旧文档，只保留迁移计划书。
- 删除 `src/main/tray.ts`。
- 删除低风险桌面外壳和更新/托盘/窗口 IPC。
- 新增 `src/main/services/runtime/*`。
- 新增 `src/server/*`。
- 新增独立 Node 服务入口和 `npm run serve`。
- 修改机器码管理员权限流程。
- 修改事件发送为事件总线 + Electron 临时兼容桥。

所有这些都属于同一轮“本地浏览器化重构交接”工作，不要在未理解前只回滚其中一部分。

## 当前下一步

推荐下一刀：

1. 继续 Webhook、配置同步 controller 化。
2. 浏览器 UI 接入 `/api/accounts/check-status`、`/api/kiro-local/*`、`/api/registration/*`、`/api/machine-id/*`、`/api/kiro-settings/*`、`/api/kproxy/*`、`/api/diagnostics/*`、`/api/subscriptions/*` 后，再删除对应 IPC/preload 桥接。

完成这些后，再继续删除对应 Electron IPC。
