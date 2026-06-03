import { execSync } from 'child_process'
import { copyFileSync, existsSync, unlinkSync } from 'fs'
import { writeFile } from 'fs/promises'
import {
  generateDeviceId,
  getKProxyService,
  initKProxyService,
  isValidDeviceId,
  type CACertInfo,
  type DeviceIdMapping,
  type KProxyConfig,
  type KProxyEvents,
  type KProxyService as CoreKProxyService,
  type KProxyStats
} from '../../../core/kproxy'

export interface KProxyKeyValueStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface KProxyManagementServiceDeps {
  store?: KProxyKeyValueStore
  emitEvent?: (type: string, payload: unknown) => void
  chooseCaExportPath?: () => Promise<string | undefined>
}

export interface KProxyInitResult {
  success: boolean
  caInfo?: {
    certPath: string
    fingerprint: string
    validFrom: string
    validTo: string
  }
  error?: string
}

export interface KProxyStatusResult {
  running: boolean
  config: KProxyConfig | Partial<KProxyConfig> | null
  stats: KProxyStats | null
  caInfo: CACertInfo | null
  currentDeviceId?: string
  activeMapping?: DeviceIdMapping | null
}

export interface KProxySystemInfoResult {
  success: boolean
  platform: NodeJS.Platform
  caInstalled: boolean
  adminRecommended: boolean
  adminHint?: string
}

export class KProxyManagementService {
  private deps: KProxyManagementServiceDeps
  private mappingsLoaded = false

  constructor(deps: KProxyManagementServiceDeps = {}) {
    this.deps = deps
  }

  async initialize(): Promise<KProxyInitResult> {
    try {
      const service = this.ensureCoreService()
      const caInfo = await service.initialize()
      return { success: true, caInfo: this.summarizeCaInfo(caInfo) }
    } catch (error) {
      console.error('[KProxy] Init failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to init K-Proxy'
      }
    }
  }

  async autoStart(): Promise<{ started: boolean; success: boolean; error?: string }> {
    try {
      const savedConfig = this.getSavedConfig()
      if (!savedConfig?.autoStart) {
        return { started: false, success: true }
      }

      const service = this.ensureCoreService(savedConfig)
      await service.initialize()
      await service.start()
      this.saveConfig(service.getConfig())
      return { started: true, success: true }
    } catch (error) {
      console.error('[KProxy] Auto-start failed:', error)
      return {
        started: false,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to auto-start K-Proxy'
      }
    }
  }

  async start(
    config?: Partial<KProxyConfig>
  ): Promise<{ success: boolean; port?: number; error?: string }> {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      if (config) {
        service.updateConfig(config)
      }
      await service.start()
      this.saveConfig(service.getConfig())
      return { success: true, port: service.getConfig().port }
    } catch (error) {
      console.error('[KProxy] Start failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start K-Proxy'
      }
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      await getKProxyService()?.stop()
      return { success: true }
    } catch (error) {
      console.error('[KProxy] Stop failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop K-Proxy'
      }
    }
  }

  getStatus(): KProxyStatusResult {
    const service = getKProxyService()
    if (!service) {
      return {
        running: false,
        config: this.getSavedConfig(),
        stats: null,
        caInfo: null,
        currentDeviceId: this.getSavedConfig()?.deviceId,
        activeMapping: this.findActiveMapping(
          this.getSavedConfig()?.deviceId,
          this.getSavedMappings()
        )
      }
    }

    const mappings = service.getAllDeviceIdMappings()
    const currentDeviceId = service.getDeviceId()
    return {
      running: service.isRunning(),
      config: service.getConfig(),
      stats: service.getStats(),
      caInfo: service.getCACertInfo(),
      currentDeviceId,
      activeMapping: this.findActiveMapping(currentDeviceId, mappings)
    }
  }

  async restart(): Promise<{ success: boolean; port?: number; error?: string }> {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      await service.restart()
      this.saveConfig(service.getConfig())
      return { success: true, port: service.getConfig().port }
    } catch (error) {
      console.error('[KProxy] Restart failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restart K-Proxy'
      }
    }
  }

  updateConfig(config: Partial<KProxyConfig>): {
    success: boolean
    config?: KProxyConfig
    error?: string
  } {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      service.updateConfig(config)
      const newConfig = service.getConfig()
      this.saveConfig(newConfig)
      return { success: true, config: newConfig }
    } catch (error) {
      console.error('[KProxy] Update config failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update config'
      }
    }
  }

  setDeviceId(deviceId: string): { success: boolean; error?: string } {
    try {
      if (!isValidDeviceId(deviceId)) {
        return { success: false, error: 'Invalid device ID format (must be 64 hex characters)' }
      }
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      service.setDeviceId(deviceId)
      this.saveConfig(service.getConfig())
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set device ID'
      }
    }
  }

  generateDeviceId(): { success: boolean; deviceId: string } {
    return { success: true, deviceId: generateDeviceId() }
  }

  addDeviceMapping(mapping: DeviceIdMapping): { success: boolean; error?: string } {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      service.addDeviceIdMapping(mapping)
      this.saveMappings(service.getAllDeviceIdMappings())
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add mapping'
      }
    }
  }

  getDeviceMappings(): { success: boolean; mappings: DeviceIdMapping[] } {
    const service = getKProxyService()
    if (!service) {
      return { success: true, mappings: this.getSavedMappings() }
    }
    return { success: true, mappings: service.getAllDeviceIdMappings() }
  }

  switchToAccount(accountId: string): { success: boolean; error?: string } {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      const switched = service.switchToAccount(accountId)
      if (switched) {
        this.saveConfig(service.getConfig())
        this.saveMappings(service.getAllDeviceIdMappings())
      }
      return { success: switched, error: switched ? undefined : 'No device ID mapping for account' }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to switch account'
      }
    }
  }

  removeDeviceMapping(accountId: string): { success: boolean; error?: string } {
    try {
      const service = getKProxyService()
      if (service) {
        service.removeDeviceIdMapping(accountId)
        this.saveMappings(service.getAllDeviceIdMappings())
        return { success: true }
      }

      const mappings = this.getSavedMappings().filter((mapping) => mapping.accountId !== accountId)
      this.saveMappings(mappings)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove mapping'
      }
    }
  }

  getCaCert(): {
    success: boolean
    certPem?: string
    certPath?: string
    fingerprint?: string
    error?: string
  } {
    const service = getKProxyService()
    if (!service) {
      return { success: false, error: 'K-Proxy not initialized' }
    }
    const certPem = service.getCACertPem()
    const caInfo = service.getCACertInfo()
    if (!certPem || !caInfo) {
      return { success: false, error: 'CA certificate not available' }
    }
    return {
      success: true,
      certPem,
      certPath: caInfo.certPath,
      fingerprint: caInfo.fingerprint
    }
  }

  async exportCaCert(
    exportPath?: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      const certPem = service.getCACertPem()
      if (!certPem) {
        return { success: false, error: 'CA certificate not available' }
      }

      const targetPath = exportPath || (await this.deps.chooseCaExportPath?.())
      if (!targetPath) {
        return { success: false, error: 'Export cancelled' }
      }

      await writeFile(targetPath, certPem, 'utf-8')
      return { success: true, path: targetPath }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export certificate'
      }
    }
  }

  resetStats(): { success: boolean } {
    getKProxyService()?.resetStats()
    return { success: true }
  }

  async resetCaCert(): Promise<{
    success: boolean
    running?: boolean
    caInfo?: NonNullable<KProxyInitResult['caInfo']>
    error?: string
  }> {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      const caInfo = await service.resetCACertificate()
      this.saveConfig(service.getConfig())
      return {
        success: true,
        running: service.isRunning(),
        caInfo: this.summarizeCaInfo(caInfo)
      }
    } catch (error) {
      console.error('[KProxy] Reset CA cert failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset certificate'
      }
    }
  }

  async checkCaCertInstalled(): Promise<{ success: boolean; installed: boolean; error?: string }> {
    try {
      const platform = process.platform
      if (platform === 'win32') {
        try {
          const output = execSync('certutil -store -user Root "K-Proxy CA"', { encoding: 'utf-8' })
          return { success: true, installed: output.includes('K-Proxy CA') }
        } catch {
          return { success: true, installed: false }
        }
      }

      if (platform === 'darwin') {
        try {
          execSync(
            'security find-certificate -c "K-Proxy CA" ~/Library/Keychains/login.keychain-db',
            { encoding: 'utf-8' }
          )
          return { success: true, installed: true }
        } catch {
          return { success: true, installed: false }
        }
      }

      return {
        success: true,
        installed: existsSync('/usr/local/share/ca-certificates/kproxy-ca.crt')
      }
    } catch (error) {
      console.error('[KProxy] Check CA cert installed failed:', error)
      return {
        success: false,
        installed: false,
        error: error instanceof Error ? error.message : 'Check failed'
      }
    }
  }

  async installCaCert(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const service = getKProxyService()
      if (!service) {
        return { success: false, error: 'K-Proxy not initialized' }
      }
      const caInfo = service.getCACertInfo()
      if (!caInfo) {
        return { success: false, error: 'CA certificate not available' }
      }

      const platform = process.platform
      if (platform === 'win32') {
        try {
          execSync(`certutil -addstore -user Root "${caInfo.certPath}"`, { encoding: 'utf-8' })
          return { success: true, message: 'CA certificate installed to Windows certificate store' }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error)
          if (errMsg.includes('already in store') || errMsg.includes('已在存储中')) {
            return { success: true, message: 'CA certificate already installed' }
          }
          throw error
        }
      }

      if (platform === 'darwin') {
        execSync(
          `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db "${caInfo.certPath}"`
        )
        return { success: true, message: 'CA certificate installed to macOS Keychain' }
      }

      const targetPath = '/usr/local/share/ca-certificates/kproxy-ca.crt'
      copyFileSync(caInfo.certPath, targetPath)
      execSync('sudo update-ca-certificates')
      return { success: true, message: 'CA certificate installed to Linux CA store' }
    } catch (error) {
      console.error('[KProxy] Install CA cert failed:', error)
      return {
        success: false,
        error: this.formatCertificateError(error, 'install')
      }
    }
  }

  async uninstallCaCert(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const platform = process.platform
      if (platform === 'win32') {
        try {
          execSync('certutil -delstore -user Root "K-Proxy CA"', { encoding: 'utf-8' })
          return { success: true, message: 'CA certificate removed from Windows certificate store' }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error)
          if (errMsg.includes('not found') || errMsg.includes('找不到')) {
            return { success: true, message: 'CA certificate not found in store' }
          }
          throw error
        }
      }

      if (platform === 'darwin') {
        execSync(
          'security delete-certificate -c "K-Proxy CA" ~/Library/Keychains/login.keychain-db'
        )
        return { success: true, message: 'CA certificate removed from macOS Keychain' }
      }

      const targetPath = '/usr/local/share/ca-certificates/kproxy-ca.crt'
      if (existsSync(targetPath)) {
        unlinkSync(targetPath)
        execSync('sudo update-ca-certificates --fresh')
      }
      return { success: true, message: 'CA certificate removed from Linux CA store' }
    } catch (error) {
      console.error('[KProxy] Uninstall CA cert failed:', error)
      return {
        success: false,
        error: this.formatCertificateError(error, 'uninstall')
      }
    }
  }

  async getSystemInfo(): Promise<KProxySystemInfoResult> {
    const installedResult = await this.checkCaCertInstalled()
    const platform = process.platform
    return {
      success: installedResult.success,
      platform,
      caInstalled: installedResult.installed,
      adminRecommended: platform === 'win32' && installedResult.installed === false,
      adminHint:
        platform === 'win32'
          ? '默认为当前用户证书存储安装；若被系统策略拒绝，请以管理员身份重新运行后重试。'
          : platform === 'darwin'
            ? 'macOS 安装证书时可能要求钥匙串授权。'
            : 'Linux 安装证书通常需要 sudo 权限更新系统证书库。'
    }
  }

  async shutdown(): Promise<void> {
    await getKProxyService()?.stop()
  }

  private ensureCoreService(config?: Partial<KProxyConfig>): CoreKProxyService {
    const service =
      getKProxyService() ||
      initKProxyService(config || this.getSavedConfig() || {}, this.createEvents())
    this.loadSavedMappings(service)
    return service
  }

  private createEvents(): KProxyEvents {
    return {
      onRequest: (info): void => {
        this.deps.emitEvent?.('kproxy-request', info)
      },
      onResponse: (info): void => {
        this.deps.emitEvent?.('kproxy-response', info)
      },
      onError: (error): void => {
        console.error('[KProxy] Error:', error)
        this.deps.emitEvent?.('kproxy-error', error.message)
      },
      onStatusChange: (running, port): void => {
        this.deps.emitEvent?.('kproxy-status-change', { running, port })
      },
      onMitmIntercept: (host, modified): void => {
        this.deps.emitEvent?.('kproxy-mitm', { host, modified })
      }
    }
  }

  private getSavedConfig(): Partial<KProxyConfig> | null {
    return (this.deps.store?.get('kproxyConfig') as Partial<KProxyConfig> | undefined) || null
  }

  private saveConfig(config: KProxyConfig): void {
    this.deps.store?.set('kproxyConfig', config)
  }

  private getSavedMappings(): DeviceIdMapping[] {
    const mappings = this.deps.store?.get('kproxyDeviceMappings')
    return Array.isArray(mappings) ? (mappings as DeviceIdMapping[]) : []
  }

  private saveMappings(mappings: DeviceIdMapping[]): void {
    this.deps.store?.set('kproxyDeviceMappings', mappings)
  }

  private loadSavedMappings(service: CoreKProxyService): void {
    if (this.mappingsLoaded) return
    for (const mapping of this.getSavedMappings()) {
      service.addDeviceIdMapping(mapping)
    }
    this.mappingsLoaded = true
  }

  private summarizeCaInfo(caInfo: CACertInfo): NonNullable<KProxyInitResult['caInfo']> {
    return {
      certPath: caInfo.certPath,
      fingerprint: caInfo.fingerprint,
      validFrom: caInfo.validFrom.toISOString(),
      validTo: caInfo.validTo.toISOString()
    }
  }

  private findActiveMapping(
    currentDeviceId: string | undefined,
    mappings: DeviceIdMapping[]
  ): DeviceIdMapping | null {
    if (!currentDeviceId) return null
    return (
      mappings.find(
        (mapping) => mapping.deviceId.toLowerCase() === currentDeviceId.toLowerCase()
      ) || null
    )
  }

  private formatCertificateError(error: unknown, action: 'install' | 'uninstall'): string {
    const message =
      error instanceof Error
        ? error.message
        : action === 'install'
          ? 'Failed to install certificate'
          : 'Failed to uninstall certificate'
    if (process.platform !== 'win32') return message

    const lower = message.toLowerCase()
    if (
      lower.includes('denied') ||
      lower.includes('0x80070005') ||
      lower.includes('access is denied')
    ) {
      return `${message}。若 Windows 提示权限不足，请以管理员身份重新运行后再试。`
    }

    return `${message}。若被系统策略阻止，请以管理员身份重新运行后再试。`
  }
}
