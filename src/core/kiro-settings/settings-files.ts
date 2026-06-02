export interface KiroSettingsData {
  settings: Record<string, unknown>
  mcpConfig: { mcpServers: Record<string, unknown> }
  steeringFiles: string[]
}

export function getKiroPaths(homeDir: string): {
  kiroSettingsPath: string
  kiroSteeringPath: string
  kiroMcpUserPath: string
} {
  return {
    kiroSettingsPath: `${homeDir}\\AppData\\Roaming\\Kiro\\User\\settings.json`,
    kiroSteeringPath: `${homeDir}\\.kiro\\steering`,
    kiroMcpUserPath: `${homeDir}\\.kiro\\settings\\mcp.json`
  }
}

function cleanJsonLikeContent(content: string): string {
  return content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1')
}

export async function readKiroSettingsFiles(): Promise<KiroSettingsData> {
  const os = await import('os')
  const fs = await import('fs')

  const { kiroSettingsPath, kiroSteeringPath, kiroMcpUserPath } = getKiroPaths(os.homedir())

  let settings: Record<string, unknown> = {}
  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} }
  let steeringFiles: string[] = []

  if (fs.existsSync(kiroSettingsPath)) {
    const content = fs.readFileSync(kiroSettingsPath, 'utf-8')
    const parsed = JSON.parse(cleanJsonLikeContent(content))
    settings = {
      modelSelection: parsed['kiroAgent.modelSelection'],
      agentAutonomy: parsed['kiroAgent.agentAutonomy'],
      enableDebugLogs: parsed['kiroAgent.enableDebugLogs'],
      enableTabAutocomplete: parsed['kiroAgent.enableTabAutocomplete'],
      enableCodebaseIndexing: parsed['kiroAgent.enableCodebaseIndexing'],
      usageSummary: parsed['kiroAgent.usageSummary'],
      codeReferences: parsed['kiroAgent.codeReferences.referenceTracker'],
      configureMCP: parsed['kiroAgent.configureMCP'],
      trustedCommands: parsed['kiroAgent.trustedCommands'] || [],
      trustedTools: parsed['kiroAgent.trustedTools'] || {},
      commandDenylist: parsed['kiroAgent.commandDenylist'] || [],
      ignoreFiles: parsed['kiroAgent.ignoreFiles'] || [],
      mcpApprovedEnvVars: parsed['kiroAgent.mcpApprovedEnvVars'] || [],
      notificationsActionRequired: parsed['kiroAgent.notifications.agent.actionRequired'],
      notificationsFailure: parsed['kiroAgent.notifications.agent.failure'],
      notificationsSuccess: parsed['kiroAgent.notifications.agent.success'],
      notificationsBilling: parsed['kiroAgent.notifications.billing']
    }
  }

  if (fs.existsSync(kiroMcpUserPath)) {
    const mcpContent = fs.readFileSync(kiroMcpUserPath, 'utf-8')
    mcpConfig = JSON.parse(mcpContent)
  }

  if (fs.existsSync(kiroSteeringPath)) {
    const files = fs.readdirSync(kiroSteeringPath)
    steeringFiles = files.filter((file) => file.endsWith('.md'))
    console.log('[KiroSettings] Steering path:', kiroSteeringPath)
    console.log('[KiroSettings] Found steering files:', steeringFiles)
  } else {
    console.log('[KiroSettings] Steering path does not exist:', kiroSteeringPath)
  }

  return { settings, mcpConfig, steeringFiles }
}

export async function writeKiroSettingsFile(settings: Record<string, unknown>): Promise<void> {
  const os = await import('os')
  const fs = await import('fs')
  const path = await import('path')

  const { kiroSettingsPath } = getKiroPaths(os.homedir())

  let existingSettings: Record<string, unknown> = {}
  if (fs.existsSync(kiroSettingsPath)) {
    const content = fs.readFileSync(kiroSettingsPath, 'utf-8')
    existingSettings = JSON.parse(cleanJsonLikeContent(content))
  }

  const kiroSettings = {
    ...existingSettings,
    'kiroAgent.modelSelection': settings.modelSelection,
    'kiroAgent.agentAutonomy': settings.agentAutonomy,
    'kiroAgent.enableDebugLogs': settings.enableDebugLogs,
    'kiroAgent.enableTabAutocomplete': settings.enableTabAutocomplete,
    'kiroAgent.enableCodebaseIndexing': settings.enableCodebaseIndexing,
    'kiroAgent.usageSummary': settings.usageSummary,
    'kiroAgent.codeReferences.referenceTracker': settings.codeReferences,
    'kiroAgent.configureMCP': settings.configureMCP,
    'kiroAgent.trustedCommands': settings.trustedCommands,
    'kiroAgent.trustedTools': settings.trustedTools,
    'kiroAgent.commandDenylist': settings.commandDenylist,
    'kiroAgent.ignoreFiles': settings.ignoreFiles,
    'kiroAgent.mcpApprovedEnvVars': settings.mcpApprovedEnvVars,
    'kiroAgent.notifications.agent.actionRequired': settings.notificationsActionRequired,
    'kiroAgent.notifications.agent.failure': settings.notificationsFailure,
    'kiroAgent.notifications.agent.success': settings.notificationsSuccess,
    'kiroAgent.notifications.billing': settings.notificationsBilling
  }

  const dir = path.dirname(kiroSettingsPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(kiroSettingsPath, JSON.stringify(kiroSettings, null, 4))
}
