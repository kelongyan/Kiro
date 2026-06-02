import { homedir, platform } from 'os'
import { join } from 'path'

let _dataDir: string | null = null

/**
 * 获取应用数据目录（纯 Node.js，不依赖 Electron）。
 *
 * - Windows: %APPDATA%\kiro-account-manager  (与 Electron app.getPath('userData') 一致)
 * - macOS:   ~/Library/Application Support/kiro-account-manager
 * - Linux:   $XDG_CONFIG_HOME/kiro-account-manager 或 ~/.config/kiro-account-manager
 */
export function getDataDir(): string {
  if (_dataDir) return _dataDir

  const home = homedir()

  switch (platform()) {
    case 'win32': {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
      _dataDir = join(appData, 'kiro-account-manager')
      break
    }
    case 'darwin': {
      _dataDir = join(home, 'Library', 'Application Support', 'kiro-account-manager')
      break
    }
    default: {
      const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config')
      _dataDir = join(xdgConfig, 'kiro-account-manager')
      break
    }
  }

  return _dataDir
}

/**
 * 覆盖数据目录（用于测试或自定义部署）。
 */
export function setDataDir(dir: string): void {
  _dataDir = dir
}

/**
 * 重置缓存，使下一次调用重新计算（用于测试）。
 */
export function resetDataDir(): void {
  _dataDir = null
}
