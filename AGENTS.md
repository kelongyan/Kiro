# AGENTS.md

## Scope

- Repository root is the actual Electron app root. Run Node, lint, typecheck, build, and packaging commands here.
- Root-level `README.md`, `README_CN.md`, and `.github/workflows/build.yml` now describe and build this root directly.

## Commands

- Install deps: `npm install`
- Dev app: `npm run dev`
- Preview built app: `npm run start`
- Lint: `npm run lint`
- Typecheck all: `npm run typecheck`
- Typecheck main/preload only: `npm run typecheck:node`
- Typecheck renderer only: `npm run typecheck:web`
- Full build: `npm run build`
- Unpacked build: `npm run build:unpack`
- Platform packages: `npm run build:win`, `npm run build:mac`, `npm run build:linux`

## Verification

- There is no JS unit test runner in `package.json`; do not claim tests passed unless you actually ran lint/typecheck/build or the manual scripts below.
- Normal code verification is `npm run lint` plus the narrowest relevant typecheck. `npm run build` already runs `npm run typecheck` first.
- `npm run test:e2e` and `npm run test:e2e:only` exist, but they are full integration tests against a running local proxy/app and at least one working account. See `docs/E2E-TESTING.md` before using them.
- `test/test_usage_api.py` and `test/test_kiro_apis.py` are live integration probes against external Kiro endpoints, not hermetic tests. They also contain hard-coded tokens in the repo, so avoid pasting them into output.
- `test/proxy-test.html` is a manual browser page for proxy checks.

## Architecture

- `src/main/index.ts` is the real integration hub. It owns app lifecycle, IPC handlers, Kiro API calls, auto-update wiring, tray behavior, proxy startup, K-Proxy startup, machine ID operations, and debounced `electron-store` writes.
- `src/preload/index.ts` exposes the renderer bridge as `window.api`. Renderer features that need desktop capabilities usually require a matching IPC handler in `src/main/index.ts` and a bridge method here.
- `src/renderer/src/App.tsx` wires page navigation, tray listeners, startup loading, and background refresh/check listeners.
- `src/renderer/src/store/accounts.ts` is the main renderer-side domain store for accounts, groups, tags, auto-refresh, auto-switch, proxy settings, theme/language, machine ID bindings, import/export, and persistence hooks.

## Repo-Specific Gotchas

- There are two separate proxy systems. `src/main/proxy/*` is the OpenAI/Claude-compatible local API proxy; `src/main/kproxy/*` is the MITM/device-ID proxy. Do not merge concepts or settings between them.
- Renderer aliases `@renderer/*` and `@/*` both resolve to `src/renderer/src/*` via `electron.vite.config.ts` and `tsconfig.web.json`.
- Packaging is driven by `electron-builder.yml`. Linux deb packages run `build/linux/after-install.sh` and `build/linux/after-remove.sh`.
- CI builds from the repo root with `npm ci`, then `npm run build`, then `electron-builder` per platform/arch. Linux `x64` builds all targets including `snap`; Linux ARM jobs only build `AppImage` and `deb`.

## Existing Instructions

- `CLAUDE.md` already contains useful repo notes. Keep this file and that one aligned if commands or architecture change.
