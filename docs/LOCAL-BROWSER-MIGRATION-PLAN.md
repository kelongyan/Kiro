# 本地浏览器化重构方案书

日期：2026-06-02

## 1. 需求结论

目标是把当前 Electron 桌面应用重构为“本机启动服务 + 浏览器打开管理后台”的形态。

这次重构的核心不是重写业务，而是删除桌面外壳，保留现有精简业务能力：

- 必须保留：账号管理、批量导入导出、Token 刷新、轮询查询、批量检查、浏览器登录、切换 Kiro IDE/CLI 账号。
- 应尽量保留：API 反代、K-Proxy、代理池、注册、订阅、Webhook、诊断、Kiro 设置、机器码管理、日志、配置同步。
- 可以删除：Electron 窗口、preload、IPC 桥、系统托盘、自动更新、窗口标题栏、桌面打包、桌面关闭确认、Electron 专属设置。
- 浏览器管理界面暂时不实现，但作为最终目标写入路线；第一阶段先做代码删减和服务化边界。

重要判断：不能把 `src/main/*` 全删。里面混着两类东西：

- Electron 外壳：应删除。
- Node 业务后端：应保留并迁移成本地服务。

## 2. 当前代码现状

当前项目仍是 Electron 架构：

- `package.json` 以 `electron-vite`、`electron-builder`、`electron-updater` 为构建和分发核心。
- `src/main/index.ts` 是最大耦合点，同时包含 Electron 生命周期、窗口、托盘、自动更新、IPC、账号刷新、登录、代理、Kiro 设置、机器码等逻辑。
- `src/preload/api/*` 只是把 `ipcRenderer.invoke/send/on` 包成 `window.api`。
- `src/renderer/src/*` 是 React UI，但大量业务状态仍在 renderer store 中，例如 `src/renderer/src/store/accounts.ts`。
- `src/main/proxy/*`、`src/main/kproxy/*`、`src/main/registration/*` 已经有较完整的业务模块，适合作为本地服务核心保留。

已有重构基础：

- 根目录已经扁平化。
- `src/main/services/*` 已抽出少量无 Electron 依赖的 helper。
- `src/preload/api/*` 已经按域拆分，这能反向帮助设计 HTTP API 分组。
- `src/renderer/src/features/*` 目前只是 facade，可作为未来浏览器 UI 迁移入口。

### 2.1 当前进展

截至 2026-06-02，第一阶段文件删减已完成第一批低风险桌面外壳清理。

已完成：

- 删除 renderer 桌面外壳组件：
  - `src/renderer/src/components/UpdateDialog.tsx`
  - `src/renderer/src/components/CloseConfirmDialog.tsx`
  - `src/renderer/src/components/Versions.tsx`
  - `src/renderer/src/components/layout/TitleBar.tsx`
  - `src/renderer/src/components/layout/TaskCenter.tsx`
- 从 `src/renderer/src/App.tsx` 移除自定义标题栏、更新弹窗、关闭确认弹窗、托盘账户同步和托盘事件监听。
- 从 `src/renderer/src/components/pages/AboutPage.tsx` 移除检查更新按钮和更新弹窗。
- 从 `src/renderer/src/components/pages/SettingsPage.tsx` 移除系统托盘设置和全局快捷键设置。
- 从 `src/renderer/src/store/accounts.ts` 移除语言切换时同步托盘菜单的副作用。
- 删除 preload 中已无前端调用的桌面桥接文件：
  - `src/preload/api/tray.ts`
  - `src/preload/api/update.ts`
  - `src/preload/api/window.ts`
- 从 `src/preload/index.ts`、`src/preload/api/index.ts`、`src/preload/index.d.ts` 移除上述桌面桥接导出和类型。

已验证：

- `npm run typecheck:web` 通过。
- `npm run typecheck:node` 通过。
- `rg` 扫描确认 renderer/preload 中没有 `UpdateDialog`、`CloseConfirmDialog`、`TitleBar`、`TaskCenter`、托盘桥接、更新桥接、窗口桥接的残留调用。

未完成：

- `src/main/index.ts` 中 Electron 生命周期、窗口、托盘、自动更新、窗口 IPC 仍未删除。
- `src/main/tray.ts` 仍未删除。
- `electron-builder.yml`、`build/**`、Electron 依赖和桌面 CI 仍未删除。
- 账号、登录、轮询、代理、注册、机器码等核心服务尚未完成 HTTP/SSE 化。

## 3. 已选迁移策略：后端优先剪枝

已确认采用“后端优先剪枝”策略：先把业务能力从 Electron 主进程中抽成 Node 本地服务，再删除 Electron 外壳，最后再做浏览器 UI。

这个策略的核心原则是：先保业务，再删外壳；先有可验证服务，再迁移页面。账号管理、轮询查询、浏览器登录、Token 刷新、API 反代、代理池、注册、K-Proxy 等能力都要先从 `src/main/index.ts` 和 renderer store 中抽成可直接调用的服务，再考虑删除 Electron 相关文件。

### 3.1 执行边界

第一轮只做服务化和代码删减，不实现新的浏览器端页面。

本轮包含：

- 建立 Node 本地服务入口。
- 建立 runtime、storage、event bus 等基础层。
- 抽出账号、登录、代理、K-Proxy、注册、Kiro 设置、机器码、诊断等核心服务。
- 用 REST/SSE 替代 IPC 的接口边界。
- 删除 Electron 窗口、preload、托盘、自动更新、桌面打包等外壳逻辑。

本轮不包含：

- 不重做浏览器 UI。
- 不开放局域网访问。
- 不实现浏览器点击自动提权。
- 不保留 `kiro://` 协议 helper。
- 不重构与当前目标无关的业务算法。

### 3.2 为什么先抽服务再删除

当前 `src/main/index.ts` 不是单纯桌面入口，它同时包含大量核心业务。直接删除会误伤：

- 账号数据读写和备份。
- Token 刷新、批量刷新、批量检查。
- Builder ID、IAM SSO、Google/GitHub 登录状态。
- Kiro IDE / CLI 本地切号。
- API 反代管理。
- K-Proxy 和证书管理。
- 机器码管理。
- Kiro 设置、MCP、Steering 文件操作。

所以删除顺序必须是：

1. 先把业务函数搬到 `src/server/services/*`。
2. 再把 Electron IPC controller 换成 HTTP/SSE controller。
3. 确认服务 smoke test 能覆盖核心流程。
4. 最后删除 Electron 文件和依赖。

### 3.3 分阶段落地方式

第一阶段：建立服务骨架。

- 新建 `src/server/index.ts` 作为本地服务入口。
- 默认监听 `127.0.0.1`。
- 提供 `/api/health` 健康检查。
- 提供 `/api/events` SSE 事件通道。
- 生成一次性本地访问 token。

第二阶段：替换 Electron runtime 能力。

- 用 `runtime/paths.ts` 替代 `app.getPath('userData')`。
- 用 `runtime/open-url.ts` 替代 `shell.openExternal`。
- 用 `runtime/platform.ts` 替代分散的平台检测和权限提示。
- 用 `events.ts` 替代 `mainWindow.webContents.send(...)`。
- 用 `storage/account-store.ts` 替代 `electron-store`。

第三阶段：先迁核心账号域。

- 抽出账号加载、保存、备份、迁移。
- 抽出单账号刷新、单账号检查。
- 抽出批量后台刷新、批量后台检查。
- 抽出自动刷新和自动换号调度。
- 抽出 Kiro IDE / CLI 切号。
- 抽出本地 Kiro 凭证导入。

第四阶段：迁登录域。

- Builder ID device flow 保持自动轮询。
- IAM SSO 保留本地 HTTP callback。
- Google/GitHub 暂按已确认决策改为手动粘贴回调 URL/code。
- 登录状态不再放在 Electron IPC handler 闭包里，改由 auth service 管理。

第五阶段：迁周边服务。

- 迁 API 反代管理接口，但保留 `src/main/proxy/*` 核心。
- 迁 K-Proxy 管理接口，但保留 MITM、证书、设备 ID 逻辑。
- 迁注册服务，删除或替换 `registration/ipc-handlers.ts`。
- 迁 Kiro 设置、MCP、Steering 文件操作。
- 迁机器码管理，保留管理员权限要求。
- 迁诊断、Webhook、配置同步、日志能力。

第六阶段：删除 Electron 外壳。

- 删除 `src/preload/**`。
- 删除窗口、托盘、自动更新、全局快捷键、关闭确认。
- 删除 Electron 桌面打包配置和脚本。
- 从依赖中移除 Electron 相关包。
- CI 改为 Node 服务构建和验证。

### 3.4 每一步的验收方式

每完成一个服务域，都要至少有一种验证方式：

- 账号域：用服务函数或 REST API 完成账号数据读取、保存、备份。
- 刷新域：触发批量刷新，能收到进度事件和结果事件。
- 登录域：Builder ID 或 IAM SSO 至少一个流程可完整拿到 token。
- 代理域：能启动、停止、读取状态、读取日志。
- K-Proxy：能初始化、读取状态、生成设备 ID、读取证书信息。
- 机器码：能读取当前机器码，权限不足时返回 `requiresAdmin`。
- Electron 删除阶段：`rg "from 'electron'|require\\('electron'\\)" src` 没有结果。

这个策略允许中途停在一个可验证状态，而不是一次性大爆破。

## 4. 目标架构

最终形态：

```text
src/
  server/
    index.ts                  # 本地服务入口，监听 127.0.0.1
    http/                     # REST + SSE API
    runtime/                  # 路径、打开浏览器、权限、数据目录等运行时适配
    storage/                  # 账号数据、配置、备份
    services/
      accounts/
      auth/
      proxy/
      kproxy/
      registration/
      kiro-settings/
      machine-id/
      diagnostics/
      webhooks/
  web/                        # 未来浏览器 UI，暂不实现
  shared/                     # 前后端共享类型
```

默认安全边界：

- 管理后台默认只监听 `127.0.0.1`。
- 浏览器首次打开使用一次性本地 token，例如 `http://127.0.0.1:端口/?token=...`。
- 不默认开放局域网。
- 已确认：第一版只允许本机 `127.0.0.1` 访问。
- 若未来支持 `0.0.0.0` 或局域网访问，必须另开需求，并启用管理密码或 API Key。

事件流：

- 普通操作使用 REST API。
- 后台刷新进度、批量检查进度、注册日志、反代日志、K-Proxy 日志使用 SSE。
- 先不引入 WebSocket，除非浏览器 UI 需要双向实时控制。

## 5. 保留清单

### P0 必须保留

- 账号 CRUD、批量导入、批量导出、分组、标签、筛选、排序。
- 账号凭证存储、备份、恢复。
- Token 刷新：`refresh-account-token` 相关逻辑。
- 账号状态检查：用量、订阅、封禁、过期状态。
- 批量后台刷新和批量后台检查。
- 自动刷新、刷新并发、同步检查账户信息。
- 自动换号和余额阈值切换。
- 切换到 Kiro IDE：写入 AWS SSO cache / Kiro 本地凭证。
- 切换到 Kiro CLI：写入 `kiro-cli` 本地数据库。
- 从本地 Kiro 凭证导入账号。
- Builder ID 设备码登录。
- IAM Identity Center SSO 浏览器登录与本地回调。
- API 反代核心：`src/main/proxy/*`。
- 代理池：代理导入、验证、轮询、随机、最少使用、最快优先、账号绑定代理。
- 网络代理设置和按账号代理绑定。
- 诊断探测。

### P1 尽量保留

- Google/GitHub 社交登录，但回调方式需要重新设计。
- Kiro 设置、MCP、Steering 文件管理。
- 机器码读取、生成、设置、绑定、历史。
- K-Proxy MITM、CA 证书、设备 ID 映射。
- 注册功能：自动注册、手动注册、批量注册、代理池集成、注册日志。
- 订阅页：订阅列表、订阅链接、overage 设置。
- Webhook 通知。
- 日志页和代理日志。
- 配置同步。
- 多语言、主题、隐私模式、用量精度。

### P2 可后置

- 关于页。
- 版本检查。
- 主题细节打磨。
- 浏览器 UI 页面布局重做。

## 6. 删除清单

### 直接删除或最终删除

- [部分完成] `src/preload/**`：已删除 `api/tray.ts`、`api/update.ts`、`api/window.ts`，并移除对应导出和类型；剩余账号、登录、代理等 preload API 暂时保留到 HTTP/SSE 接口可替换后再删。
- [待完成] `src/main/tray.ts`：系统托盘。
- [待确认] `src/main/ipc/**`：空目录或未来不再需要的 IPC 目录。
- [待完成] `electron-builder.yml`：桌面打包配置。
- [待完成] `build/**`：桌面安装脚本、mac entitlements。
- [待完成] `.github/workflows/build.yml` 中桌面多平台打包流程，改为 Node 服务构建流程。
- [已完成] `src/renderer/src/components/UpdateDialog.tsx`：electron-updater UI。
- [已完成] `src/renderer/src/components/CloseConfirmDialog.tsx`：桌面关闭确认。
- [已完成] `src/renderer/src/components/Versions.tsx`：Electron 版本显示。
- [已完成] `src/renderer/src/components/layout/TitleBar.tsx`：自定义桌面标题栏。
- [已完成] `src/renderer/src/components/layout/TaskCenter.tsx`：桌面标题栏任务中心抽屉。
- [部分完成] `src/preload/index.d.ts`：已移除桌面窗口、托盘、更新 API 类型；剩余 Electron API 声明待 HTTP API 类型替代后删除。

### 从代码中删除的能力

- [部分完成] BrowserWindow 创建、窗口最大化/最小化/关闭：renderer/preload 窗口桥接已删除，main 窗口生命周期待删。
- [部分完成] `globalShortcut` 全局快捷键：renderer 设置入口和 preload 桥接已删除，main handler 待删。
- [部分完成] 系统托盘设置和托盘菜单刷新：renderer 设置、账户同步、语言同步、preload 桥接已删除，main 托盘模块待删。
- [部分完成] `electron-updater` 自动下载与安装：renderer 更新 UI 和 preload 更新桥接已删除，main updater 逻辑和依赖待删。
- [部分完成] `ipcMain` / `ipcRenderer` 通信：桌面窗口、托盘、更新相关 preload IPC 已删，账号/登录/代理等核心 IPC 待 HTTP/SSE 替换后删除。
- [待完成] `contextBridge` 暴露 API。
- [待完成] Electron 原生 `dialog.showOpenDialog/showSaveDialog` 文件选择。
- [待完成] Electron `app.getVersion/app.getPath/app.isPackaged` 直接依赖。
- [待完成] Electron `shell.openPath/openExternal` 直接依赖。

### 需要替换而不是删除

- `electron-store` 替换为 Node 本地存储层。
- Electron 文件对话框替换为浏览器上传/下载。
- Electron `shell.openExternal` 替换为 Node 运行时 `openUrl()`。
- Electron `app.getPath('userData')` 替换为统一 `dataDir`。
- `mainWindow.webContents.send(...)` 替换为事件总线 + SSE。
- `window.api.*` 替换为 `apiClient.*`。

## 7. 不建议删除的文件或目录

这些目录里有核心业务，不能按桌面壳一起删：

- `src/main/proxy/*`
- `src/main/kproxy/*`
- `src/main/registration/*`，但 `ipc-handlers.ts` 要删或改造成 HTTP controller。
- `src/main/machineId.ts` 的平台逻辑，但要去 Electron 化。
- `src/main/services/*`
- `src/renderer/src/types/*`
- `src/renderer/src/store/accounts.ts` 里的业务规则，后续应拆到 server + web client 两边。
- `src/renderer/src/components/accounts/*`，作为未来浏览器 UI 迁移参考。
- `src/renderer/src/components/proxy/*`，作为未来浏览器 UI 迁移参考。
- `src/renderer/src/components/pages/RegisterPage.tsx`，注册流程 UI 复杂，建议先保留参考。
- `test/test_usage_api.py`、`test/test_kiro_apis.py` 是外部接口探针，不能当单元测试；可保留但执行前要明确它们会访问外部服务且含敏感 token。

## 8. 关键风险与处理

### 风险 1：Google/GitHub 社交登录回调

当前社交登录使用 `kiro://kiro.kiroAgent/authenticate-success` 协议回调。Electron 可以通过协议处理接住回调；纯浏览器本地服务默认接不住。

可选处理：

- 方案 1：短期改成手动粘贴回调 URL 或 code，保留功能但体验下降。已确认采用此方案。
- 方案 2：尝试改成本地 HTTP redirect，如果 Kiro Auth 服务允许注册 `http://127.0.0.1` 回调。
- 方案 3：保留一个极小的协议处理 helper，但这会重新引入桌面安装/注册协议逻辑，不符合“不要电脑软件相关逻辑”。

执行计划采用方案 1 作为过渡，等确认 Kiro Auth 是否接受本地 HTTP redirect 后再升级到方案 2。

### 风险 2：机器码和 CA 证书需要系统权限

机器码修改、K-Proxy CA 安装会触碰系统级权限。浏览器页面不能直接弹系统权限框，必须由本地服务执行。

默认处理：

- 浏览器只发起请求。
- 本地服务返回 `requiresAdmin`。
- 已确认：用户按提示用管理员权限启动或重启本地服务后，再执行机器码修改、CA 证书安装等系统级操作。

### 风险 3：数据迁移

当前账号数据在 `electron-store` 中，并带 `encryptionKey`。删除 Electron 前必须实现读取旧数据并迁移到新存储。

默认处理：

- 新存储优先使用 JSON 文件，目录为用户数据目录。
- 首次启动检测旧 `electron-store` 数据位置并导入。
- 保留 `kiro-accounts.backup.json` 备份策略。

### 风险 4：Renderer store 现在承担太多业务

`src/renderer/src/store/accounts.ts` 同时做 UI 状态、业务规则、定时任务、持久化、IPC 调用。浏览器化后，账号数据和定时任务应迁到服务端，浏览器只做展示和用户操作。

默认处理：

- 第一阶段不重写 UI。
- 先把 store 中的业务规则拆成 server services。
- 未来 UI 只保留轻量状态和 API client。

## 9. 优先级任务拆分

### 阶段 0：确认边界和保护现场

目标：避免误删核心功能。

任务：

- 跑 `git status --short` 和 `git diff --stat`，确认当前工作树。
- 跑 `npm run typecheck:node` 和 `npm run typecheck:web`，记录基线。
- 列出所有 `window.api.*` 调用，形成 API 迁移表。
- 列出所有 `ipcMain.handle/on`，形成 HTTP/SSE 迁移表。
- 标注所有 Electron import：`app`、`BrowserWindow`、`ipcMain`、`dialog`、`shell`、`globalShortcut`、`Tray`、`autoUpdater`。

验收：

- 有一张功能到文件的映射表。
- 没有开始删除核心业务文件。

### 阶段 1：建立 Node 服务运行时替代层

目标：让业务代码不再直接依赖 Electron。

任务：

- 新建 `src/server/runtime/paths.ts`，提供 `getDataDir()`、`getLogsDir()`、`getTempDir()`。
- 新建 `src/server/runtime/open-url.ts`，提供 `openUrl(url, options)`，替代 `shell.openExternal` 和隐私模式打开浏览器逻辑。
- 新建 `src/server/runtime/platform.ts`，封装 OS、权限检测、管理员提示文本。
- 新建 `src/server/events.ts`，统一发布后台刷新、注册、反代、K-Proxy 事件。
- 新建 `src/server/storage/account-store.ts`，替代 `electron-store` 的账号数据读写和备份。

验收：

- `src/main/proxy/logger.ts`、`src/main/kproxy/index.ts`、`src/main/registration/registrar.ts`、`src/main/machineId.ts` 不再直接调用 Electron 的 `app.getPath`。
- 账号数据可从旧存储迁移到新存储。

### 阶段 2：抽离账号和登录核心服务

目标：先保住核心业务。

任务：

- 从 `src/main/index.ts` 抽出账号服务：
  - load/save accounts
  - refresh token
  - check account status
  - background batch refresh
  - background batch check
  - verify credentials
  - import from SSO token
  - load local Kiro credentials
  - switch account for IDE
  - switch account for CLI
  - logout local SSO cache
- 从 `src/main/index.ts` 抽出登录服务：
  - Builder ID device flow
  - IAM SSO PKCE + local callback
  - Google/GitHub social auth state and token exchange
- 把刷新进度、检查进度、登录回调从 `mainWindow.webContents.send` 改成 event bus。

验收：

- 不依赖 `ipcMain` 也能调用账号和登录服务。
- 批量刷新和批量检查可通过服务测试触发。
- Builder ID 和 IAM SSO 登录流程仍可启动和轮询。

### 阶段 3：抽离保留功能服务

目标：保留项目现有精简功能，避免大删功能。

任务：

- 代理服务：
  - 保留 `src/main/proxy/*` 核心。
  - 抽出 proxy admin service：start/stop/status/config/logs/api keys/models/client config。
- K-Proxy 服务：
  - 保留 MITM、证书、设备 ID 映射。
  - 去掉 Electron path 依赖。
- 注册服务：
  - 保留 registrar。
  - 删除 `ipc-handlers.ts` 或改造成 HTTP controller。
- Kiro 设置服务：
  - 保留 settings、MCP、steering 文件读写。
  - `openPath` 类操作改成返回路径，浏览器端显示路径或调用服务端打开。
- 机器码服务：
  - 保留读取、生成、设置、备份、恢复。
  - 去掉 Electron dialog 和 app relaunch。
- 诊断、Webhook、订阅、配置同步：
  - 从 renderer store 或页面中拆出可复用业务逻辑。

验收：

- 每个服务可以被本地 HTTP 层调用。
- 没有服务直接 import `electron`。

### 阶段 4：删除 Electron 外壳

目标：完成第一轮真正删减。

任务：

- [部分完成] 删除 `src/preload/**`。
  - 已删除 `src/preload/api/tray.ts`、`src/preload/api/update.ts`、`src/preload/api/window.ts`。
  - 已从 `src/preload/index.ts`、`src/preload/api/index.ts`、`src/preload/index.d.ts` 移除桌面窗口、托盘、更新桥接。
  - 账号、登录、代理等核心 preload API 待 HTTP/SSE 接口就绪后删除。
- [待完成] 删除 `src/main/tray.ts`。
- [部分完成] 删除 Electron 窗口、托盘、快捷键、自动更新逻辑。
  - 已删除 renderer/preload 侧桌面入口。
  - main 侧窗口、托盘、快捷键、自动更新逻辑仍待拆除。
- [待完成] 删除 `electron-builder.yml` 和 `build/**` 桌面打包文件。
- 替换 `package.json` 脚本：
  - `dev` 改为启动本地服务。
  - `build` 改为构建 server 和未来 web。
  - 删除 `build:win/build:mac/build:linux/build:unpack/start` 桌面脚本。
- 删除依赖：
  - `electron`
  - `electron-builder`
  - `electron-updater`
  - `electron-vite`
  - `@electron-toolkit/preload`
  - `@electron-toolkit/utils`
- 删除或重写 `.github/workflows/build.yml` 桌面打包任务。

验收：

- `rg "from 'electron'|require\\('electron'\\)" src` 没有结果。
- `npm run typecheck:node` 通过。
- 服务能启动并输出本地访问地址。

### 阶段 5：建立管理 API

目标：用 HTTP/SSE 替代 IPC，但暂不实现浏览器 UI。

任务：

- 设计 REST API：
  - `/api/accounts/*`
  - `/api/auth/*`
  - `/api/proxy/*`
  - `/api/kproxy/*`
  - `/api/registration/*`
  - `/api/kiro-settings/*`
  - `/api/machine-id/*`
  - `/api/diagnostics/*`
  - `/api/webhooks/*`
  - `/api/config-sync/*`
- 设计 SSE：
  - `/api/events`
  - 事件类型包括 refresh-progress、refresh-result、check-progress、check-result、proxy-log、proxy-status、kproxy-log、registration-log、registration-complete。
- 默认监听 `127.0.0.1`。
- 生成一次性访问 token。
- 给 API 加最小鉴权和 CORS 限制。

验收：

- 用 PowerShell `Invoke-RestMethod` 能完成健康检查、账号读取、代理状态读取。
- SSE 能收到一条测试事件。
- 不需要浏览器 UI 也能验证服务能力。

### 阶段 6：浏览器 UI 迁移目标

目标：后续把当前 React UI 迁到浏览器。

任务：

- 新建 `src/web` 或复用 `src/renderer/src` 并改名。
- 删除自定义桌面标题栏、托盘设置、更新弹窗、关闭确认。
- 新建 `apiClient` 替代 `window.api`。
- 用 `EventSource` 订阅 `/api/events`。
- 把账号 store 改成：
  - 服务端负责持久化、轮询、刷新、代理状态。
  - 浏览器端负责展示、筛选、局部交互。
- 文件导入导出改成：
  - 导入：浏览器上传文件。
  - 导出：服务返回文件流或浏览器下载 Blob。

验收：

- 浏览器可管理账号。
- 浏览器可启动/停止 API 反代。
- 浏览器可查看刷新、检查、注册、代理日志。

## 10. 建议第一轮实施顺序

第一轮只做“服务化前置 + 删除桌面壳”，不做浏览器 UI。

顺序：

1. 建立 runtime 替代层。
2. 建立 storage 替代层并支持旧数据迁移。
3. 抽出账号服务和登录服务。
4. 抽出 proxy/kproxy/registration/kiro-settings/machine-id 管理服务。
5. 建立最小 HTTP + SSE 服务。
6. 删除 Electron preload、窗口、托盘、自动更新、打包配置。
   - 当前已完成 renderer/preload 侧桌面壳第一批删减。
   - main 侧 Electron 外壳和桌面打包配置仍待处理。
7. 调整 package scripts 和 CI。
8. 跑 typecheck 和服务 smoke test。

这样做的原因：

- 先抽服务，避免删掉核心能力。
- 再删 Electron，避免同时维护两套运行时太久。
- 浏览器 UI 最后做，避免在后端边界没稳时反复改页面。

## 11. 已确认的取舍

### 决策 1：管理后台访问范围

第一版管理后台只监听 `127.0.0.1`，只允许本机浏览器访问。

如果要局域网访问，需要额外做管理密码、API Key、CORS 白名单和敏感信息脱敏。

### 决策 2：Google/GitHub 社交登录回调

短期接受“手动粘贴回调 URL/code”。后续如果确认 Kiro Auth 支持 `http://127.0.0.1` redirect，再升级为自动本地 HTTP 回调。

不保留 `kiro://` 协议处理 helper，避免重新引入桌面软件相关逻辑。

### 决策 3：机器码和证书安装

保留机器码修改、K-Proxy CA 证书安装等功能，但接受“需要管理员权限启动本地服务后再操作”。

第一版不做浏览器点击后自动提权。服务检测到权限不足时返回 `requiresAdmin` 和明确提示。

### 决策 4：旧 React UI 的处理

执行建议：短期保留作为迁移参考，但不参与第一轮服务构建。

如果想极致删减，可以先移到 `archive/` 或文档说明里，但不建议立刻删除，因为账号、注册、代理页面里有大量流程细节。

## 12. 验证标准

每个阶段至少满足：

- `npm run typecheck:node` 通过。
- 相关服务 smoke test 通过。
- `rg "from 'electron'|require\\('electron'\\)" src` 在删除阶段后为 0。
- 核心账号数据能读写和备份。
- 批量刷新和批量检查能跑完并输出进度事件。
- API 反代能启动、停止、读取状态。
- Builder ID 或 IAM SSO 至少一个浏览器登录流程可完整跑通。

不声称通过：

- 未跑过的 E2E。
- 需要真实账号或外部 Kiro 接口的 live probe。
- 社交登录自动回调，除非已经解决 `kiro://` 回调问题。
