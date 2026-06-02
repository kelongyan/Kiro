import { ipcRenderer } from 'electron'

export const kiroSettingsApi = {
  getKiroSettings: (): Promise<{
    settings?: Record<string, unknown>
    mcpConfig?: { mcpServers: Record<string, unknown> }
    steeringFiles?: string[]
    error?: string
  }> => {
    return ipcRenderer.invoke('get-kiro-settings')
  },

  getKiroAvailableModels: (): Promise<{
    models: Array<{ id: string; name: string; description: string }>
    error?: string
  }> => {
    return ipcRenderer.invoke('get-kiro-available-models')
  },

  saveKiroSettings: (settings: Record<string, unknown>): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('save-kiro-settings', settings)
  },

  openKiroMcpConfig: (type: 'user' | 'workspace'): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('open-kiro-mcp-config', type)
  },

  openKiroSteeringFolder: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('open-kiro-steering-folder')
  },

  openKiroSettingsFile: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('open-kiro-settings-file')
  },

  openKiroSteeringFile: (filename: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('open-kiro-steering-file', filename)
  },

  createKiroDefaultRules: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('create-kiro-default-rules')
  },

  readKiroSteeringFile: (filename: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('read-kiro-steering-file', filename)
  },

  saveKiroSteeringFile: (filename: string, content: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('save-kiro-steering-file', filename, content)
  },

  deleteKiroSteeringFile: (filename: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('delete-kiro-steering-file', filename)
  },

  saveMcpServer: (name: string, config: { command: string; args?: string[]; env?: Record<string, string> }, oldName?: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('save-mcp-server', name, config, oldName)
  },

  deleteMcpServer: (name: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('delete-mcp-server', name)
  }
}
