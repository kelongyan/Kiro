# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

- Install deps: `npm install`
- Start Electron + renderer dev server: `npm run dev` (the script prefixes `chcp 65001` for Windows UTF-8; on macOS/Linux run `electron-vite dev` directly)
- Preview built app: `npm run start`
- Typecheck all TS: `npm run typecheck`
- Typecheck main/preload only: `npm run typecheck:node`
- Typecheck renderer only: `npm run typecheck:web`
- Lint: `npm run lint`
- Format: `npm run format`
- Build app: `npm run build`
- Build unpacked app: `npm run build:unpack`
- Build platform packages:
  - Windows: `npm run build:win`
  - macOS: `npm run build:mac`
  - Linux: `npm run build:linux`

## Testing

There is no unit-test runner. Verify code changes with `npm run lint` plus the narrowest relevant typecheck (`npm run typecheck:node` for main/preload, `npm run typecheck:web` for renderer); `npm run build` runs `npm run typecheck` first. Do not claim "tests pass" without actually running one of these.

### E2E proxy suite

`package.json` defines `npm run test:e2e` and `npm run test:e2e:only` (→ `node test/e2e-fullsuite/run.mjs`), an integration suite against the live API proxy. The old E2E document was removed during handoff cleanup, so inspect the runner path and `docs/LOCAL-BROWSER-MIGRATION-PLAN.md` before using these commands.

Prerequisites: the app running via `npm run dev`, the API proxy listening on `http://127.0.0.1:8787`, and at least one working (non-quota-exceeded) account.

Caution: `test/e2e-fullsuite/run.mjs` is currently absent from the working tree, so `npm run test:e2e` will fail until the runner is restored — confirm the path exists before relying on it.

### Manual / exploratory assets

- `test/test_usage_api.py` — compares Kiro REST vs CBOR usage APIs (`python test/test_usage_api.py`)
- `test/test_kiro_apis.py` — exercises Kiro model/subscription endpoints (`python test/test_kiro_apis.py`)
- `test/proxy-test.html` — manual browser page for proxy testing

The Python scripts hit live external Kiro endpoints and contain hard-coded tokens, so treat them as integration probes, not hermetic tests, and avoid echoing their contents.

## High-level architecture

This is an Electron desktop app built with `electron-vite`, with a React/Zustand renderer and a large TypeScript main-process backend.

### Repository layout & ongoing restructuring

The repository root is the actual app root (there is no longer a nested `Kiro-account-manager/` app folder). The current restructuring source of truth is `docs/LOCAL-BROWSER-MIGRATION-PLAN.md`. `src/main/index.ts` and `src/preload/index.ts` are still live transition files, while new service-boundary code is moving toward `src/server/*`, `src/main/services/*`, `src/preload/api/*`, `src/renderer/src/app/*`, and `src/renderer/src/features/*`. Do not re-introduce a `src/main/ipc/` scaffold without removing the old in-file handlers in the same pass; duplicate `ipcMain.handle` / `ipcMain.on` registration is the main hazard.

### Process split

- `src/main/index.ts` — transition main process entrypoint. Still owns app lifecycle, IPC handlers, persistence wiring, Kiro API calls, proxy/K-Proxy startup, and machine-id operations. Auto-updater, tray, global shortcut, and custom window IPC have already been removed.
- `src/preload/index.ts` — temporary context bridge exposing a large `window.api` surface. Renderer features should go through this bridge while the app is in Electron transition state. Newer domain APIs are composed in from `src/preload/api/*`; desktop-only `tray`, `update`, and `window` bridge files have already been removed.
- `src/renderer/src/*` — React UI.

### Renderer structure

- `src/renderer/src/App.tsx` drives page-level navigation, startup loading, and auto-refresh lifecycle. Tray event listeners have already been removed.
- `src/renderer/src/app/*` is the extracted navigation layer: `navigation.ts` (shared `PageType` + menu config, also read by `Sidebar.tsx`) and `page-registry.tsx` (the page switch table `App.tsx` used to own).
- `src/renderer/src/features/*` are currently thin facade `index.ts` files that re-export the real components from `components/pages/*` and `components/accounts/*`. Prefer importing pages through these facades; moving the implementations into the feature folders is still pending.
- `src/renderer/src/components/pages/*` holds the actual top-level pages: home, accounts, machineId, kiroSettings, proxy, kproxy, proxyPool, register, subscription, webhooks, diagnose, configSync, logs, settings, about.
- `src/renderer/src/components/accounts/*` is the main account-management UI.
- `src/renderer/src/store/*` holds the Zustand stores: `accounts.ts` is the core domain store (accounts/groups/tags, active account, filter/sort, auto-refresh, auto-switch, proxy settings, theme/language, machine-ID bindings/history, import/export, persistence hooks); `rateLimiter.ts`, `tasks.ts`, and `webhooks.ts` cover their respective features.
- `src/renderer/src/i18n/*` provides built-in `en`/`zh` translations via a Zustand-backed i18n store.

### Main-process backend responsibilities

`src/main/index.ts` is the monolithic integration hub and application service layer, being incrementally decomposed (see the restructuring note above; extracted helpers now live in `src/main/services/*`, e.g. `network/proxy-utils.ts`, `storage/backup.ts`, `kiro/settings-files.ts`). Important responsibilities include:

- Kiro auth flows for Builder ID, IAM Identity Center, and social providers
- account verification / token refresh
- reading and writing local Kiro credentials / config
- machine ID read/write and admin elevation handling
- proxy environment-variable management
- event publishing through `src/server/events.ts` plus temporary Electron renderer forwarding
- persistence of proxy counters/config through `electron-store`

When adding a renderer feature, there is usually a matching IPC handler added in `src/main/index.ts` and a bridge method added in `src/preload/index.ts`.

### Proxy subsystem

There are two distinct proxy systems:

#### 1. API compatibility proxy (`src/main/proxy/*`)

This is an HTTP/HTTPS local server that translates OpenAI/Claude-style requests into Kiro API calls.

- `proxyServer.ts` — local server, request routing, model caching, stats, token refresh coordination, TLS support, response translation
- `kiroApi.ts` — outbound calls to Kiro endpoints including model/subscription/token APIs
- `translator.ts` — request/response mapping between client formats and Kiro format
- `accountPool.ts` — multi-account round-robin, cooldown, quota/error backoff, availability tracking
- `logger.ts` — proxy log persistence

Important behavior: the proxy supports multi-account rotation, per-account cooldown/error tracking, token refresh before expiry, and persisted aggregate stats restored on startup.

#### 2. K-Proxy MITM layer (`src/main/kproxy/*`)

This is a separate MITM proxy used for Kiro traffic interception / device-ID related behavior.

- `index.ts` — service singleton and lifecycle
- `mitmProxy.ts` — MITM proxy runtime
- `certManager.ts` — CA generation/export/cache
- `types.ts` — config/stats/mapping types

`KProxyService` manages CA initialization, proxy start/stop, and account-to-device-ID mappings.

### Persistence model

There are two different persistence patterns to keep in mind:

- Renderer account/app state is managed in Zustand and persisted through preload/main IPC (`loadAccounts` / `saveAccounts`).
- Main-process proxy config/stat counters are persisted with `electron-store`, with debounced writes in `src/main/index.ts` to reduce disk I/O.

### Kiro settings integration

`src/renderer/src/components/pages/KiroSettingsPage.tsx` is the UI for editing Kiro IDE-related settings such as agent autonomy, model selection, MCP config, steering files, trusted commands/tools, and notifications. It relies on preload/main APIs to read and write Kiro-side config files instead of storing everything only in app state.

## Build/config notes

- `electron.vite.config.ts` defines the main/preload/renderer build, with renderer aliases `@renderer` and `@` both pointing to `src/renderer/src`.
- Packaging is configured in `electron-builder.yml`.
- Linux deb packaging runs `build/linux/after-install.sh` and `build/linux/after-remove.sh`.
- Desktop packaging still exists through `electron-builder.yml`, but Electron packaging is scheduled for removal in `docs/LOCAL-BROWSER-MIGRATION-PLAN.md`. `electron-updater` has already been removed.

## Repo-specific cautions

- `src/main/index.ts` is the central integration point; avoid scattering duplicate lifecycle or IPC logic elsewhere unless there is a clear existing pattern nearby.
- Changes to renderer capabilities often require coordinated edits in three places: `src/main/index.ts`, `src/preload/index.ts`, and the renderer caller.
- Proxy and K-Proxy are separate systems; do not conflate the OpenAI/Claude-compatible proxy with the MITM certificate-based K-Proxy.
- The Python files under `test/` are exploratory scripts against live services, not hermetic tests.
- A staged browserization restructuring is underway: read `docs/LOCAL-BROWSER-MIGRATION-PLAN.md` before structural edits, keep structural moves separate from behavior changes, and never re-add a `src/main/ipc/` scaffold without removing the old handlers in the same pass.
- `src/renderer/src/features/*` are re-export facades today, not real homes for logic yet — don't assume a feature is "owned" there.
- `.cursor/rules/mcp-messenger.mdc` is a Cursor-IDE-only MCP workflow rule (`check_messages` / `ask_question` / `send_progress`, and it forbids subagents). It does not apply to Claude Code and conflicts with this environment, so do not follow it here.
