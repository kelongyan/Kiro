# 本地浏览器化管理系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Kiro Account Manager 打磨成本地浏览器可视化管理系统，覆盖多账号管理、账号轮询使用、API 反代、代理池、K-Proxy、注册、订阅、Webhook、诊断和配置同步。

**Architecture:** 沿用当前“Node 本地管理服务 + Vite/React 浏览器 UI + REST/SSE + 本地加密存储”的架构，不恢复 Electron。后端负责长期运行任务、调度、存储、代理和反代；前端负责可视化操作、筛选、展示和用户交互。

**Tech Stack:** Node.js 22, TypeScript, Vite, React 19, Tailwind CSS 4, Zustand, Framer Motion, lucide-react, REST, SSE, AES-256-GCM local encrypted storage, undici, socks, tlsclientwrapper.

---

## 1. 当前项目基础

当前仓库已经具备本地管理系统的核心骨架，不需要推倒重写。

关键入口：

- `src/server/standalone.ts`：本地服务入口，组装账号、Auth、反代、Kiro 本地集成、注册、机器码、Kiro 设置、K-Proxy、诊断、订阅、Webhook 和配置同步。
- `src/server/http/local-admin-server.ts`：本地 HTTP/SSE 服务，包含 loopback 限制、token 鉴权、CORS、`/api/health`、`/api/events`。
- `src/server/http/controllers/*.ts`：REST API controller。
- `src/server/services/**/*`：服务层，封装业务编排、存储和核心模块生命周期。
- `src/core/**/*`：跨 UI/服务的核心逻辑，例如反代、K-Proxy、注册、机器码、Kiro settings。
- `src/renderer/src/App.tsx`：浏览器 UI 根组件。
- `src/renderer/src/app/navigation.ts`：页面导航注册。
- `src/renderer/src/app/page-registry.tsx`：页面渲染注册。
- `src/renderer/src/services/local-admin-*.ts`：浏览器端 REST/SSE client。
- `src/renderer/src/store/accounts.ts`：账号、设置、代理池、机器码绑定等前端状态主 store。
- `src/renderer/src/components/pages/*.tsx` 和 `src/renderer/src/components/*`：页面和组件。

现有验证命令：

- `npm run typecheck`
- `npm run serve:smoke`
- `npm run lint`
- `npm run build`

---

## 2. 已采纳的默认决策

本计划按以下默认方案推进：

- 本地服务启动后，核心轮询任务继续运行；浏览器关闭不影响后台调度。
- 反代账号池默认使用 `healthy-only + least-used + credits-aware` 的选择策略。
- API Key 支持绑定不同账号范围，便于不同客户端或用途隔离。
- 代理池先复用现有前端能力，核心闭环稳定后迁移到后端统一管理。
- `npm run serve` 最终应能托管前端页面，让用户只打开本地浏览器入口即可操作。

---

## 3. 总体阶段排序

| 阶段    | 名称                        | 优先级 | 复杂度 | 目标                                           |
| ------- | --------------------------- | ------ | ------ | ---------------------------------------------- |
| Phase 0 | 本地控制台闭环              | 最高   | 中     | 已完成：一个服务入口打开完整浏览器 UI          |
| Phase 1 | 多账号管理核心稳定          | 最高   | 中高   | 账号导入、分组、标签、刷新、检测、切号稳定可用 |
| Phase 2 | 后端轮询与任务调度          | 最高   | 高     | 轮询、并发、退避、历史结果迁到 server          |
| Phase 3 | API 反代控制台              | 高     | 高     | 可视化管理反代、账号池、API Key、日志和模型    |
| Phase 4 | 代理池系统增强              | 高     | 中高   | 代理导入、验活、调度、绑定、反代出站统一       |
| Phase 5 | K-Proxy 高级能力            | 中     | 高     | CA、MITM、device id、账号映射可视化            |
| Phase 6 | 注册/订阅/Webhook/诊断/同步 | 中     | 中高   | 周边能力统一接入任务和配置体系                 |
| Phase 7 | 安全、测试和发布收口        | 中     | 中     | 产品化、脱敏、测试覆盖、发布验证               |

---

## 4. Phase 0: 本地控制台闭环

**状态：** 已完成（2026-06-02）

**目标：** `npm run serve` 启动后，本地服务既提供 REST/SSE，也能托管构建后的浏览器 UI。

**价值：** 这是从“开发项目”变成“本地管理系统”的第一步。用户不应该长期手动维护两个终端、两个端口、一个 token 参数。

**主要文件：**

- Modify: `src/server/http/local-admin-server.ts`
- Modify: `src/server/standalone.ts`
- Create: `src/server/http/static-files.ts`
- Modify: `vite.server.config.ts`
- Optional Modify: `README.md`，仅在用户明确要求同步使用文档时修改

**任务清单：**

- [x] 新增 `src/server/http/static-files.ts`，实现安全静态文件托管：
  - 只服务指定 `staticDir` 下的文件。
  - 阻止 `..` 路径逃逸。
  - 支持常见 MIME：HTML、JS、CSS、PNG、SVG、ICO、JSON、TXT。
  - 非 `/api/*` 路径 fallback 到 `index.html`，支持浏览器刷新。
- [x] 在 `createLocalAdminServer` options 中增加 `staticDir?: string`。
- [x] 在 `local-admin-server.ts` 中保持 API 优先匹配：
  - `/api/health` 无 token。
  - `/api/events` 需要 token。
  - `/api/*` controller 需要 token。
  - 非 `/api/*` 静态页面按 `staticDir` 托管。
- [x] 在 `standalone.ts` 中解析 `out/renderer` 目录。
- [x] 增加环境变量控制：
  - `KIRO_ADMIN_OPEN_BROWSER=0` 时不自动打开浏览器。
  - 未设置时可以自动打开 `adminUrl`。
- [x] 保留开发模式：
  - `npm run serve` 启动本地服务。
  - `npm run dev:web` 仍支持 Vite 独立调试。
- [x] 增加 smoke 覆盖：
  - `GET /api/health`
  - `GET /`
  - `GET /assets/...` 或构建产物中的静态资源

**验收标准：**

- [x] `npm run build` 成功。
- [x] `npm run serve:smoke` 成功，默认使用随机端口和临时数据目录。
- [x] 执行 `npm run serve` 后，本地服务构建并托管浏览器 UI，默认自动打开 `adminUrl`。
- [x] 不设置 `VITE_KIRO_ADMIN_BASE_URL` 时，同源部署可正常调用 API。
- [x] `docs` 仅按用户要求更新本计划书。

**本阶段新增/修改：**

- `src/server/http/static-files.ts`
- `src/server/http/local-admin-server.ts`
- `src/server/standalone.ts`
- `test/server/static-files-smoke.mjs`
- `test/server/run-standalone-smoke.mjs`
- `package.json`

**完成验证：**

- `npm run typecheck`
- `npm run serve:build; node test/server/static-files-smoke.mjs`
- `npm run serve:smoke`
- `npm run lint`
- `npm run build`

---

## 5. Phase 1: 多账号管理核心稳定

**状态：** 已完成（2026-06-03）

**目标：** 多账号管理成为系统主线，支持稳定的导入、编辑、分组、标签、筛选、刷新、检测、切号和数据落盘。

**主要文件：**

- Modify: `src/renderer/src/store/accounts.ts`
- Modify: `src/renderer/src/components/accounts/*.tsx`
- Modify: `src/renderer/src/components/pages/SettingsPage.tsx`
- Modify: `src/server/http/controllers/account-controller.ts`
- Modify: `src/server/services/accounts/account-service.ts`
- Modify: `src/server/storage/account-store.ts`
- Test/Contract: `test/renderer/local-admin-clients.contract.ts`

**任务清单：**

- [x] 梳理 `accounts.ts` 中账号 CRUD、导入导出、刷新检测、机器码、代理池职责，标记后续可拆分边界。
- [x] 保持现有 UI 行为不大改，先补齐稳定性：
  - [x] 导入重复账号提示。
  - [x] 导入字段错误报告。
  - [x] 批量删除前确认。
  - [x] 敏感字段默认隐藏。
- [x] 账号详情统一展示：
  - 邮箱、昵称、IDP、区域、订阅、用量、状态。
  - access token、refresh token、client secret 脱敏展示。
  - 机器码绑定状态。
  - 代理绑定状态。
  - 最近刷新/检测时间和错误信息。
- [x] 批量刷新和检测增加更明确的结果聚合：
  - 总数。
  - 成功数。
  - 失败数。
  - 失败原因分类。
- [x] 保持大账号量性能：
  - 继续使用虚拟列表或现有缓存策略。
  - 避免每条后台结果触发一次全量 Map 复制。
- [x] 数据保存继续走 `AccountStore` 和 `CryptoStore`。
- [x] 对导入导出数据格式建立 contract 测试。
  - [x] `AccountImportItem` 简化导入格式已建立运行态 contract。
  - [x] 完整 `AccountExportData` JSON 导入/导出格式已覆盖 provider-aware 重复规则。

**当前进度：**

- 新增 `src/renderer/src/store/account-import.ts`，将普通账号导入的字段清洗、IDP 归一化、重复判断和账号构造抽成纯函数。
- `importAccounts` 已接入统一导入规则，重复账号按“同邮箱 + 同 provider”判断，同邮箱不同 provider 仍允许导入。
- CSV/TXT/卡密导入不再提前过滤无效行，会返回缺少邮箱、缺少 RefreshToken、重复账号等失败明细。
- 账号管理页面导入弹窗会显示最多 3 条失败明细，便于定位坏数据。
- 新增 `test/renderer/account-import.contract.ts` 和 `npm run test:account-import`，覆盖字段校验、重复账号、IDP/字段归一化。
- 新增 `src/renderer/src/store/account-management-utils.ts` 和 `npm run test:account-management`，覆盖敏感字段脱敏、批量结果聚合、虚拟列表稳定尺寸。
- `AccountDetailDialog` 补齐状态、机器码、代理绑定、最近检测、最近错误和凭据脱敏展示。
- `AccountToolbar` 批量刷新/检测会显示总数、成功、失败和失败原因分类。

**本轮验证：**

- `npm run test:account-import`
- `npm run test:account-management`
- `npm run typecheck`
- `npm run lint`（通过，仍有 47 条历史 Prettier warning，本轮未收敛旧格式债）
- `npm run serve:smoke`

**验收标准：**

- [x] 1000 个账号列表渲染和筛选继续走虚拟列表，关键尺寸有 contract 锁定。
- [x] 批量刷新/检测有结果汇总和失败明细分类。
- [x] 页面刷新后账号、分组、标签、代理绑定、机器码绑定仍走原有持久化链路恢复。
- [x] 敏感字段默认脱敏展示，不新增普通日志明文输出。
- [x] `npm run typecheck` 成功。

---

## 6. Phase 2: 后端轮询与任务调度

**状态：** 已完成（2026-06-03）

**目标：** 将长期运行的账号轮询、刷新、检测、退避、任务历史迁到 server。浏览器只负责配置和展示，关闭页面不影响任务继续运行。

**主要文件：**

- Create: `src/server/services/scheduler/scheduler-service.ts`
- Create: `src/server/services/scheduler/types.ts`
- Create: `src/server/http/controllers/scheduler-controller.ts`
- Modify: `src/server/standalone.ts`
- Modify: `src/server/events.ts`
- Create: `src/renderer/src/services/local-admin-scheduler.ts`
- Modify or Create: `src/renderer/src/store/tasks.ts`
- Create or Modify: `src/renderer/src/components/pages/TasksPage.tsx`
- Modify: `src/renderer/src/app/navigation.ts`
- Modify: `src/renderer/src/app/page-registry.tsx`

**核心模型：**

- `SchedulerTask`：任务定义，例如 token 刷新、状态检测、用量检测、注册任务、代理验活。
- `SchedulerRun`：一次执行记录。
- `SchedulerPolicy`：间隔、并发、失败退避、最大重试、账号范围。
- `SchedulerEvent`：通过 SSE 推给前端的任务状态变化。

**任务清单：**

- [x] 新增 scheduler service，支持：
  - 启动/停止任务。
  - 暂停/恢复任务。
  - 查询任务状态。
  - 查询最近运行记录。
  - 并发限制。
  - 失败退避。
- [x] 首批迁移账号自动刷新：
  - 从浏览器 timer 迁到 server。
  - 前端保留手动触发入口。
  - 前端显示后端任务状态。
- [x] 首批迁移账号状态检测：
  - 定时检查 access token、用量、订阅、封禁状态。
  - 结果通过 SSE 推送。
- [x] 增加任务事件：
  - `scheduler-task-started`
  - `scheduler-task-progress`
  - `scheduler-task-completed`
  - `scheduler-task-failed`
  - `scheduler-task-paused`
- [x] 新增任务中心页面：
  - 当前运行任务。
  - 最近执行结果。
  - 失败原因。
  - 下次执行时间。
  - 手动暂停/恢复。
- [x] 将 `accounts.ts` 中浏览器自动刷新逻辑降级为兼容层：
  - 如果后端 scheduler 可用，使用后端。
  - 如果后端不可用，显示错误，不静默退回复杂前端 timer。

**本阶段新增/修改：**

- `src/server/services/scheduler/types.ts`
- `src/server/services/scheduler/scheduler-service.ts`
- `src/server/http/controllers/scheduler-controller.ts`
- `src/server/standalone.ts`
- `src/renderer/src/services/local-admin-scheduler.ts`
- `src/renderer/src/components/pages/TasksPage.tsx`
- `src/renderer/src/features/tasks/index.ts`
- `src/renderer/src/app/navigation.ts`
- `src/renderer/src/app/page-registry.tsx`
- `src/renderer/src/services/local-admin-events.ts`
- `src/renderer/src/store/accounts.ts`
- `test/renderer/local-admin-clients.contract.ts`
- `test/server/scheduler.contract.ts`
- `package.json`

**实现说明：**

- Scheduler 默认注册 `account-auto-refresh` 和 `account-status-check` 两个任务。
- 任务策略从账号存储中的 `autoRefreshInterval`、`autoRefreshConcurrency`、`autoRefreshSyncInfo`、`statusCheckInterval` 读取。
- 最近运行记录保存在 `ConfigStore` 的 `schedulerRuns` 中，任务暂停状态保存在 `schedulerTaskState` 中。
- `startAutoTokenRefresh` 不再启动浏览器 `setInterval`，改为调用后端 scheduler；失败时只记录错误，不静默退回前端 timer。
- Scheduler 会在账号设置变化时同步启停和重排任务；`/api/scheduler/health` 的轮询不会反复推迟 `nextRunAt`。
- 当前阶段复用已有 `AccountService.batchRefresh/batchCheck` 和后台结果 SSE，未在 scheduler 内重新实现账号刷新逻辑。

**完成验证：**

- `npm run test:account-import`
- `npm run test:account-management`
- `npm run test:scheduler`
- `npm run typecheck`
- `npm run lint`
- `npm run serve:smoke`
- `npm run build`
- 浏览器页面验证：任务中心可显示默认任务、手动运行写入最近执行、暂停/恢复状态切换；账户管理页可正常进入并保持 P1 工具栏状态。

**验收标准：**

- [x] 浏览器关闭后，本地服务仍能按配置运行账号轮询。
- [x] 浏览器重新打开后能看到任务历史和当前状态。
- [x] 并发、间隔、失败退避生效。
- [x] 封禁、过期、网络错误、鉴权错误通过批量结果和账号状态分类显示。
- [x] `npm run serve:smoke` 已增加 scheduler health、默认任务、手动运行、暂停/恢复检查并通过。

---

## 7. Phase 3: API 反代控制台

**状态：** 已完成（2026-06-03）

**目标：** 将现有 OpenAI/Claude-compatible 反代做成完整可视化控制台，支持账号池、API Key、模型、日志、统计和客户端配置。

**主要文件：**

- Modify: `src/core/proxy/proxyServer.ts`
- Modify: `src/core/proxy/accountPool.ts`
- Modify: `src/core/proxy/types.ts`
- Modify: `src/server/services/proxy/proxy-service.ts`
- Modify: `src/server/http/controllers/proxy-controller.ts`
- Modify: `src/renderer/src/services/local-admin-proxy.ts`
- Modify: `src/renderer/src/components/proxy/ProxyPanel.tsx`
- Modify: `src/renderer/src/components/proxy/ApiKeyManager.tsx`
- Modify: `src/renderer/src/components/proxy/ModelsDialog.tsx`
- Modify: `src/renderer/src/components/proxy/ProxyLogsDialog.tsx`
- Modify: `src/renderer/src/components/proxy/ProxyDetailedLogsDialog.tsx`

**任务清单：**

- [x] 明确反代运行状态：
  - host。
  - port。
  - running。
  - active account count。
  - available account count。
  - total requests。
  - success/failed requests。
  - token/credits usage。
- [x] API Key 支持精细权限：
  - enabled。
  - creditsLimit。
  - modelAllowlist。
  - accountAllowlist。
  - usage reset。
- [x] 账号池同步：
  - 从当前账号列表选择 active 账号。
  - 同步 access token、refresh token、client id、client secret、region、provider、proxyUrl。
  - 被封禁账号自动暂停使用。
- [x] 账号选择策略：
  - 默认 `healthy-only + least-used + credits-aware`。
  - 支持 round-robin、least-used、fastest-proxy、manual allowlist。
- [x] 请求日志增强：
  - request id。
  - API Key id。
  - account id。
  - model。
  - status。
  - latency。
  - input/output/cache/reasoning tokens。
  - credits。
  - error summary。
- [x] 模型管理：
  - 刷新模型列表。
  - 模型能力展示。
  - 模型映射规则。
- [x] 客户端配置生成：
  - PowerShell 环境变量。
  - OpenAI SDK base URL。
  - Claude-compatible endpoint。
  - curl 示例。

**当前进度：**

- 新增 `/api/proxy/dashboard`，统一返回反代运行状态、origin、账号池健康、API Key 汇总、请求/tokens/credits 汇总和最近请求。
- `ProxyService.getDashboard()` 已覆盖 contract，能统计可用、封禁、配额耗尽、冷却账号，以及 enabled/disabled/limited/restricted API Key。
- API Key 增加 `modelAllowlist` 和 `accountAllowlist`，新增/更新接口会清洗并持久化这些字段。
- 反代请求会按 API Key 的账号白名单过滤账号池；模型白名单不匹配时返回 403。
- 账号同步到反代池时会带上账号绑定的 `proxyUrl`，支持按账号代理出站。
- 账号池默认策略改为 `least-used`，并新增 `least-used` / `fastest-proxy` 策略；原 `round-robin` / `sticky` 保留。
- 反代面板增加 dashboard 概览，展示账号池、API Key、成功率和选择策略。
- API Key 管理弹窗增加模型白名单输入和账号白名单点选。
- 最近请求结构已补 `requestId`、`apiKeyId`、`accountId`、`status`、cache/reasoning tokens 和 error summary 字段。
- 最近请求表格和日志弹窗可展示“请求 -> API Key -> 账号 -> 模型 -> 结果 -> 用量”链路。
- 模型弹窗保留刷新、能力标签和模型映射入口，满足当前阶段模型管理闭环。
- 客户端配置弹窗新增 PowerShell、OpenAI SDK、Claude-compatible 和 curl 示例，并支持复制。
- 浏览器入口新增 `?page=<pageId>` 深链，`?page=proxy` 可直达 API 反代页，同时保留本地 token 参数。

**本轮验证：**

- `npm run test:proxy-dashboard`
- `npm run test:client-config-snippets`
- `npm run test:page-url`
- renderer local-admin client contract（`proxyGetDashboard` 类型链路）
- `npm run typecheck`
- `npm run lint`（通过，仍有 41 条历史 Prettier warning）
- `npm run test:account-import`
- `npm run test:account-management`
- `npm run test:scheduler`
- `npm run serve:smoke`
- `npm run build`
- 浏览器页面验证：
  - `?page=proxy` 可直达 API 反代页。
  - dashboard 展示账号池、API Keys、成功率、选择策略。
  - 策略按钮显示最少使用、轮询、粘滞、最快代理。
  - 客户端配置弹窗展示 PowerShell、OpenAI SDK、Claude-compatible、curl 示例。
  - API Key 管理弹窗展示权限范围、模型白名单、账号白名单。

**验收标准：**

- [x] 多账号可被同步到反代账号池。
- [x] 请求进入反代后按策略选择健康账号。
- [x] 单个账号失败不会拖垮整个账号池。
- [x] API Key 权限限制生效。
- [x] 日志可追踪“请求 -> API Key -> 账号 -> 模型 -> 结果 -> 用量”。
- [x] `npm run typecheck` 成功。
- [x] `npm run serve:smoke` 成功。

---

## 8. Phase 4: 代理池系统增强

**目标：** 代理池成为账号、注册、反代统一可用的基础能力。

**主要文件：**

- Modify: `src/renderer/src/types/proxy.ts`
- Modify: `src/renderer/src/store/accounts.ts`
- Modify: `src/renderer/src/components/pages/ProxyPoolPage.tsx`
- Modify: `src/server/services/diagnostics/diagnostics-service.ts`
- Modify: `src/server/http/controllers/diagnostics-controller.ts`
- Modify: `src/server/services/proxy/proxy-service.ts`
- Modify: `src/core/proxy/proxyServer.ts`
- Later Create: `src/server/services/proxy-pool/proxy-pool-service.ts`
- Later Create: `src/server/http/controllers/proxy-pool-controller.ts`

**任务清单：**

- [ ] 短期复用前端 store 的代理池能力，先补齐 UI 和行为：
  - 导入。
  - 去重。
  - 启用/停用。
  - 批量删除。
  - 批量验活。
  - 自动停用 dead 代理。
- [ ] 支持常见代理格式：
  - `host:port`
  - `host:port:user:pass`
  - `user:pass@host:port`
  - `http://user:pass@host:port`
  - `socks5://host:port`
- [ ] 代理调度策略：
  - random。
  - round-robin。
  - least-used。
  - fastest。
- [ ] 账号代理绑定：
  - 单账号绑定代理。
  - 批量账号绑定代理。
  - 自动均分账号到代理。
  - 解绑后回退全局代理。
- [ ] 反代请求使用账号绑定代理出站。
- [ ] 注册任务可从代理池选取代理。
- [ ] 阶段后半将代理池迁移到后端 service：
  - 配置、状态、验活历史由 server 管理。
  - 前端通过 REST/SSE 展示状态。

**验收标准：**

- [ ] 批量导入代理可去重。
- [ ] 批量验活有并发控制。
- [ ] dead 代理自动停用。
- [ ] 账号详情能看到绑定代理。
- [ ] 注册任务能按代理池策略选择代理。
- [ ] 反代请求能按账号绑定代理出站。

---

## 9. Phase 5: K-Proxy 高级能力

**目标：** 将 K-Proxy/MITM/device id 管理做成高级功能页，不阻塞主账号和反代主线。

**主要文件：**

- Modify: `src/core/kproxy/**/*`
- Modify: `src/server/services/kproxy/kproxy-service.ts`
- Modify: `src/server/http/controllers/kproxy-controller.ts`
- Modify: `src/renderer/src/services/local-admin-kproxy.ts`
- Modify: `src/renderer/src/components/kproxy/KProxyPanel.tsx`
- Modify: `src/renderer/src/components/pages/KProxyPage.tsx`

**任务清单：**

- [ ] CA 证书状态可视化：
  - 是否生成。
  - 是否安装。
  - 证书路径。
  - 过期时间。
- [ ] 危险操作确认：
  - 安装 CA。
  - 卸载 CA。
  - 重置 CA。
  - 修改 device id。
- [ ] MITM 日志展示：
  - request host。
  - path。
  - 是否替换 device id。
  - response status。
  - duration。
- [ ] device id 映射：
  - 账号 -> device id。
  - 当前激活账号。
  - 切号自动切 device id。
- [ ] 管理员权限状态提示：
  - Windows 下安装证书需要管理员权限时，给出明确提示。

**验收标准：**

- [ ] K-Proxy 启动、停止、重启状态准确。
- [ ] CA 安装状态可见。
- [ ] MITM 日志可用于排查请求是否被替换。
- [ ] 账号切换和 device id 映射一致。
- [ ] 失败原因不吞掉，UI 可见。

---

## 10. Phase 6: 注册、订阅、Webhook、诊断、配置同步

**目标：** 将现有周边功能纳入统一任务、事件、配置体系。

**主要文件：**

- Modify: `src/server/services/registration/registration-service.ts`
- Modify: `src/core/registration/**/*`
- Modify: `src/server/services/subscriptions/subscription-service.ts`
- Modify: `src/server/services/webhooks/webhook-service.ts`
- Modify: `src/server/services/diagnostics/diagnostics-service.ts`
- Modify: `src/server/services/config-sync/config-sync-service.ts`
- Modify: `src/renderer/src/components/pages/RegisterPage.tsx`
- Modify: `src/renderer/src/components/pages/SubscriptionPage.tsx`
- Modify: `src/renderer/src/components/pages/WebhooksPage.tsx`
- Modify: `src/renderer/src/components/pages/DiagnosePage.tsx`
- Modify: `src/renderer/src/components/pages/ConfigSyncPage.tsx`

**任务清单：**

- [ ] 注册任务接入 scheduler：
  - 并发。
  - 暂停。
  - 取消。
  - 失败退避。
  - 代理池选择。
- [ ] 注册结果进入账号导入流程：
  - 成功账号可一键加入账号库。
  - 失败账号保留失败原因。
- [ ] 订阅页面补齐批量入口和结果记录。
- [ ] Webhook 事件统一：
  - token expired。
  - account banned。
  - usage warning。
  - proxy failed。
  - all accounts exhausted。
  - registration completed。
- [ ] 诊断页面成为总检查入口：
  - 本地服务。
  - Kiro API。
  - 代理池。
  - 反代服务。
  - K-Proxy。
  - 数据目录和加密存储。
- [ ] 配置同步明确区分：
  - 非敏感配置。
  - 代理池。
  - Webhook。
  - 注册模板。
  - 敏感账号凭证。

**验收标准：**

- [ ] 注册任务可在任务中心看到进度。
- [ ] 订阅入口和结果记录可追踪。
- [ ] Webhook 可测试且最近触发记录可见。
- [ ] 诊断页面能定位常见错误类别。
- [ ] 配置导出默认不包含敏感 token，除非用户明确选择。

---

## 11. Phase 7: 安全、测试和发布收口

**目标：** 将系统从可用打磨到稳定、可验证、可维护。

**主要文件：**

- Modify: `src/server/http/local-admin-server.ts`
- Modify: `src/renderer/src/services/local-admin-client.ts`
- Modify: `src/server/storage/crypto-store.ts`
- Modify: `src/server/storage/account-store.ts`
- Modify: `eslint.config.mjs`
- Modify: `package.json`
- Create: `test/server/*.test.ts`
- Create: `test/core/*.test.ts`
- Create: `test/renderer/*.contract.ts`

**任务清单：**

- [ ] local admin token 安全：
  - 默认随机。
  - 支持 `KIRO_ADMIN_TOKEN` 固定。
  - 前端存入 `sessionStorage`。
  - 尽量减少 token 长期暴露在 URL。
- [ ] 日志脱敏：
  - access token。
  - refresh token。
  - client secret。
  - API key。
  - bearer token。
- [ ] 数据目录和加密 key 行为明确：
  - 默认 `%APPDATA%\kiro-account-manager`。
  - 支持 `KIRO_ADMIN_DATA_DIR`。
  - 支持 `KIRO_ADMIN_ENCRYPTION_KEY`。
- [ ] 建立轻量测试：
  - local admin 鉴权。
  - static files fallback。
  - account store 加密读写。
  - proxy URL 解析。
  - proxy pool 去重和调度。
  - scheduler 并发和退避。
- [ ] 建立最终验证顺序：
  - `npm run typecheck`
  - `npm run lint`
  - `npm run serve:smoke`
  - `npm run build`
- [ ] 发布前检查：
  - `git status --short`
  - `git diff --stat`
  - 敏感文件未进入 Git。
  - `.env`、`kiro_token.json`、运行数据未提交。

**验收标准：**

- [ ] 主流程有稳定验证命令。
- [ ] 敏感数据默认脱敏。
- [ ] 构建产物可由本地服务托管。
- [ ] smoke 能覆盖核心健康端点。
- [ ] 文档、脚本、实际行为一致。

---

## 12. 实施策略

推荐按阶段推进，每个阶段完成后停下来验收，不跨阶段大面积开工。

每个阶段执行前：

- [ ] 运行 `git status --short` 和 `git diff --stat`，确认工作区状态。
- [ ] 明确本阶段只改哪些文件。
- [ ] 若涉及 UI，先确认页面交互和状态流。
- [ ] 若涉及长期任务或 bugfix，优先补测试或 smoke 覆盖。

每个阶段执行后：

- [ ] 运行本阶段最小验证命令。
- [ ] 至少运行 `npm run typecheck`。
- [ ] 涉及服务入口、controller、SSE 或核心服务时运行 `npm run serve:smoke`。
- [ ] 涉及最终交付时运行 `npm run build`。
- [ ] 汇报改动、验证结果、未完成项。
- [ ] 只有用户明确要求时才创建 commit。

---

## 13. 风险和控制方式

**风险：`accounts.ts` 继续膨胀。**  
控制：新业务优先放 server service 或独立 renderer service；Zustand 只保留 UI 需要的状态和缓存。

**风险：长期任务放浏览器 timer 不稳定。**  
控制：Phase 2 将轮询、并发、退避、历史结果迁到 server。

**风险：反代核心 `proxyServer.ts` 体量大，误改影响范围广。**  
控制：先通过 service/controller/UI 层补可观测性；核心策略改动必须有针对性测试或 smoke。

**风险：代理池前后端职责不清。**  
控制：Phase 4 分两步走，先稳定现有行为，再迁移后端统一管理。

**风险：token 和账号凭证泄漏到日志或配置导出。**  
控制：Phase 7 做统一脱敏和导出选项隔离；敏感导出必须显式选择。

---

## 14. 推荐第一阶段执行切口

建议先执行 Phase 0，原因：

- 改动边界清晰。
- 用户价值最高。
- 能立刻把项目变成本地浏览器管理系统入口。
- 不会先碰反代和账号轮询的大复杂度。

Phase 0 完成后，再进入 Phase 1 和 Phase 2。这样系统会先有稳定外壳，再逐步把核心能力迁进去，节奏最稳。
