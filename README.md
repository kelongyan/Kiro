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
- `docs/` 目录已清理为单一交接计划书。

仍未完成：

- 账号、登录、代理、注册、机器码等核心业务还没有迁成 REST/SSE API。
- 当前 UI 仍依赖 Electron preload 和 IPC。
- 新浏览器后台 UI 暂未实现。
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
    events.ts                 # 新增事件总线
    http/
      local-admin-server.ts   # 新增本地管理服务骨架
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

下一步优先抽账号存储和账号服务，而不是继续大面积删除 Electron。

## 当前命令

安装依赖：

```powershell
npm install
```

当前过渡态开发运行：

```powershell
npm run dev
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
- 后续需要改成启动本地 Node 服务和浏览器管理后台。

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
- 修改机器码管理员权限流程。
- 修改事件发送为事件总线 + Electron 临时兼容桥。

所有这些都属于同一轮“本地浏览器化重构交接”工作，不要在未理解前只回滚其中一部分。

## 当前下一步

推荐下一刀：

1. 新建 `src/server/runtime/paths.ts`。
2. 新建 `src/server/storage/account-store.ts`。
3. 从 `src/main/index.ts` 抽出账号读取、保存、备份和旧数据迁移。
4. 建立 `/api/accounts` 的最小只读/保存 controller。
5. 确认账号数据链路稳定后，再抽 Token 刷新和批量检查。

完成这些后，再继续删除对应 Electron IPC。
