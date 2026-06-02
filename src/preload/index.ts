import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  accountsApi,
  appApi,
  authApi,
  diagnosticsApi,
  kiroSettingsApi,
  kproxyApi,
  machineIdApi,
  proxyApi,
  registrationApi
} from './api'

const api = {
  ...appApi,
  ...accountsApi,
  ...authApi,
  ...diagnosticsApi,
  ...kiroSettingsApi,
  ...kproxyApi,
  ...machineIdApi,
  ...proxyApi,
  ...registrationApi
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
