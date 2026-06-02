import { readFileSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../../server/runtime/paths'

let cachedVersion: string | null = null

export function getUserDataPath(): string {
  return getDataDir()
}

export function getExecutablePath(): string {
  return process.execPath
}

export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion

  try {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
      version?: string
    }
    cachedVersion = packageJson.version || '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }

  return cachedVersion
}
