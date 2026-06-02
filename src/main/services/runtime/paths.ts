import { createRequire } from 'module'
import type { App } from 'electron'
import { getDataDir } from '../../../server/runtime/paths'

const requireModule = createRequire(import.meta.url)

function getElectronApp(): App | null {
  try {
    const electron = requireModule('electron') as { app?: App }
    return electron.app || null
  } catch {
    return null
  }
}

export function getUserDataPath(): string {
  try {
    const app = getElectronApp()
    if (app?.isReady()) {
      return app.getPath('userData')
    }
  } catch {
    // standalone Node runtime falls back to the server data dir
  }
  return getDataDir()
}

export function getExecutablePath(): string {
  try {
    const app = getElectronApp()
    if (app?.isReady()) {
      return app.getPath('exe')
    }
  } catch {
    // standalone Node runtime falls back to process.execPath
  }
  return process.execPath
}

export function getAppVersion(): string {
  try {
    const app = getElectronApp()
    if (app?.isReady()) {
      return app.getVersion()
    }
  } catch {
    // standalone Node runtime has no Electron app version
  }
  return '0.0.0'
}
