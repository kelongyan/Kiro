import { app } from 'electron'

export function getUserDataPath(): string {
  return app.getPath('userData')
}

export function getExecutablePath(): string {
  return app.getPath('exe')
}

export function getAppVersion(): string {
  return app.getVersion()
}
