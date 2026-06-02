# Restructuring Plan

## Purpose

This document records the repository restructuring plan, what has already been completed, what was attempted and rolled back, and the remaining work for future sessions.

The goal is to reduce structural confusion first, then split responsibilities without changing behavior unless a step explicitly calls for it.

## High-Level Goals

- Make the repository root the real application root.
- Remove duplicated repo-vs-app documentation and config layers.
- Shrink `src/main/index.ts` from a monolithic integration file into an app bootstrap plus domain IPC/service modules.
- Split preload APIs by domain instead of growing a single giant `window.api` implementation.
- Move renderer structure toward feature ownership instead of page-folder sprawl plus oversized global stores.

## Guiding Rules

- Prefer the smallest safe structural step.
- Do not mix structural moves with feature work.
- After each phase, verify the narrowest relevant commands before moving on.
- If a partial refactor leaves duplicate runtime registrations or broken imports, revert that partial work before handing off.

## Current Status

- Phase 1 is complete in the working tree.
- Phase 2 was started briefly with an IPC scaffold, then rolled back because the old registrations had not yet been safely removed and that would have created duplicate IPC handler registration risk.
- Phase 3 is partially complete: several low-risk service helpers have already moved out of `src/main/index.ts` into `src/main/services/*` and are now used by the main process.
- Phase 4 is runtime-complete: `src/preload/index.ts` only composes domain APIs from `src/preload/api/*`; type declaration splitting is still pending.
- Phase 5 is partially complete: renderer app/navigation/page assembly now has dedicated `app/` files and `features/` facade entrypoints, but the real implementations still largely live under the old component directories.
- The repository is currently in a stable “Phase 1 complete, later phases partially started” state.

## Completed Work

### Phase 1: Flatten Repository Root

- [x] Promoted the real Electron app from `Kiro-account-manager/` to the repository root.
- [x] Moved tracked app content to the root:
`src/`, `resources/`, `build/`, `test/`, `.kiro/`, `.vscode/`, `package.json`, `package-lock.json`, `electron-builder.yml`, `electron.vite.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.editorconfig`, `.prettierignore`, `.prettierrc.yaml`.
- [x] Kept the root `README.md` and `README_CN.md` as the canonical docs, and updated their image/resource paths to root-relative paths.
- [x] Kept the root `LICENSE` and removed the empty inner `LICENSE` file.
- [x] Moved inner tracked docs into the root `docs/` directory.
- [x] Moved local-only instruction/context files to the root:
`CLAUDE.md`, `.claude/`, `docs/项目特性与架构总结.md`.
- [x] Updated `.github/workflows/build.yml` so CI treats the repository root as the working directory.
- [x] Updated `AGENTS.md` so it describes the root as the actual app root.
- [x] Merged inner `.gitignore` rules into the root `.gitignore` and removed obsolete nested-path ignores.
- [x] Removed all verified `Kiro-account-manager/` path references from repository docs/config that should now point at the root.
- [x] Removed the obsolete empty nested app directory.

### Phase 3: Main-Process Service Boundary Cleanup

- [x] Extracted proxy/network helper logic into `src/main/services/network/proxy-utils.ts`:
`getRestApiBase`, `getFallbackRestApiBase`, `normalizeProxyUrl`, `fetchWithAppProxy`.
- [x] Extracted backup throttling logic into `src/main/services/storage/backup.ts` via `createBackupController(...)`.
- [x] Extracted Kiro local settings read/write logic into `src/main/services/kiro/settings-files.ts`.
- [x] Updated `src/main/index.ts` to consume those new services instead of keeping the helper implementations inline.
- [x] Added a local `fetchWithAppProxy(...)` wrapper in `src/main/index.ts` so the extracted helper still receives the main-process proxy-agent providers.

### Phase 4: Preload Domain Split

- [x] Added `src/preload/api/` as the new preload composition boundary.
- [x] Extracted low-coupling preload implementations into:
`src/preload/api/app.ts`, `src/preload/api/update.ts`, `src/preload/api/kiro-settings.ts`.
- [x] Added `src/preload/api/index.ts` as the aggregation entrypoint.
- [x] Extracted the remaining preload runtime groups into `src/preload/api/*`:
`accounts`, `auth`, `diagnostics`, `machine-id`, `proxy`, `kproxy`, `registration`, `tray`, `window`.
- [x] Updated `src/preload/index.ts` to compose `window.api` from spread-in domain objects for all runtime groups.
- [ ] Split declaration types out of `src/preload/index.d.ts` into domain-specific type files.

### Phase 5: Renderer Feature Ownership

- [x] Added `src/renderer/src/app/navigation.ts` for shared `PageType` and menu configuration.
- [x] Added `src/renderer/src/app/page-registry.tsx` so `App.tsx` no longer owns the page switch table directly.
- [x] Updated `Sidebar.tsx` to read navigation metadata from `app/navigation.ts`.
- [x] Aligned `src/renderer/src/components/layout/index.ts` to re-export `PageType` from `app/navigation.ts`.
- [x] Added initial `src/renderer/src/features/*` facade entrypoints for major renderer domains.
- [ ] Move actual implementations from `components/pages/*`, `components/accounts/*`, and adjacent old locations into feature-owned folders.
- [ ] Split `App.tsx` side effects into dedicated `app/effects/*` modules.
- [ ] Split oversized renderer stores into feature-owned stores or slices.

## Validation Performed

- [x] Verified the new root directory layout after flattening.
- [x] Verified CI now uses `WORKING_DIR: .`.
- [x] Verified `package.json` scripts now live at the repository root.
- [x] Verified `AGENTS.md` and root docs reflect the flattened layout.
- [ ] Full dependency install with lifecycle scripts succeeded.
- [x] Dependency toolchain install succeeded with `npm install --ignore-scripts`.
- [x] `npm run typecheck:node` succeeded from the root.
- [x] `npm run typecheck:web` succeeded from the root.
- [x] Targeted ESLint check for changed TypeScript files succeeded with `eslint --quiet`.
- [ ] Full `npm run lint` succeeded from the root.

## Validation Blockers Encountered

- `npm install` was attempted from the new root.
- Full install still fails during the `electron` binary download step because this environment cannot resolve the configured download hosts (`github.com`; mirror retry also failed on `npmmirror.com`).
- `npm install --ignore-scripts` succeeds and provides the TypeScript/ESLint toolchain, but it intentionally skips Electron binary download and postinstall lifecycle scripts.
- Full `npm run lint` still fails on repo-wide Prettier CRLF warnings; targeted ESLint on the changed TypeScript files succeeds.
- This blocker is environmental/repo-format related, not a verified import-path regression from the restructuring work.

## Work Explicitly Rolled Back

### Aborted Phase 2 Attempt

- A new `src/main/ipc/` scaffold was created briefly.
- A new `registerShellWindowIpc(...)` entrypoint was injected into `src/main/index.ts`.
- The old in-file IPC registrations were not yet safely removed.
- That state would have risked duplicate registration of the same IPC channels.
- The scaffold and injection were rolled back before handoff.

Current truth:

- `src/main/ipc/` does not exist in the final handoff state.
- `src/main/index.ts` remains the single source of runtime IPC registration today.

## Remaining Plan

### Phase 2: Main-Process IPC Extraction

Goal:

- Turn `src/main/index.ts` into an app bootstrap/orchestrator instead of the place where every IPC handler is directly implemented.

Target structure:

```text
src/main/
  index.ts
  ipc/
    index.ts
    shell-window.ts
    tray.ts
    updates.ts
    accounts.ts
    proxy.ts
    kproxy.ts
    kiro-settings.ts
    machine-id.ts
    diagnostics.ts
    registration.ts
```

Execution order:

- [ ] Start with low-coupling IPC groups only.
- [ ] Extract one small group into `src/main/ipc/*.ts`.
- [ ] Remove the old in-file handlers for that same group immediately.
- [ ] Grep for each moved channel to confirm only one registration remains.
- [ ] Repeat group by group.

Recommended group order:

- [ ] `open-external`, window titlebar controls, app version, show-window shortcut.
- [ ] tray settings and tray event bridge handlers.
- [ ] updater handlers.
- [ ] diagnostics handlers.
- [ ] account import/export and storage handlers.
- [ ] auth/login flows.
- [ ] proxy handlers.
- [ ] kproxy handlers.
- [ ] kiro settings file handlers.

Success criteria:

- `src/main/index.ts` still owns startup and shared state wiring.
- Each extracted IPC group has one registration site only.
- No duplicate `ipcMain.handle` or `ipcMain.on` channel definitions remain.

### Phase 3: Main-Process Service Boundary Cleanup

Goal:

- Move business logic further out of `src/main/index.ts` after IPC registration has already been split.

Target direction:

```text
src/main/
  app/
  ipc/
  services/
    proxy/
    kproxy/
    registration/
    accounts/
    machine-id/
    kiro-settings/
```

Execution order:

- [ ] Extract pure helper logic first.
- [ ] Extract service functions next.
- [ ] Leave app lifecycle and composition in `src/main/index.ts` until the end.

Progress now:

- [x] Extract pure helper logic first.
- [~] Extract service functions next.
- [ ] Leave app lifecycle and composition in `src/main/index.ts` until the end.

Remaining high-value Phase 3 targets:

- [ ] Move more Kiro settings / MCP / steering file operations into `src/main/services/kiro/*`.
- [ ] Move diagnostics/probe logic into `src/main/services/diagnostics/*`.
- [ ] Move machine-id dialog/file orchestration into `src/main/services/machine-id/*`.
- [ ] Move proxy admin/support helpers into `src/main/services/proxy/*` without touching IPC registration yet.

### Phase 4: Preload Domain Split

Goal:

- Keep `window.api` as the public surface if desired, but stop implementing it in one giant file.

Target direction:

```text
src/preload/
  index.ts
  api/
    app.ts
    accounts.ts
    proxy.ts
    kproxy.ts
    machine-id.ts
    kiro-settings.ts
    registration.ts
    diagnostics.ts
  types/
    shared.ts
    accounts.ts
    proxy.ts
    registration.ts
```

Execution order:

- [x] Split APIs by domain first.
- [ ] Split type declarations second.
- [x] Keep `index.ts` as a thin composer.

Progress now:

- [x] Split APIs by domain first.
- [ ] Split type declarations second.
- [x] Keep `index.ts` as a thin composer.

Remaining Phase 4 targets:

- [ ] Begin shrinking `src/preload/index.d.ts` by introducing domain type files.

### Phase 5: Renderer Feature Ownership

Goal:

- Move from page sprawl and oversized store ownership to feature-based ownership.

Target direction:

```text
src/renderer/src/
  app/
  features/
    accounts/
    proxy/
    kproxy/
    registration/
    subscriptions/
    webhooks/
    diagnostics/
    settings/
    machine-id/
    kiro-config/
  shared/
```

Execution order:

- [ ] Extract navigation metadata from `App.tsx`.
- [ ] Move one feature at a time.
- [ ] Split global side effects from `App.tsx` into `app/effects/*`.
- [ ] Break oversized renderer stores into feature stores or slices.

Progress now:

- [x] Extract navigation metadata from `App.tsx`.
- [~] Move one feature at a time.
- [ ] Split global side effects from `App.tsx` into `app/effects/*`.
- [ ] Break oversized renderer stores into feature stores or slices.

Remaining Phase 5 targets:

- [ ] Turn `features/accounts` from a facade into a real feature-owned folder.
- [ ] Do the same for `features/proxy` and `features/kiro-settings` next.
- [ ] Migrate remaining page-level features after those domains are stable.

## Recommended Next Session

If a future session picks this up, do this first:

1. Retry dependency installation from the repository root.
2. Run `npm run typecheck:node`.
3. Run `npm run typecheck:web`.
4. Run `npm run lint`.
5. Decide whether to finish Phase 2 first or continue incremental Phase 3/4/5 work.

Recommended next priority order:

1. Split `src/preload/index.d.ts` into domain-specific type declarations to finish Phase 4 completely.
2. Continue Phase 5 by turning `features/accounts` and `features/proxy` into real feature-owned folders.
3. After that, resume Phase 2 only if there is bandwidth to remove old IPC registrations in the same session they are extracted.
4. If resuming Phase 2, verify with `grep "ipcMain\.(handle|on)\(" src/main/index.ts` and targeted channel searches.

## Risks To Watch

- Duplicate IPC registration if new modules are added before old handlers are removed.
- Hidden path assumptions in docs or CI after flattening.
- Large-file patching mistakes in `src/main/index.ts` because repeated patterns are hard to target safely.
- Mixing behavior changes into structural edits.
- Treating manual integration probes as unit tests.

## Handoff Notes

- The most important finished milestone is the root flattening.
- The most important unfinished hotspot remains `src/main/index.ts`.
- `src/main/services/`, `src/preload/api/`, `src/renderer/src/app/`, and `src/renderer/src/features/` now exist and should be treated as the preferred landing zones for future restructuring work.
- Do not resume the aborted IPC extraction by re-adding a scaffold and leaving old handlers in place.
- Extract one IPC cluster at a time and delete the old cluster in the same session.
