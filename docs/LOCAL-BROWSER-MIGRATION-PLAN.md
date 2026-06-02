# Kiro 账号管理器本地浏览器化重构交接计划书

日期：2026-06-02

本文档是当前唯一保留的 `docs/` 交接文档。后续接手请先读本文，不要参考已删除的旧 changelog、旧重构计划、旧 E2E 说明和旧架构总结。

## 1. 接手必读

当前目标：把 Electron 桌面应用迁移为“本机启动服务 + 浏览器打开管理后台”的形态。

当前阶段：P0 服务层核心、账号/Auth IPC 委托统一、独立 Node 服务启动入口、API 反代 HTTP controller 已完成，继续推进 P1 controller 化。浏览器端 UI 暂时不实现。

当前状态很重要：

- 代码仍处在 Electron 过渡态。
- 核心业务还大量保留在 `src/main/index.ts` 和 renderer store 中。
- 不能直接删除 `src/main/index.ts`、`src/preload/**`、`src/renderer/**`。
- 已经删除低风险桌面外壳，但账号、登录、轮询、代理、注册、机器码等核心功能必须继续保留。
- 当前工作区有未提交改动，接手前必须先跑 `git status --short`。

最容易误删的点：

- `src/main/*` 不是纯桌面外壳，里面混有 Node 后端业务。
- `src/renderer/src/store/accounts.ts` 不是纯 UI 状态，里面混有账号规则、轮询、刷新、代理绑定、自动换号等业务规则。
- `src/preload/**` 目前仍是临时桥，只有等 HTTP/SSE controller 可替代后才能整体删除。
- `src/main/proxy/*` 和 `src/main/kproxy/*` 是核心业务，不能按 Electron 外壳删除。
- `src/main/registration/*` 是注册业务，只有 `ipc-handlers.ts` 后续需要替换为 HTTP controller，不能删除 registrar。

## 2. 已确认需求

最终形态：

- 在电脑中启动本地服务。
- 服务默认只监听 `127.0.0.1`。
- 用户打开本机浏览器访问管理后台。
- 不需要 Electron 桌面软件外壳。
- 第一轮先做代码删减和服务化，不实现新的浏览器 UI。

必须保留的核心能力：

- 账号管理：CRUD、分组、标签、筛选、批量导入导出。
- 账号凭证存储、备份、恢复。
- Token 刷新。
- 轮询查询和批量检查。
- 批量后台刷新。
- 自动刷新、自动换号、余额阈值切换。
- 浏览器登录。
- Builder ID device flow。
- IAM Identity Center SSO 登录。
- Google/GitHub 社交登录，但短期接受手动粘贴回调 URL/code。
- 切换到 Kiro IDE。
- 切换到 Kiro CLI。
- 从本地 Kiro 凭证导入账号。
- API 反代。
- 代理池、代理验证、代理轮询、账号绑定代理。
- K-Proxy MITM、CA 证书、设备 ID 映射。
- 注册功能。
- 机器码读取、生成、设置、备份、恢复。
- Kiro 设置、MCP、Steering 文件管理。
- 订阅、Webhook、日志、诊断、配置同步。

已确认取舍：

- 管理后台第一版只允许本机 `127.0.0.1` 访问。
- 短期接受“手动粘贴回调 URL/code”处理 Google/GitHub 社交登录。
- 接受“需要管理员权限启动本地服务后再操作”机器码和证书相关功能。
- 迁移策略选择方案 A：后端优先剪枝。先抽服务，再删 Electron 外壳，最后做浏览器 UI。
- 方案 B 和方案 C 已从计划中移除，不再采用。

## 3. 当前保留/删除边界

必须保留：

- `src/main/proxy/*`
- `src/main/kproxy/*`
- `src/main/registration/*`，其中 `ipc-handlers.ts` 后续替换，不代表删除注册业务。
- `src/main/machineId.ts` 的平台逻辑。
- `src/main/services/*`
- `src/server/*`
- `src/renderer/src/store/accounts.ts` 中的业务规则，后续要拆到 server。
- `src/renderer/src/components/accounts/*`
- `src/renderer/src/components/proxy/*`
- `src/renderer/src/components/pages/RegisterPage.tsx`
- `src/renderer/src/types/*`

可以删除或最终删除：

- Electron 窗口生命周期。
- Electron preload 和 IPC 桥。
- 系统托盘。
- 自动更新。
- 全局快捷键。
- 自定义标题栏。
- 桌面关闭确认。
- Electron 桌面打包配置。
- 桌面 CI 打包流程。
- Electron 专属设置。

需要替换而不是直接删除：

- `ipcMain` / `ipcRenderer` 替换为 REST/SSE。
- `mainWindow.webContents.send(...)` 替换为事件总线 + SSE。
- `electron-store` 替换为 Node 本地存储层。
- Electron 文件对话框替换为浏览器上传/下载。
- `shell.openExternal/openPath` 替换为 Node runtime open 能力。
- `app.getPath('userData')` 替换为统一 data dir。
- `window.api.*` 替换为浏览器端 `apiClient.*`。

## 4. 已完成工作

### 4.1 第一批：低风险桌面外壳清理

已删除 renderer 桌面外壳组件：

- `src/renderer/src/components/UpdateDialog.tsx`
- `src/renderer/src/components/CloseConfirmDialog.tsx`
- `src/renderer/src/components/Versions.tsx`
- `src/renderer/src/components/layout/TitleBar.tsx`
- `src/renderer/src/components/layout/TaskCenter.tsx`

已删除 preload 桌面桥接：

- `src/preload/api/tray.ts`
- `src/preload/api/update.ts`
- `src/preload/api/window.ts`

已调整：

- `src/renderer/src/App.tsx` 移除自定义标题栏、更新弹窗、关闭确认弹窗、托盘账户同步和托盘事件监听。
- `src/renderer/src/components/pages/AboutPage.tsx` 移除检查更新入口。
- `src/renderer/src/components/pages/SettingsPage.tsx` 移除系统托盘设置和全局快捷键设置。
- `src/renderer/src/store/accounts.ts` 移除语言切换同步托盘菜单副作用。
- `src/preload/index.ts`、`src/preload/api/index.ts`、`src/preload/index.d.ts` 移除桌面桥接导出和类型。

### 4.2 第二批：主进程桌面外壳清理

已完成：

- 从 `src/main/index.ts` 移除 `electron-updater` 自动更新逻辑和更新 IPC。
- 从 `src/main/index.ts` 移除托盘初始化、托盘设置、托盘账户同步、托盘语言同步和托盘刷新 IPC。
- 从 `src/main/index.ts` 移除全局快捷键逻辑和 IPC。
- 从 `src/main/index.ts` 移除窗口最大化/最小化/关闭等自定义标题栏 IPC。
- 从 `src/main/index.ts` 移除关闭时最小化到托盘和关闭确认逻辑。
- 将 `BrowserWindow` 临时改回 `frame: true`，保证过渡态窗口仍可控制。
- 删除 `src/main/tray.ts`。
- 从 `package.json` 和 `package-lock.json` 移除 `electron-updater`。

仍保留：

- `app.whenReady()`。
- `createWindow()`。
- 单实例逻辑。
- 协议处理。
- `window-all-closed`。
- `will-quit`。
- 核心业务 IPC。

这些需要等本地 HTTP 服务和浏览器管理端接管后再删。

### 4.3 第三批：runtime 替代层

新增：

- `src/main/services/runtime/paths.ts`
- `src/main/services/runtime/open.ts`
- `src/main/services/runtime/dialogs.ts`

已集中封装：

- `getUserDataPath()`
- `getExecutablePath()`
- `getAppVersion()`
- `openExternalUrl(url)`
- `openFilePath(path)`
- `showOpenFileDialog(owner, options)`
- `showSaveFileDialog(owner, options)`

已调整：

- `src/main/index.ts` 不再直接调用 `app.getPath('userData')`、`shell.openExternal/openPath`、`dialog.showOpenDialog/showSaveDialog`。
- `src/main/machineId.ts`、`src/main/kproxy/index.ts`、`src/main/registration/registrar.ts`、`src/main/proxy/logger.ts`、`src/main/proxy/proxyServer.ts` 不再直接调用 `app.getPath('userData')`。

注意：

- `src/main/services/runtime/*` 目前仍是 Electron 适配层。
- 下一步要把 runtime 能力迁到 `src/server/runtime/*`，最终去掉 Electron 依赖。

### 4.4 第四批：机器码管理员权限流程去桌面弹窗化

已完成：

- `src/main/machineId.ts` 不再 import Electron。
- 删除机器码模块中的 `dialog.showMessageBox()`。
- 删除机器码模块中的 `app.quit()` 自动退出/重启行为。
- `requestAdminRestart()` 改为返回管理员启动提示对象。
- `machine-id:set` 遇到 `requiresAdmin` 时返回 `adminRestart` 信息。
- 机器码页面“以管理员重启”改为“显示启动命令”，并支持复制命令。

相关类型已同步：

- `src/preload/api/machine-id.ts`
- `src/preload/index.d.ts`
- `src/renderer/src/types/machineId.ts`
- `src/renderer/src/components/pages/MachineIdPage.tsx`

仍未完成：

- 机器码 API 仍通过 Electron IPC 暴露。
- 后续要迁成 `/api/machine-id/*`。

### 4.5 第五批：本地服务骨架和事件边界

新增：

- `src/server/events.ts`
- `src/server/http/local-admin-server.ts`
- `src/server/index.ts`

服务骨架已具备：

- 默认 `127.0.0.1`。
- 一次性本地访问 token。
- `GET /api/health`。
- `GET /api/events` SSE。
- `POST /api/events/test`。
- loopback 访问限制。
- CORS 仅允许 `127.0.0.1` / `localhost` 来源。

事件总线已具备：

- `publishEvent(type, payload)`
- `subscribeEvents(listener)`
- `getEventHistory(afterId)`
- `clearEventHistory()`

已接入事件总线的事件：

- 代理请求、响应、错误、状态变化。
- 代理账号更新、账号封禁。
- Webhook 触发。
- K-Proxy 请求、响应、错误、状态变化、MITM 拦截。
- 批量刷新进度和结果。
- 批量检查进度和结果。
- Auth/Social Auth 回调。
- 注册日志和单次注册完成事件。

已调整：

- `src/main/index.ts` 新增 `emitAppEvent(channel, payload)`。
- 事件先进入 `src/server/events.ts`，再临时转发给 Electron renderer。
- `src/main/registration/ipc-handlers.ts` 已移除 `BrowserWindow` 依赖，改为接收通用事件发送函数。
- `tsconfig.node.json` 已纳入 `src/server/**/*`。

当时仍未完成：

- 本地服务骨架尚未接入启动脚本。
- 服务不会随 `npm run dev` 独立启动。
- 账号/登录/代理/K-Proxy/注册/机器码等业务尚未迁成 REST controller；这些核心 controller 已在 4.6 至 4.15 后续批次陆续完成。
- `emitAppEvent()` 内部仍保留 `mainWindow?.webContents.send(...)` 作为过渡兼容。

### 4.6 第六批：P0 核心服务层（账号存储 + Token 刷新 + Auth + HTTP API）

已完成全部 P0 优先级的服务层抽取和 HTTP API 暴露。

#### 4.6.1 Runtime 层

新增：

- `src/server/runtime/paths.ts` — 纯 Node.js 数据目录解析（`os.homedir()` + `os.platform()`），跨平台。Windows: `%APPDATA%/kiro-account-manager`，macOS: `~/Library/Application Support/kiro-account-manager`，Linux: `$XDG_CONFIG_HOME/kiro-account-manager`。提供 `getDataDir()` / `setDataDir()` / `resetDataDir()`。
- `src/server/runtime/fetch.ts` — 通用 fetch 封装（基于 undici），通过 `ServerFetchOptions` 注入代理 agent。优先级：`overrideProxyUrl` > `getAgent()` > 直连。

#### 4.6.2 Storage 层

新增：

- `src/server/storage/crypto-store.ts` — AES-256-GCM 加密 JSON 存储，替代 `electron-store`。PBKDF2 密钥派生（100K 迭代，sha512）。文件格式 `{salt, iv, tag, data}` 均为 hex。原子写入（写 .tmp 后 rename）。API 兼容 electron-store：`get` / `set` / `delete` / `has` / `setBatch`。
- `src/server/storage/account-store.ts` — 账号数据持久化层。定义 `AccountData` 接口（~25 字段）。嵌入备份控制器（5 分钟节流）。提供 `migrateFromElectronStore()` 方法：动态 import electron-store → 读全量数据 → 写入 CryptoStore → 创建 `.migrated-from-electron-store` 标记文件。防抖代理统计写入（`debouncedSet` / `flushPendingWrites`）。

#### 4.6.3 Account Service

新增：

- `src/server/services/accounts/token-refresh.ts` — 提取 Token 刷新逻辑。`refreshOidcToken`（AWS OIDC）+ `refreshSocialToken`（Kiro Auth Service）+ `refreshTokenByMethod`（调度器）。定义 `KIRO_AUTH_ENDPOINT` 常量和 `TokenRefreshDeps` 依赖注入接口。
- `src/server/services/accounts/batch-operations.ts` — 批量刷新 `batchRefresh()` 和批量检查 `batchCheck()`。分片并发（`Promise.allSettled` 批次）。通过 `emitEvent` 回调发布进度/结果事件。定义 `BatchOperationDeps`、`BatchRefreshAccount`、`BatchCheckAccount`、`BatchResult`、`AccountCheckResult` 类型。
- `src/server/services/accounts/account-service.ts` — 账号服务门面。组合 AccountStore + TokenRefresh + BatchOperations。提供 `loadAccounts` / `saveAccounts` / `refreshToken` / `checkAccountStatus` / `batchRefresh` / `batchCheck` / `verifyCredentials` / `debouncedSet` / `flushPendingWrites` / `shutdown`。`verifyCredentials` 实现完整流程：刷新 token → 获取用量 → 解析订阅类型 → 解析使用量明细。

#### 4.6.4 Auth Service

新增：

- `src/server/services/auth/auth-service.ts` — 认证服务。封装四种登录流程，全部状态保存在服务实例内存中，无 Electron 依赖：
  - **Builder ID Device Flow**：`startBuilderIdLogin`（注册 OIDC 客户端 + 设备授权）→ `pollBuilderIdAuth` → `cancelBuilderIdLogin`
  - **IAM SSO（Authorization Code + PKCE）**：`startIamSsoLogin`（注册客户端 + PKCE + 本地 HTTP 回调服务器 + 打开浏览器）→ `pollIamSsoAuth` → `cancelIamSsoLogin`
  - **Social Login（Google/GitHub）**：`startSocialLogin`（PKCE + 构建 URL）→ `exchangeSocialToken` → `cancelSocialLogin`
  - **SSO Import（Device Auth）**：`importFromSsoToken`（7 步设备授权流程）

#### 4.6.5 HTTP Router + Controllers

新增：

- `src/server/http/router.ts` — 轻量级 HTTP 路由器。支持路径参数（`:param`）和通配符。内置 JSON body 解析（1MB 上限）。按注册顺序匹配，先到先服务。导出 `Router` 类、`RouteHandler` 类型、`RouteContext` 接口和 `writeJsonResponse` 工具函数。
- `src/server/http/controllers/account-controller.ts` — 账号 REST API 控制器（7 个端点）：
  - `GET /api/accounts` — 加载账号数据
  - `POST /api/accounts` — 保存账号数据（完整覆盖）
  - `POST /api/accounts/check-status` — 检查单个账号状态（必要时自动刷新 token）
  - `POST /api/accounts/refresh` — 刷新单个账号 token
  - `POST /api/accounts/batch-refresh` — 批量刷新
  - `POST /api/accounts/batch-check` — 批量检查状态
  - `POST /api/accounts/verify` — 验证凭证
- `src/server/http/controllers/auth-controller.ts` — 认证 REST API 控制器（10 个端点）：
  - `POST /api/auth/builder-id/start` / `poll` / `cancel`
  - `POST /api/auth/iam-sso/start` / `poll` / `cancel`
  - `POST /api/auth/social/start` / `exchange` / `cancel`
  - `POST /api/auth/sso-import`

#### 4.6.6 服务集成

修改：

- `src/server/http/local-admin-server.ts` — 新增 `routers?: Router[]` 选项。`requestHandler` 改为 async，在内置端点（health/events）之后遍历路由器分发。所有控制器路由需要 Bearer Token 授权。
- `src/server/index.ts` — 新增 Router、Controller、Service、paths 导出。
- `src/main/index.ts` — 新增 6 个 server 层 import。新增 `accountService` / `authService` / `localAdminServer` 模块变量。在 `app.whenReady()` 中初始化：创建 AccountService（注入 `getNetworkAgent` / `safeCreateProxyAgent` / `getAccountProxyUrl` / `checkAccount` / `getUsageAndLimits` / `getUserInfo` 桥接函数）→ 创建 AuthService（注入 `fetchOpts` / `openUrl` / `openInPrivate`）→ 创建路由器 → 启动 HTTP API 服务器（端口 9527）。`will-quit` 中新增三个服务的优雅关闭。

依赖注入设计要点：

- 所有 server 层服务不直接依赖 Electron。
- Electron 相关能力（网络代理 agent、打开 URL、端口查找等）通过构造函数注入。
- 同一 AccountService 实例同时服务 HTTP API 和 Electron IPC 委托。
- 当前账号/Auth Electron IPC 已委托到 server service，其他 IPC 仍保留 inline 实现。

### 4.7 第七批：P0 IPC 委托统一（账号 + Auth）

已完成：

- `src/main/index.ts` 新增 `getAccountService()` / `getAuthService()` 访问器，核心账号/Auth IPC 不再直接散落访问全局服务变量。
- `AccountService` 新增 `initialize()`，主进程启动时等待旧 `electron-store` 迁移完成后再开放账号读取，避免双存储过渡期读到空数据。
- `load-accounts` / `save-accounts` / `refresh-account-token` / `verify-account-credentials` 已委托到 `AccountService`。
- `background-batch-refresh` / `background-batch-check` 已委托到 `AccountService.batchRefresh()` / `batchCheck()`。
- `import-from-sso-token` 已改为 `AuthService.importFromSsoToken()` 取得授权凭证，再通过 `AccountService.verifyCredentials()` 补齐账号详情。
- Builder ID、IAM SSO、Social Login 的 start/poll/cancel/exchange IPC 已委托到 `AuthService`。
- `AuthService.startIamSsoLogin()` 增加可选 `openBrowser` 参数，Electron IPC 场景由 renderer 保持原有打开浏览器行为，HTTP controller 场景仍可由服务层打开浏览器。
- `AuthService.pollIamSsoAuth()` 补齐过期检查和回调 server 清理逻辑，保持旧 IPC 行为。
- 删除 preload 中无主进程 handler、无 renderer 使用方的孤儿 `completeIamSsoLogin` / `complete-iam-sso-login`。
- `batch-operations.ts` 补齐批量刷新/检查事件数据形状，继续向旧 renderer 提供 `usage`、`subscription`、`userInfo`、`status`、`errorMessage` 等字段，避免 UI 退化。

仍保留：

- `switch-account` / `switch-account-cli` / `load-kiro-credentials` / `get-local-active-account` 当时仍是 Kiro 本地集成 inline IPC；已在第十一批迁到 `KiroLocalService`。
- 注册、机器码、Kiro 设置、K-Proxy controller 已在后续批次完成 HTTP 化。

### 4.8 第八批：P0→P1 桥梁（独立 Node 服务入口）

已完成：

- 新增 `src/server/standalone.ts`，可在无 Electron 环境下启动本地管理 HTTP 服务。
- 新增 `vite.server.config.ts`，使用 Vite SSR 构建 standalone 入口到 `out/server/standalone.mjs`。
- `package.json` 新增：
  - `npm run serve:build` — 构建 standalone 服务入口。
  - `npm run serve:smoke` — 构建并启动 standalone，验证 `/api/health` 后自动退出。
  - `npm run serve` — 构建并启动长期运行的本地管理服务。
- standalone 支持环境变量：
  - `KIRO_ADMIN_HOST` — 监听地址，默认 `127.0.0.1`。
  - `KIRO_ADMIN_PORT` — 监听端口，默认 `9527`。
  - `KIRO_ADMIN_TOKEN` — 本地访问 token，不设置则自动生成。
  - `KIRO_ADMIN_DATA_DIR` — 覆盖数据目录。
  - `KIRO_ADMIN_ENCRYPTION_KEY` — 覆盖账号存储加密密钥。
- 新增 `src/server/services/accounts/kiro-account-api.ts`，为 standalone 注入账号用量、用户信息和批量检查能力。用量查询与主进程当前默认一致，走 REST `GetUsageLimits`；`GetUserInfo` 走 CBOR web portal API。
- `AccountServiceDeps` 新增 `migrateFromElectronStore?: boolean`。Electron 主进程保持默认迁移；standalone 显式关闭旧 `electron-store` 迁移，避免纯 Node 启动时加载 Electron 依赖。

仍保留：

- standalone 已挂载账号/Auth/API 反代 HTTP controller 和 SSE 事件，不包含 K-Proxy、注册、机器码、Kiro 设置等 controller。
- `src/main/index.ts` 仍会在 Electron 过渡态内启动同一套账号/Auth/API 反代 HTTP API，直到对应浏览器 UI 和 controller 完成替换。

### 4.9 第九批：P1 API 反代 controller

已完成：

- 新增 `src/server/services/proxy/proxy-service.ts`，把 legacy `ProxyServer` 的启动、停止、状态、配置、统计、日志、API Key、账号池、模型缓存、客户端配置等操作收成可复用服务。
- 新增 `src/server/http/controllers/proxy-controller.ts`，暴露 `/api/proxy/*` REST API。
- 新增 `src/server/storage/config-store.ts`，为 standalone 场景提供纯 Node 加密配置存储（`kiro-config.enc.json`），保存 `proxyConfig`、用量统计、请求统计等配置。
- `src/server/standalone.ts` 挂载 `createProxyRouter()`，standalone 现在可通过同一 `9527` 管理端口访问账号/Auth/API 反代 API。
- `src/main/index.ts` 挂载同一套 proxy router，HTTP controller 复用 Electron 过渡态现有 `proxyServer` 实例，避免 IPC 和 HTTP 各自启动一套反代。
- `src/main/services/runtime/paths.ts` 从顶层 Electron `app` import 改为懒加载 Electron；在 standalone 纯 Node 环境下 fallback 到 `src/server/runtime/paths.ts` 的 data dir，使 legacy proxy core 可被 standalone 复用。
- `src/server/standalone.ts --smoke` 增加 `/api/proxy/status` 授权请求验证，确认 proxy controller 实际挂载。
- `src/server/standalone.ts` 退出流程不再直接 `process.exit()`，改为设置 `process.exitCode`，避免 Windows Node 在连续 `fetch` smoke 后触发 undici/libuv 退出期 assertion。

已暴露的核心端点：

- `GET /api/proxy/status`
- `POST /api/proxy/start`
- `POST /api/proxy/stop`
- `POST /api/proxy/restart`
- `POST /api/proxy/config`
- `POST /api/proxy/reset-credits`
- `POST /api/proxy/reset-tokens`
- `POST /api/proxy/reset-request-stats`
- `GET /api/proxy/logs`
- `DELETE /api/proxy/logs`
- `GET /api/proxy/logs/count`
- `GET/POST /api/proxy/usage-api-type`
- `GET/POST /api/proxy/use-kproxy-for-api`
- `GET /api/proxy/self-signed-cert`
- `POST /api/proxy/self-signed-cert/regenerate`
- `GET /api/proxy/audit-log`
- `GET/POST /api/proxy/api-keys`
- `PUT/DELETE /api/proxy/api-keys/:id`
- `POST /api/proxy/api-keys/:id/reset-usage`
- `GET/POST /api/proxy/accounts`
- `DELETE /api/proxy/accounts/:id`
- `POST /api/proxy/accounts/sync`
- `POST /api/proxy/accounts/reset-pool`
- `POST /api/proxy/accounts/:id/clear-suspended`
- `GET /api/proxy/models`
- `POST /api/proxy/models/refresh`
- `POST /api/proxy/configure-clients`

仍保留：

- Electron IPC 版 proxy handlers 暂时保留，旧 renderer 仍依赖 `window.api`。后续浏览器 UI 接入 `/api/proxy/*` 后，再删除对应 IPC/preload 桥接。
- API 反代 core 仍位于 `src/main/proxy/*`，本批是 HTTP controller 包装和 standalone 复用；后续可再把 core 迁到 `src/server/services/proxy/core/*`。
- K-Proxy MITM 是另一套系统，仍未 HTTP 化，不要和 API 反代 controller 混在一起。

### 4.10 第十批：P1 单账号检查 service 化

已完成：

- 新增 `src/server/services/accounts/account-status.ts`，承接旧 `check-account-status` IPC 的完整业务逻辑：当前 accessToken 检查、401 自动刷新、账号绑定代理透传、封禁识别、用户信息兜底、用量/订阅/奖励额度解析和 `newCredentials` 返回。
- `AccountService` 新增 `checkAccountStatus()` 门面方法，同一实现同时服务 Electron IPC 和 HTTP API。
- `src/server/http/controllers/account-controller.ts` 新增 `POST /api/accounts/check-status`，请求体沿用旧 IPC 的 account 对象，便于后续浏览器 UI 直接切换到 HTTP。
- `src/main/index.ts` 的 `check-account-status` IPC 已删除 inline 解析逻辑，改为委托 `getAccountService().checkAccountStatus(account)`，保持旧 renderer 调用名和返回结构不变。

仍保留：

- 旧 renderer 仍通过 `window.api.accounts.checkAccountStatus()` 触发 IPC；浏览器 UI 接入 `/api/accounts/check-status` 后，再删除对应 preload/IPC 桥接。
- 注册、机器码、K-Proxy、Kiro 设置等业务 IPC 仍处于 inline 或 legacy controller 过渡状态。

### 4.11 第十一批：P1 Kiro 本地集成 service/controller 化

已完成：

- 新增 `src/server/services/kiro-local/kiro-local-service.ts`，抽出本地 Kiro IDE/CLI 凭证读写能力：读取当前本地账号、从 Kiro cache 导入凭证、切换 Kiro IDE 账号、切换 Kiro CLI 账号、清理本地 SSO cache。
- 新增 `src/server/http/controllers/kiro-local-controller.ts`，暴露 `/api/kiro-local/*` REST API。
- `src/main/index.ts` 初始化 `KiroLocalService`，Electron 过渡态 HTTP server 挂载同一套 `kiro-local` router。
- `get-local-active-account` / `load-kiro-credentials` / `switch-account` / `switch-account-cli` / `logout-account` IPC 已委托到 `KiroLocalService`，保留旧 renderer 调用名和返回结构。
- `src/server/standalone.ts --smoke` 增加 `/api/kiro-local/active-account` 授权请求验证；该检查先以 404 红灯失败，再在 controller 挂载后通过。

已暴露的核心端点：

- `GET /api/kiro-local/active-account`
- `GET /api/kiro-local/credentials`
- `POST /api/kiro-local/switch-account`
- `POST /api/kiro-local/switch-account-cli`
- `POST /api/kiro-local/logout`

仍保留：

- 旧 renderer 仍通过 `window.api.accounts.*` 触发 IPC；浏览器 UI 接入 `/api/kiro-local/*` 后，再删除对应 preload/IPC 桥接。
- 机器码、K-Proxy、Kiro 设置等业务 IPC 仍处于 inline 或 legacy controller 过渡状态。

### 4.12 第十二批：P1 注册 service/controller 化

已完成：

- 新增 `src/server/services/registration/registration-service.ts`，把注册任务池、手动注册状态、取消逻辑和 `registration-log` / `registration-complete` 事件发布抽成 service。
- 新增 `src/server/http/controllers/registration-controller.ts`，暴露 `/api/registration/*` REST API。
- `src/main/registration/ipc-handlers.ts` 改为薄委托，旧 renderer 的 `registration-start-auto` / `registration-manual-phase1/2/3` / `registration-cancel` / `registration-status` IPC 保持兼容。
- `src/main/index.ts` 和 `src/server/standalone.ts` 均初始化 `RegistrationService` 并挂载同一套 registration router；退出时会调用 `RegistrationService.shutdown()` 取消仍在进行的注册任务。
- `src/server/standalone.ts --smoke` 增加 `/api/registration/status` 授权请求验证；该检查先以 404 红灯失败，再在 controller 挂载后通过。

已暴露的核心端点：

- `POST /api/registration/auto`
- `POST /api/registration/manual/phase1`
- `POST /api/registration/manual/phase2`
- `POST /api/registration/manual/phase3`
- `POST /api/registration/cancel`
- `GET /api/registration/status`

仍保留：

- 旧 renderer 仍通过 `window.api.registration*` 触发 IPC；浏览器 UI 接入 `/api/registration/*` 后，再删除对应 preload/IPC 桥接。
- K-Proxy、Kiro 设置等业务 IPC 仍处于 inline 或 legacy controller 过渡状态。

### 4.13 第十三批：P1 机器码 service/controller 化

已完成：

- 新增 `src/server/services/machine-id/machine-id-service.ts`，封装 `src/main/machineId.ts` 的系统机器码读写、随机生成、管理员检查、管理员启动提示、备份和恢复能力。
- 新增 `src/server/http/controllers/machine-id-controller.ts`，暴露 `/api/machine-id/*` REST API。
- `src/main/index.ts` 初始化 `MachineIdService` 并挂载同一套 machine-id router；旧 `machine-id:*` IPC 已委托到 `MachineIdService`。
- HTTP backup/restore 使用显式 `filePath`，旧 IPC 继续负责打开文件选择/保存对话框后调用 service。
- `src/server/standalone.ts --smoke` 增加 `/api/machine-id/os` 授权请求验证；该检查先以 404 红灯失败，再在 controller 挂载后通过。

已暴露的核心端点：

- `GET /api/machine-id/os`
- `GET /api/machine-id/current`
- `POST /api/machine-id/set`
- `GET /api/machine-id/random`
- `GET /api/machine-id/admin`
- `GET /api/machine-id/admin-restart`
- `POST /api/machine-id/backup`
- `POST /api/machine-id/restore`

仍保留：

- 旧 renderer 仍通过 `window.api.machineId*` 触发 IPC；浏览器 UI 接入 `/api/machine-id/*` 后，再删除对应 preload/IPC 桥接。
- Kiro 设置、K-Proxy 等业务 IPC 仍处于 inline 或 legacy controller 过渡状态。

### 4.14 第十四批：P1 Kiro 设置 service/controller 化

已完成：

- 新增 `src/server/services/kiro-settings/kiro-settings-service.ts`，封装 Kiro settings、MCP config、Steering 文件读写、默认 `rules.md` 创建、本地路径打开和可用模型查询能力。
- 新增 `src/server/http/controllers/kiro-settings-controller.ts`，暴露 `/api/kiro-settings/*` REST API。
- `src/main/services/kiro/settings-files.ts` 导出 `getKiroPaths()`，让 Electron 过渡态和 standalone service 复用同一套 Kiro 路径计算。
- `src/main/index.ts` 初始化 `KiroSettingsService` 并挂载同一套 kiro-settings router；旧 Kiro 设置、MCP、Steering IPC 已委托到 `KiroSettingsService`。
- `src/server/standalone.ts --smoke` 增加 `/api/kiro-settings` 授权请求验证；该检查先以 404 红灯失败，再在 controller 挂载后通过。

已暴露的核心端点：

- `GET /api/kiro-settings`
- `POST /api/kiro-settings`
- `GET /api/kiro-settings/models`
- `POST /api/kiro-settings/open/mcp-config`
- `POST /api/kiro-settings/open/steering-folder`
- `POST /api/kiro-settings/open/settings-file`
- `POST /api/kiro-settings/open/steering-file`
- `POST /api/kiro-settings/default-rules`
- `GET /api/kiro-settings/steering/:filename`
- `POST /api/kiro-settings/steering/:filename`
- `DELETE /api/kiro-settings/steering/:filename`
- `POST /api/kiro-settings/mcp`
- `DELETE /api/kiro-settings/mcp/:name`

仍保留：

- 旧 renderer 仍通过 `window.api.kiro*` / `window.api.mcp*` 相关 IPC 触发 Kiro 设置、MCP、Steering 操作；浏览器 UI 接入 `/api/kiro-settings/*` 后，再删除对应 preload/IPC 桥接。
- K-Proxy 业务 IPC 仍处于 inline / legacy 过渡状态。

### 4.15 第十五批：P1 K-Proxy service/controller 化

已完成：

- 新增 `src/server/services/kproxy/kproxy-service.ts`，把 K-Proxy MITM 初始化、启停、状态、配置、设备 ID、账号映射、CA 证书导出/安装/卸载和统计重置收成可复用管理 service。
- 新增 `src/server/http/controllers/kproxy-controller.ts`，暴露 `/api/kproxy/*` REST API。
- `src/main/index.ts` 初始化 `KProxyManagementService` 并挂载同一套 kproxy router；旧 `kproxy-*` IPC 已委托到 `KProxyManagementService`，保留 renderer 调用名和返回结构。
- K-Proxy 自启动逻辑已改为调用 `KProxyManagementService.autoStart()`，事件继续通过 `emitAppEvent()` 进入 SSE + Electron 临时兼容桥。
- standalone 入口已挂载 `/api/kproxy/*`，并在退出时关闭 K-Proxy MITM 服务。
- `src/server/standalone.ts --smoke` 增加 `/api/kproxy/status` 授权请求验证；该检查先以 404 红灯失败，再在 controller 挂载后通过。

已暴露的核心端点：

- `GET /api/kproxy/status`
- `POST /api/kproxy/init`
- `POST /api/kproxy/start`
- `POST /api/kproxy/stop`
- `POST /api/kproxy/config`
- `POST /api/kproxy/device-id`
- `GET /api/kproxy/device-id/random`
- `GET /api/kproxy/device-mappings`
- `POST /api/kproxy/device-mappings`
- `POST /api/kproxy/device-mappings/switch`
- `GET /api/kproxy/ca-cert`
- `POST /api/kproxy/ca-cert/export`
- `GET /api/kproxy/ca-cert/installed`
- `POST /api/kproxy/ca-cert/install`
- `POST /api/kproxy/ca-cert/uninstall`
- `POST /api/kproxy/stats/reset`

仍保留：

- 旧 renderer 仍通过 `window.api.kproxy*` 触发 IPC；浏览器 UI 接入 `/api/kproxy/*` 后，再删除对应 preload/IPC 桥接。
- `src/main/kproxy/*` 仍是 MITM 核心实现，server service 只是管理包装，不和 OpenAI/Claude API 反代 `/api/proxy/*` 混合。

### 4.16 第十六批：P2 诊断 service/controller 化

已完成：

- 新增 `src/server/services/diagnostics/diagnostics-service.ts`，抽出一键诊断、通用 HTTP 探测和代理池验活逻辑。
- 新增 `src/server/http/controllers/diagnostics-controller.ts`，暴露 `/api/diagnostics/*` REST API。
- `src/main/index.ts` 初始化 `DiagnosticsService` 并挂载同一套 diagnostics router；旧 `diagnose:run`、`diagnose:http-probe`、`proxy-pool:validate` IPC 已委托到 `DiagnosticsService`。
- standalone 入口已挂载 `/api/diagnostics/*`，纯 Node 模式默认直连，代理池验活仍支持传入 http/https 代理。
- `src/server/standalone.ts --smoke` 增加 `/api/diagnostics/http-probe` 授权请求验证；该检查先以 404 红灯失败，再在 controller 挂载后通过。

已暴露的核心端点：

- `POST /api/diagnostics/run`
- `POST /api/diagnostics/http-probe`
- `POST /api/diagnostics/proxy-pool/validate`

仍保留：

- 旧 renderer 仍通过 `window.api.diagnoseRun()`、`window.api.diagnoseHttpProbe()`、`window.api.proxyPoolValidate()` 触发 IPC；浏览器 UI 接入 `/api/diagnostics/*` 后，再删除对应 preload/IPC 桥接。
- `account-set-proxy-binding` 仍留在代理/账号绑定过渡逻辑中，不并入 DiagnosticsService，避免职责混淆。

### 4.17 第十七批：P2 订阅 service/controller 化

已完成：

- 新增 `src/server/services/subscriptions/subscription-service.ts`，抽出可用订阅列表、订阅管理/支付链接、超额开关和订阅链接打开逻辑。
- 新增 `src/server/http/controllers/subscription-controller.ts`，暴露 `/api/subscriptions/*` REST API。
- `src/main/index.ts` 初始化 `SubscriptionService` 并挂载同一套 subscriptions router；旧 `account-get-subscriptions`、`account-get-subscription-url`、`account-set-overage`、`open-subscription-window` IPC 已委托到 `SubscriptionService`。
- standalone 入口已挂载 `/api/subscriptions/*`；纯 Node 模式打开订阅链接使用系统默认浏览器，Electron 过渡态继续使用无痕浏览器打开。
- `src/server/standalone.ts --smoke` 增加 `/api/subscriptions/health` 授权请求验证；该检查先以 404 红灯失败，再在 controller 挂载后通过。订阅计划/URL/超额接口会访问外部 Kiro 服务，不纳入 smoke。

已暴露的核心端点：

- `GET /api/subscriptions/health`
- `POST /api/subscriptions/plans`
- `POST /api/subscriptions/url`
- `POST /api/subscriptions/overage`
- `POST /api/subscriptions/open`

仍保留：

- 旧 renderer 仍通过 `window.api.accountGetSubscriptions()`、`window.api.accountGetSubscriptionUrl()`、`window.api.accountSetOverage()`、`window.api.openSubscriptionWindow()` 触发 IPC；浏览器 UI 接入 `/api/subscriptions/*` 后，再删除对应 preload/IPC 桥接。
- 订阅计划、订阅 URL 和超额开关是 live Kiro API 调用；常规本地验证只做类型、lint 和无副作用 health smoke。

## 5. 当前未完成工作

P0/P1/P2 已完成项（详见 4.6、4.7、4.8、4.9、4.10、4.11、4.12、4.13、4.14、4.15、4.16、4.17 节）：

- ~~账号读取、保存、备份、迁移尚未抽成 server storage/account service。~~ → 已完成：AccountStore + CryptoStore (AES-256-GCM) + AccountService。
- ~~Token 刷新、批量刷新、批量检查尚未抽成 account service。~~ → 已完成：token-refresh.ts + batch-operations.ts + AccountService 门面。
- ~~Builder ID、IAM SSO、社交登录状态尚未抽成 auth service。~~ → 已完成：AuthService 封装四种登录流程（Builder ID / IAM SSO / Social / SSO Import）。
- ~~`electron-store` 尚未替换。~~ → 已完成：CryptoStore 替代，含 `migrateFromElectronStore()` 迁移方法。
- ~~账号/Auth 关键 IPC 尚未委托到 server service。~~ → 已完成：账号读取/保存/刷新/验证、批量刷新/检查、SSO Import、Builder ID、IAM SSO、Social Login 已委托。
- 账号/认证 HTTP API 已就绪（17 个 REST 端点），HTTP 服务器监听端口 9527。
- 独立 Node 服务入口已就绪：`npm run serve` 可构建并启动 `out/server/standalone.mjs`。
- API 反代 HTTP API 已就绪：`/api/proxy/*` 可管理启动/停止、配置、统计、日志、API Key、账号池、模型和客户端配置。
- 单账号 `check-account-status` 已 service 化，并暴露 `/api/accounts/check-status`。
- Kiro 本地集成已 service/controller 化，并暴露 `/api/kiro-local/*`。
- 注册已 service/controller 化，并暴露 `/api/registration/*`。
- 机器码管理已 service/controller 化，并暴露 `/api/machine-id/*`。
- Kiro 设置、MCP、Steering 文件管理已 service/controller 化，并暴露 `/api/kiro-settings/*`。
- K-Proxy MITM 管理已 service/controller 化，并暴露 `/api/kproxy/*`。
- 诊断和代理池验活已 service/controller 化，并暴露 `/api/diagnostics/*`。
- 订阅管理已 service/controller 化，并暴露 `/api/subscriptions/*`。

P0 仍未完成：

- 刷新/检查/注册/代理等事件尚未由 SSE 完整替代 renderer IPC。
- `src/main/index.ts` 仍直接依赖 `app`、`BrowserWindow`、`ipcMain`。
- `src/preload/**` 仍保留核心业务桥接。

P1 未完成：

- Webhook、配置同步尚未 HTTP 化。

P2 未完成：

- 删除 `electron-builder.yml`。
- 删除 `build/**` 桌面打包文件。
- 调整 `.github/workflows/build.yml`。
- 删除 Electron 运行时依赖。
- 调整 `package.json` 脚本。
- 浏览器 UI 迁移。

## 6. 下一步推荐顺序

P0 服务层核心、账号/Auth IPC 委托、独立 Node 服务入口、API 反代 controller、单账号检查 service 化、Kiro 本地集成 controller、注册 controller、机器码 controller、Kiro 设置 controller、K-Proxy controller、诊断 controller 和订阅 controller 已完成（4.6、4.7、4.8、4.9、4.10、4.11、4.12、4.13、4.14、4.15、4.16、4.17 节），下一步继续推进剩余 P2 周边 API 和浏览器 UI 接入。

推荐顺序：

1. **Webhook / 配置同步 controller**（P2）：补齐剩余周边管理 API。
2. **浏览器 UI 接入 HTTP/SSE**：优先接入 `/api/accounts/check-status`、`/api/kiro-local/*`、`/api/registration/*`、`/api/machine-id/*`、`/api/kiro-settings/*`、`/api/kproxy/*`、`/api/diagnostics/*`、`/api/subscriptions/*`。

每完成一个 controller，先让旧 IPC 委托到 service 保持 renderer 兼容；浏览器 UI 接入 HTTP 后，再删除对应 IPC handler 和 preload 桥接方法。

下一步不要做：

- 不要直接删除 `src/preload/**`。
- 不要直接删除 `src/renderer/**`。
- 不要直接删除 `src/main/index.ts`。
- 不要删除 `electron` 依赖。
- 不要删除 `electron-builder.yml` 和 `build/**`，除非 proxy/K-Proxy/注册/机器码等核心 controller 已能替代 Electron 过渡态。
- 不要运行 live integration probes，除非明确知道会访问外部 Kiro 服务。

## 7. 未来目标架构

目标目录形态：

```text
src/
  server/
    index.ts                     # ✅ 已就位
    standalone.ts                # ✅ 已就位（独立 Node 服务入口）
    http/
      router.ts                  # ✅ 已就位
      controllers/
        account-controller.ts    # ✅ 已就位
        auth-controller.ts       # ✅ 已就位
        proxy-controller.ts      # ✅ 已就位
        kiro-local-controller.ts # ✅ 已就位
        registration-controller.ts # ✅ 已就位
        machine-id-controller.ts # ✅ 已就位
        kiro-settings-controller.ts # ✅ 已就位
        kproxy-controller.ts     # ✅ 已就位
        diagnostics-controller.ts # ✅ 已就位
        subscription-controller.ts # ✅ 已就位
      local-admin-server.ts      # ✅ 已就位（含路由器集成）
    runtime/
      paths.ts                   # ✅ 已就位
      fetch.ts                   # ✅ 已就位
      # open-url.ts              # 待实现
      # platform.ts              # 待实现
    storage/
      crypto-store.ts            # ✅ 已就位
      account-store.ts           # ✅ 已就位
      config-store.ts            # ✅ 已就位
    services/
      accounts/
        account-service.ts       # ✅ 已就位
        token-refresh.ts         # ✅ 已就位
        batch-operations.ts      # ✅ 已就位
        kiro-account-api.ts      # ✅ 已就位（standalone 账号状态/用量 API client）
      auth/
        auth-service.ts          # ✅ 已就位
      kiro-local/
        kiro-local-service.ts    # ✅ 已就位
      registration/
        registration-service.ts  # ✅ 已就位
      machine-id/
        machine-id-service.ts    # ✅ 已就位
      kiro-settings/
        kiro-settings-service.ts # ✅ 已就位
      proxy/
        proxy-service.ts         # ✅ 已就位（HTTP controller 包装 legacy proxy core）
      kproxy/
        kproxy-service.ts        # ✅ 已就位（HTTP controller 包装 legacy MITM core）
      diagnostics/
        diagnostics-service.ts   # ✅ 已就位
      subscriptions/
        subscription-service.ts  # ✅ 已就位
      # webhooks/                # 待实现 (P2)
    events.ts                    # ✅ 已就位
  web/
    # 未来浏览器 UI，当前暂不实现
  shared/
    # 前后端共享类型
```

HTTP API 目标（✅ = 已实现）：

- `/api/health` ✅
- `/api/events` ✅
- `/api/accounts/*` ✅（7 个端点）
- `/api/auth/*` ✅（10 个端点）
- `/api/proxy/*` ✅
- `/api/kiro-local/*` ✅（5 个端点）
- `/api/registration/*` ✅（6 个端点）
- `/api/machine-id/*` ✅（8 个端点）
- `/api/kiro-settings/*` ✅（13 个端点）
- `/api/kproxy/*` ✅（16 个端点）
- `/api/diagnostics/*` ✅（3 个端点）
- `/api/subscriptions/*` ✅（5 个端点）
- `/api/webhooks/*`
- `/api/config-sync/*`

事件目标：

- `refresh-progress`
- `refresh-result`
- `check-progress`
- `check-result`
- `proxy-log`
- `proxy-status`
- `kproxy-log`
- `registration-log`
- `registration-complete`
- `auth-callback`

## 8. 验证要求

常规验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npm run lint
```

第六批（P0 服务层）新增需要验证的文件：

```powershell
# typecheck 覆盖（tsconfig.node.json 已含 src/server/**/*）
npm run typecheck:node

# lint 新增目标
npx eslint src/server/runtime/paths.ts src/server/runtime/fetch.ts src/server/storage/crypto-store.ts src/server/storage/account-store.ts src/server/services/accounts/token-refresh.ts src/server/services/accounts/batch-operations.ts src/server/services/accounts/account-service.ts src/server/services/auth/auth-service.ts src/server/http/router.ts src/server/http/controllers/account-controller.ts src/server/http/controllers/auth-controller.ts --quiet
```

之前批次已验证过的命令：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/events.ts src/server/http/local-admin-server.ts src/server/index.ts src/main/index.ts src/main/registration/ipc-handlers.ts --quiet
rg --line-number "webContents\.send" src\main src\server
rg --line-number "BrowserWindow" src\main\registration\ipc-handlers.ts src\server
```

之前批次验证结果：

- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 上述目标 lint 通过。
- `webContents.send` 只剩 `src/main/index.ts` 的 `emitAppEvent()` 兼容桥内部一处。
- `src/main/registration/ipc-handlers.ts` 和 `src/server` 中没有 `BrowserWindow`。

第六批验证注意：

- `src/server/**/*` 下所有新文件应通过 typecheck:node。
- `src/main/index.ts` 新增的 import 和服务初始化代码应通过 typecheck:node。
- 新增文件不含 `webContents.send` 和 `BrowserWindow`。

第七批（IPC 委托统一）已验证：

- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 目标 lint 通过：

```powershell
npx eslint src/main/index.ts src/preload/api/auth.ts src/server/http/controllers/account-controller.ts src/server/http/controllers/auth-controller.ts src/server/services/accounts/account-service.ts src/server/services/accounts/batch-operations.ts src/server/services/auth/auth-service.ts --quiet
```

- `rg --line-number "complete-iam-sso-login|completeIamSsoLogin|ssoDeviceAuth|currentLoginState|iamSsoServer|iamSsoResult" src\main\index.ts src\preload src\renderer\src` 无结果。
- `git diff --check` 无 whitespace 错误，仅提示 Windows 换行转换。
- `npm run lint` / `npx eslint . --quiet` 全量仍失败，原因是仓库既有 proxy/renderer lint 债务（缺少显式返回类型、require-style import、既有 prettier CRLF 警告等），不是第七批目标文件新增错误。

第八批（独立 Node 服务入口）已验证：

- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 目标 lint 通过：

```powershell
npx eslint src/server/standalone.ts src/server/services/accounts/kiro-account-api.ts src/server/services/accounts/account-service.ts vite.server.config.ts --quiet
```

- `npm run serve:smoke` 通过：Vite 构建 `out/server/standalone.mjs`，启动 `http://127.0.0.1:9527`，请求 `/api/health` 成功后自动退出。
- `npm run build` 通过：Electron main/preload/renderer 过渡态构建链路未被 standalone 改动影响。
- `npm run serve:smoke` 过程中只剩 npm 的 `store-dir` 配置警告；standalone 已关闭旧 `electron-store` 迁移，不再触发 Electron 依赖加载错误。
- `npx eslint . --quiet` 全量仍失败（269 errors），仍集中在既有 `src/main/proxy/*`、`src/main/kproxy/*`、`src/main/registration/*` 和 renderer 组件旧债；本批新增/修改目标文件未出现在错误列表中。

第九批（API 反代 controller）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/main/services/runtime/paths.ts src/main/index.ts src/server/standalone.ts src/server/index.ts src/server/http/controllers/proxy-controller.ts src/server/services/proxy/proxy-service.ts src/server/storage/config-store.ts --quiet
npm run serve:smoke
npm run build
```

第九批当前已验证：

- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 第九批目标 lint 通过。
- `npm run serve:smoke` 通过，且已验证 `/api/proxy/status` 授权请求。
- `npm run build` 通过。
- `git diff --check` 无 whitespace 错误，仅提示 Windows 换行转换。
- `npx eslint . --quiet` 全量仍失败（269 errors），仍集中在既有 `src/main/proxy/*`、`src/main/kproxy/*`、`src/main/registration/*` 和 renderer 组件旧债；本批新增/修改目标文件未出现在错误列表中。

第十批（单账号检查 service 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/accounts/account-status.ts src/server/services/accounts/account-service.ts src/server/http/controllers/account-controller.ts src/main/index.ts src/server/index.ts --quiet
npm run serve:smoke
npm run build
```

第十批当前已验证：

- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 第十批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health` 和 `/api/proxy/status` 授权检查。
- `npm run build` 通过。
- `git diff --check` 无 whitespace 错误，仅提示 Windows 换行转换。
- `npx eslint . --quiet` 全量仍失败（269 errors），仍集中在既有 `src/main/proxy/*`、`src/main/kproxy/*`、`src/main/registration/*` 和 renderer 组件旧债；第十批新增/修改目标文件未出现在错误列表中。

第十一批（Kiro 本地集成 service/controller 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/kiro-local/kiro-local-service.ts src/server/http/controllers/kiro-local-controller.ts src/server/standalone.ts src/server/index.ts src/main/index.ts --quiet
npm run serve:smoke
npm run build
```

第十一批当前已验证：

- 先修改 `src/server/standalone.ts --smoke` 检查 `/api/kiro-local/active-account`，在 controller 挂载前 `npm run serve:smoke` 按预期失败：`HTTP 404`。
- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 第十一批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health`、`/api/proxy/status`、`/api/kiro-local/active-account` 授权检查。
- `npm run build` 通过。
- `git diff --check` 无 whitespace 错误，仅提示 Windows 换行转换。
- `npx eslint . --quiet` 全量仍失败（269 errors），仍集中在既有 `src/main/proxy/*`、`src/main/kproxy/*`、`src/main/registration/*` 和 renderer 组件旧债；第十一批新增/修改目标文件未出现在错误列表中。

第十二批（注册 service/controller 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/registration/registration-service.ts src/server/http/controllers/registration-controller.ts src/main/registration/ipc-handlers.ts src/server/standalone.ts src/server/index.ts src/main/index.ts --quiet
npm run serve:smoke
npm run build
```

第十二批当前已验证：

- 先修改 `src/server/standalone.ts --smoke` 检查 `/api/registration/status`，在 controller 挂载前 `npm run serve:smoke` 按预期失败：`HTTP 404`。
- `npm run typecheck:node` 通过。
- 第十二批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health`、`/api/proxy/status`、`/api/kiro-local/active-account`、`/api/registration/status` 授权检查。

第十三批（机器码 service/controller 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/machine-id/machine-id-service.ts src/server/http/controllers/machine-id-controller.ts src/server/standalone.ts src/server/index.ts src/main/index.ts --quiet
npm run serve:smoke
npm run build
```

第十三批当前已验证：

- 先修改 `src/server/standalone.ts --smoke` 检查 `/api/machine-id/os`，在 controller 挂载前 `npm run serve:smoke` 按预期失败：`HTTP 404`。
- `npm run typecheck:node` 通过。
- 第十三批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health`、`/api/proxy/status`、`/api/kiro-local/active-account`、`/api/registration/status`、`/api/machine-id/os` 授权检查。

第十四批（Kiro 设置 service/controller 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/kiro-settings/kiro-settings-service.ts src/server/http/controllers/kiro-settings-controller.ts src/main/services/kiro/settings-files.ts src/server/standalone.ts src/server/index.ts src/main/index.ts --quiet
npm run serve:smoke
npm run build
```

第十四批当前已验证：

- 先修改 `src/server/standalone.ts --smoke` 检查 `/api/kiro-settings`，在 controller 挂载前 `npm run serve:smoke` 按预期失败：`HTTP 404`。
- `npm run typecheck:node` 通过。
- 第十四批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health`、`/api/proxy/status`、`/api/kiro-local/active-account`、`/api/registration/status`、`/api/machine-id/os`、`/api/kiro-settings` 授权检查。

第十五批（K-Proxy service/controller 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/kproxy/kproxy-service.ts src/server/http/controllers/kproxy-controller.ts src/server/standalone.ts src/server/index.ts src/main/index.ts --quiet
npm run serve:smoke
npm run build
```

第十五批当前已验证：

- 先修改 `src/server/standalone.ts --smoke` 检查 `/api/kproxy/status`，在 controller 挂载前 `npm run serve:smoke` 按预期失败：`HTTP 404`。
- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 第十五批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health`、`/api/proxy/status`、`/api/kiro-local/active-account`、`/api/registration/status`、`/api/machine-id/os`、`/api/kiro-settings`、`/api/kproxy/status` 授权检查。
- `npm run build` 通过。
- `git diff --check` 无 whitespace 错误，仅提示 Windows 换行转换。
- `npx eslint . --quiet` 全量仍失败（269 errors），仍集中在既有 `src/main/proxy/*`、`src/main/kproxy/mitmProxy.ts`、`src/main/registration/registrar.ts` 和 renderer 组件旧债；第十五批新增/修改目标文件未出现在错误列表中。

第十六批（诊断 service/controller 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/diagnostics/diagnostics-service.ts src/server/http/controllers/diagnostics-controller.ts src/server/standalone.ts src/server/index.ts src/main/index.ts --quiet
npm run serve:smoke
npm run build
```

第十六批当前已验证：

- 先修改 `src/server/standalone.ts --smoke` 检查 `/api/diagnostics/http-probe`，在 controller 挂载前 `npm run serve:smoke` 按预期失败：`HTTP 404`。
- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 第十六批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health`、`/api/proxy/status`、`/api/kiro-local/active-account`、`/api/registration/status`、`/api/machine-id/os`、`/api/kiro-settings`、`/api/kproxy/status`、`/api/diagnostics/http-probe` 授权检查。
- `npm run build` 通过。
- `git diff --check` 无 whitespace 错误，仅提示 Windows 换行转换。

第十七批（订阅 service/controller 化）需要验证：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/services/subscriptions/subscription-service.ts src/server/http/controllers/subscription-controller.ts src/server/standalone.ts src/server/index.ts src/main/index.ts --quiet
npm run serve:smoke
npm run build
```

第十七批当前已验证：

- 先修改 `src/server/standalone.ts --smoke` 检查 `/api/subscriptions/health`，在 controller 挂载前 `npm run serve:smoke` 按预期失败：`HTTP 404`。
- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 第十七批目标 lint 通过。
- `npm run serve:smoke` 通过，standalone 构建并启动后完成 `/api/health`、`/api/proxy/status`、`/api/kiro-local/active-account`、`/api/registration/status`、`/api/machine-id/os`、`/api/kiro-settings`、`/api/kproxy/status`、`/api/diagnostics/http-probe`、`/api/subscriptions/health` 授权检查。
- `npm run build` 通过。
- `git diff --check` 无 whitespace 错误，仅提示 Windows 换行转换。

不要声称通过：

- 未运行的 E2E。
- 需要真实账号的测试。
- 需要外部 Kiro 接口的 live probe。
- 社交登录自动回调。
- 完整浏览器 UI。

## 9. 当前仓库状态提示

接手后第一件事先跑：

```powershell
git status --short
git diff --stat
```

当前这一批工作预期包含：

**第十批（单账号检查 service 化，新增/修改）：**

- 新增 `src/server/services/accounts/account-status.ts` — 抽出单账号状态检查，保留 token 自动刷新、封禁识别、用量/订阅解析和 `newCredentials` 返回结构。
- 修改 `src/server/services/accounts/account-service.ts` — 新增 `checkAccountStatus()` 门面。
- 修改 `src/server/http/controllers/account-controller.ts` — 新增 `POST /api/accounts/check-status`。
- 修改 `src/main/index.ts` — `check-account-status` IPC 委托到 `AccountService`，删除旧 inline 逻辑。
- 修改 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md`、`README.md`、`AGENTS.md` — 同步第十批完成状态和下一步。

**第九批（API 反代 controller，新增/修改）：**

- 新增 `src/server/services/proxy/proxy-service.ts` — 管理 legacy `ProxyServer` 启停、配置、统计、日志、API Key、账号池和模型。
- 新增 `src/server/http/controllers/proxy-controller.ts` — 暴露 `/api/proxy/*` REST API。
- 新增 `src/server/storage/config-store.ts` — standalone 配置加密存储。
- 修改 `src/server/standalone.ts` — 挂载 proxy router，standalone smoke 增加 `/api/proxy/status` 检查，退出改为 `process.exitCode`。
- 修改 `src/main/index.ts` — HTTP proxy controller 复用 Electron 过渡态现有 `proxyServer` 实例。
- 修改 `src/main/services/runtime/paths.ts` — Electron `app` 懒加载，standalone fallback 到 server data dir。
- 修改 `src/server/index.ts` — 导出 proxy controller/service/config store。
- 修改 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md`、`README.md`、`AGENTS.md` — 同步第九批完成状态和下一步。

**第八批（独立 Node 服务入口，新增）：**

- 新增 `src/server/standalone.ts` — 无 Electron 环境下启动本地管理 HTTP 服务。
- 新增 `src/server/services/accounts/kiro-account-api.ts` — standalone 注入账号用量、用户信息、账号检查能力。
- 新增 `vite.server.config.ts` — standalone SSR 构建配置，输出 `out/server/standalone.mjs`。
- 修改 `package.json` — 新增 `serve:build`、`serve:smoke`、`serve`。
- 修改 `src/server/services/accounts/account-service.ts` — 新增 `migrateFromElectronStore` 开关，standalone 关闭旧 Electron 存储迁移。
- 修改 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md`、`README.md`、`AGENTS.md` — 同步命令、阶段和交接说明。

**第七批（P0 IPC 委托统一，修改）：**

- 修改 `src/main/index.ts` — 账号/Auth IPC 委托到 `AccountService` / `AuthService`，删除旧 SSO Device Auth inline 函数，删除 Builder ID/IAM SSO/Social Auth inline 状态机。
- 修改 `src/server/services/accounts/account-service.ts` — 新增 `initialize()`，补齐 `verifyCredentials()` 的详细订阅/用量返回字段。
- 修改 `src/server/services/accounts/batch-operations.ts` — 批量刷新/检查事件输出旧 renderer 需要的 `usage`、`subscription`、`userInfo`、`status`、`errorMessage`。
- 修改 `src/server/services/auth/auth-service.ts` — IAM SSO 支持可选打开浏览器、过期检查和完成后清理回调服务器。
- 修改 `src/preload/api/auth.ts` — 删除孤儿 `completeIamSsoLogin`。
- 修改 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md` — 同步 P0 完成状态、下一步推荐顺序和验证记录。

**第六批（P0 服务层，新增）：**

- 新增 `src/server/runtime/paths.ts` — 纯 Node.js 数据目录。
- 新增 `src/server/runtime/fetch.ts` — 通用 fetch 封装。
- 新增 `src/server/storage/crypto-store.ts` — AES-256-GCM 加密存储。
- 新增 `src/server/storage/account-store.ts` — 账号持久化层。
- 新增 `src/server/services/accounts/token-refresh.ts` — Token 刷新。
- 新增 `src/server/services/accounts/batch-operations.ts` — 批量操作。
- 新增 `src/server/services/accounts/account-service.ts` — 账号服务门面。
- 新增 `src/server/services/auth/auth-service.ts` — 认证服务。
- 新增 `src/server/http/router.ts` — HTTP 路由器。
- 新增 `src/server/http/controllers/account-controller.ts` — 账号 REST API。
- 新增 `src/server/http/controllers/auth-controller.ts` — 认证 REST API。
- 修改 `src/server/http/local-admin-server.ts` — 集成路由器。
- 修改 `src/server/index.ts` — 新增导出。
- 修改 `src/main/index.ts` — 导入 server 层、初始化服务、启动 HTTP API、关闭服务。
- 修改 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md` — 本文档。

**第一至五批（已有）：**

- 重写中文 `README.md`，删除旧 `README_CN.md`。
- 删除 `docs/` 下除本计划书以外的旧文档。
- 修改 `package.json` / `package-lock.json`，因为已移除 `electron-updater`。
- 修改 `src/main/index.ts`（移除桌面外壳 + 第六批服务集成）。
- 删除 `src/main/tray.ts`。
- 新增 `src/main/services/runtime/*`。
- 新增 `src/server/events.ts`、`src/server/http/local-admin-server.ts`。
- 修改机器码相关 preload/renderer 类型和页面。
- 修改 proxy/kproxy/registration/logger 等路径适配。
- 修改 `tsconfig.node.json`，纳入 `src/server/**/*`。

这些改动是同一轮“Electron 外壳删减 + 服务边界建设”的连续工作，不要在未理解前回滚其中一部分。

## 10. 已清理文档

本次交接清理已从 `docs/` 删除以下旧文档：

- `docs/API-Proxy-Guide.md`
- `docs/CHANGELOG-v1.2.5.md`
- `docs/CHANGELOG-v1.2.7.md`
- `docs/CHANGELOG-v1.3.7.md`
- `docs/CHANGELOG-v1.3.8.md`
- `docs/E2E-TESTING.md`
- `docs/RESTRUCTURING-PLAN.md`
- `docs/项目特性与架构总结.md`

保留：

- `docs/LOCAL-BROWSER-MIGRATION-PLAN.md`

根目录 `README.md` 已重写为中文新项目说明，`README_CN.md` 已删除。`AGENTS.md` 保留为仓库入口说明；`CLAUDE.md` 已由用户手动删除，本计划不恢复。

## 11. 交接提醒

接手人请牢记：

- 这不是简单删 Electron 项目。
- 当前的 `src/main/index.ts` 是业务和桌面外壳混在一起的集成 hub。
- P0/P1 核心 controller 已建立：账号/Auth、API 反代、单账号检查、Kiro 本地集成、注册、机器码、Kiro 设置和 K-Proxy 均已 service/controller 化。
- 账号/认证/API 反代/Kiro 本地集成/注册/机器码/Kiro 设置/K-Proxy HTTP API 已可用（端口 9527），`npm run serve` 可启动 standalone 服务；旧 renderer IPC 已复用同一批 service 保持过渡兼容。
- 每抽出一个 controller，再删对应 IPC handler 和 preload 桥接。
- 每删一类 Electron 能力，都要跑 typecheck 和关键 `rg` 扫描。
- 账号管理、轮询查询、浏览器登录、代理、K-Proxy、注册、机器码是核心功能，不能为了删外壳而删功能。
- **接手后必须首先运行 `npm run typecheck:node` 和 `npm run typecheck:web`**，确认服务层和旧 renderer 桥接仍一致。
