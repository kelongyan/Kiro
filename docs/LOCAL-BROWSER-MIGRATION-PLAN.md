# Kiro 账号管理器本地浏览器化重构交接计划书

日期：2026-06-02

本文档是当前唯一保留的 `docs/` 交接文档。后续接手请先读本文，不要参考已删除的旧 changelog、旧重构计划、旧 E2E 说明和旧架构总结。

## 1. 接手必读

当前目标：把 Electron 桌面应用迁移为“本机启动服务 + 浏览器打开管理后台”的形态。

当前阶段：第一阶段代码删减和服务化边界建设中。浏览器端 UI 暂时不实现。

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

仍未完成：

- 本地服务骨架尚未接入启动脚本。
- 服务不会随 `npm run dev` 独立启动。
- 账号/登录/代理/K-Proxy/注册/机器码等业务尚未迁成 REST controller。
- `emitAppEvent()` 内部仍保留 `mainWindow?.webContents.send(...)` 作为过渡兼容。

## 5. 当前未完成工作

P0 未完成：

- 账号读取、保存、备份、迁移尚未抽成 server storage/account service。
- Token 刷新、批量刷新、批量检查尚未抽成 account service。
- Builder ID、IAM SSO、社交登录状态尚未抽成 auth service。
- 刷新/检查/注册/代理等事件尚未由 SSE 完整替代 renderer IPC。
- `src/main/index.ts` 仍直接依赖 `app`、`BrowserWindow`、`ipcMain`。
- `src/preload/**` 仍保留核心业务桥接。
- `electron-store` 尚未替换。

P1 未完成：

- API 反代 controller 尚未 HTTP 化。
- K-Proxy controller 尚未 HTTP 化。
- 注册 `ipc-handlers.ts` 尚未替换为 HTTP controller。
- Kiro 设置、MCP、Steering 文件操作尚未 HTTP 化。
- 机器码管理尚未 HTTP 化。
- 订阅、Webhook、诊断、配置同步尚未 HTTP 化。

P2 未完成：

- 删除 `electron-builder.yml`。
- 删除 `build/**` 桌面打包文件。
- 调整 `.github/workflows/build.yml`。
- 删除 Electron 运行时依赖。
- 调整 `package.json` 脚本。
- 浏览器 UI 迁移。

## 6. 下一步推荐顺序

下一刀建议做账号存储服务，不建议继续直接删 Electron。

原因：

- 账号管理是 P0 核心。
- 账号数据当前在 `electron-store`，带加密和备份逻辑。
- 不先抽 storage，后续删 Electron 时最容易丢数据。

推荐顺序：

1. 新建 `src/server/runtime/paths.ts`。
2. 新建 `src/server/storage/account-store.ts`。
3. 从 `src/main/index.ts` 抽出账号数据读取、保存、备份、迁移。
4. 保留旧 `electron-store` 读取能力，用于首次迁移。
5. 写最小 smoke test 或脚本验证账号数据可读写。
6. 再建立 `/api/accounts` 的只读/保存 controller。
7. 确认账号数据链路稳定后，再抽 Token 刷新和批量检查。

下一刀不要做：

- 不要直接删除 `src/preload/**`。
- 不要直接删除 `src/renderer/**`。
- 不要直接删除 `src/main/index.ts`。
- 不要删除 `electron` 依赖。
- 不要删除 `electron-builder.yml` 和 `build/**`，除非已经有 Node 服务构建入口和脚本。
- 不要运行 live integration probes，除非明确知道会访问外部 Kiro 服务。

## 7. 未来目标架构

目标目录形态：

```text
src/
  server/
    index.ts
    http/
      controllers/
      local-admin-server.ts
    runtime/
      paths.ts
      open-url.ts
      platform.ts
    storage/
      account-store.ts
      config-store.ts
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
    events.ts
  web/
    # 未来浏览器 UI，当前暂不实现
  shared/
    # 前后端共享类型
```

HTTP API 目标：

- `/api/health`
- `/api/events`
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
```

当前已验证过的命令：

```powershell
npm run typecheck:node
npm run typecheck:web
npx eslint src/server/events.ts src/server/http/local-admin-server.ts src/server/index.ts src/main/index.ts src/main/registration/ipc-handlers.ts --quiet
rg --line-number "webContents\.send" src\main src\server
rg --line-number "BrowserWindow" src\main\registration\ipc-handlers.ts src\server
```

当前验证结果：

- `npm run typecheck:node` 通过。
- `npm run typecheck:web` 通过。
- 上述目标 lint 通过。
- `webContents.send` 只剩 `src/main/index.ts` 的 `emitAppEvent()` 兼容桥内部一处。
- `src/main/registration/ipc-handlers.ts` 和 `src/server` 中没有 `BrowserWindow`。

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

- 重写中文 `README.md`，删除旧 `README_CN.md`。
- 修改 `docs/LOCAL-BROWSER-MIGRATION-PLAN.md`。
- 删除 `docs/` 下除本计划书以外的旧文档。
- 修改 `package.json` / `package-lock.json`，因为已移除 `electron-updater`。
- 修改 `src/main/index.ts`。
- 删除 `src/main/tray.ts`。
- 新增 `src/main/services/runtime/*`。
- 新增 `src/server/*`。
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

根目录 `README.md` 已重写为中文新项目说明，`README_CN.md` 已删除。`AGENTS.md`、`CLAUDE.md` 暂未删除，因为它们会影响工具规则、仓库入口说明和交接安全。

## 11. 交接提醒

接手人请牢记：

- 这不是简单删 Electron 项目。
- 当前的 `src/main/index.ts` 是业务和桌面外壳混在一起的集成 hub。
- 下一步优先抽账号存储和账号服务。
- 每抽出一个服务，再删对应 IPC。
- 每删一类 Electron 能力，都要跑 typecheck 和关键 `rg` 扫描。
- 账号管理、轮询查询、浏览器登录、代理、K-Proxy、注册、机器码是核心功能，不能为了删外壳而删功能。
