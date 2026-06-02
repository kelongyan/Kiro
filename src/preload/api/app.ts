import { ipcRenderer } from 'electron'

export const appApi = {
  openExternal: (url: string, usePrivateMode?: boolean): void => {
    ipcRenderer.send('open-external', url, usePrivateMode)
  },

  getAppVersion: (): Promise<string> => {
    return ipcRenderer.invoke('get-app-version')
  },

  onAuthCallback: (callback: (data: { code: string; state: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { code: string; state: string }): void => {
      callback(data)
    }
    ipcRenderer.on('auth-callback', handler)
    return () => {
      ipcRenderer.removeListener('auth-callback', handler)
    }
  }
}
