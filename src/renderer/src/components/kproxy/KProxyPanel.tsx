import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  Download,
  Fingerprint,
  Key,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  Square,
  Trash2,
  UserRound
} from 'lucide-react'
import {
  kproxyAddDeviceMapping,
  kproxyCheckCaCertInstalled,
  kproxyExportCaCert,
  kproxyGenerateDeviceId,
  kproxyGetDeviceMappings,
  kproxyGetStatus,
  kproxyGetSystemInfo,
  kproxyInit,
  kproxyInstallCaCert,
  kproxyRemoveDeviceMapping,
  kproxyResetCaCert,
  kproxyRestart,
  kproxySetDeviceId,
  kproxyStart,
  kproxyStop,
  kproxySwitchToAccount,
  kproxyUninstallCaCert,
  kproxyUpdateConfig,
  type CACertInfo,
  type DeviceIdMapping,
  type KProxyConfig,
  type KProxyStats,
  type KProxySystemInfo
} from '../../services/local-admin-kproxy'
import { onLocalAdminEvent } from '../../services/local-admin-events'
import { useTranslation } from '../../hooks/useTranslation'
import { useAccountsStore } from '../../store/accounts'
import { cn } from '../../lib/utils'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch
} from '../ui'

interface TrafficLogItem {
  requestId: string
  timestamp: number
  method: string
  host: string
  path: string
  isMitm: boolean
  deviceIdReplaced: boolean
  statusCode: number
  duration: number
}

const DEFAULT_CONFIG: KProxyConfig = {
  enabled: false,
  port: 8899,
  host: '127.0.0.1',
  mitmDomains: ['amazonaws.com', 'amazon.com', 'kiro.dev'],
  autoStart: false,
  logRequests: true
}

function isValidDeviceId(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

export function KProxyPanel() {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const activeAccountId = useAccountsStore((state) => state.activeAccountId)
  const accounts = useAccountsStore((state) => state.accounts)

  const [isRunning, setIsRunning] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [config, setConfig] = useState<KProxyConfig>(DEFAULT_CONFIG)
  const [deviceIdDraft, setDeviceIdDraft] = useState('')
  const [stats, setStats] = useState<KProxyStats | null>(null)
  const [caInfo, setCaInfo] = useState<CACertInfo | null>(null)
  const [systemInfo, setSystemInfo] = useState<KProxySystemInfo | null>(null)
  const [mappings, setMappings] = useState<DeviceIdMapping[]>([])
  const [activeMapping, setActiveMapping] = useState<DeviceIdMapping | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedProxy, setCopiedProxy] = useState(false)
  const [copiedDeviceId, setCopiedDeviceId] = useState(false)
  const [recentTraffic, setRecentTraffic] = useState<TrafficLogItem[]>([])

  const activeAccount = activeAccountId ? (accounts.get(activeAccountId) ?? null) : null

  const refreshState = useCallback(async (): Promise<void> => {
    const [status, mappingsResult, systemResult, installedResult] = await Promise.all([
      kproxyGetStatus(),
      kproxyGetDeviceMappings(),
      kproxyGetSystemInfo(),
      kproxyCheckCaCertInstalled()
    ])

    const nextConfig = ((status.config as KProxyConfig | null) || DEFAULT_CONFIG) as KProxyConfig
    setConfig({ ...DEFAULT_CONFIG, ...nextConfig })
    setDeviceIdDraft(status.currentDeviceId || nextConfig.deviceId || '')
    setStats((status.stats as KProxyStats | null) || null)
    setCaInfo((status.caInfo as CACertInfo | null) || null)
    setIsRunning(status.running)
    setActiveMapping((status.activeMapping as DeviceIdMapping | null) || null)
    setMappings(mappingsResult.mappings || [])
    setSystemInfo({
      ...systemResult,
      caInstalled: installedResult.installed
    })
  }, [])

  const initKProxy = useCallback(async (): Promise<void> => {
    setIsBusy(true)
    setError(null)
    try {
      const result = await kproxyInit()
      if (!result.success) {
        setError(result.error || (isEn ? 'Failed to initialize K-Proxy' : '初始化 K-Proxy 失败'))
        return
      }
      setIsInitialized(true)
      await refreshState()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsBusy(false)
    }
  }, [isEn, refreshState])

  useEffect(() => {
    void initKProxy()
  }, [initKProxy])

  useEffect(() => {
    const unsubscribeResponse = onLocalAdminEvent('kproxy-response', ({ payload }) => {
      setRecentTraffic((prev) =>
        [
          {
            requestId: payload.requestId,
            timestamp: payload.timestamp,
            method: payload.method,
            host: payload.host,
            path: payload.path,
            isMitm: payload.isMitm,
            deviceIdReplaced: payload.deviceIdReplaced,
            statusCode: payload.statusCode,
            duration: payload.duration
          },
          ...prev
        ].slice(0, 50)
      )
    })

    const unsubscribeStatus = onLocalAdminEvent('kproxy-status-change', ({ payload }) => {
      setIsRunning(payload.running)
    })

    const unsubscribeError = onLocalAdminEvent('kproxy-error', ({ payload }) => {
      setError(payload)
    })

    return () => {
      unsubscribeResponse()
      unsubscribeStatus()
      unsubscribeError()
    }
  }, [])

  useEffect(() => {
    if (!activeAccountId) return

    let cancelled = false
    void (async () => {
      try {
        const result = await kproxySwitchToAccount(activeAccountId)
        if (!cancelled && result.success) {
          await refreshState()
        }
      } catch {
        // Ignore best-effort sync failures here; store-level logging already exists.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeAccountId, refreshState])

  async function withBusy<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (isBusy) return undefined
    setIsBusy(true)
    setError(null)
    try {
      return await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    } finally {
      setIsBusy(false)
    }
  }

  async function saveConfig(updates: Partial<KProxyConfig>): Promise<void> {
    const next = { ...config, ...updates }
    setConfig(next)
    await withBusy(async () => {
      const updateResult = await kproxyUpdateConfig(updates as KProxyConfig)
      if (!updateResult.success) {
        throw new Error(updateResult.error || 'Failed to update config')
      }
      await refreshState()
    })
  }

  async function toggleProxy(): Promise<void> {
    await withBusy(async () => {
      const result = isRunning ? await kproxyStop() : await kproxyStart(config)
      if (!result.success) {
        throw new Error(result.error || (isRunning ? 'Failed to stop' : 'Failed to start'))
      }
      await refreshState()
    })
  }

  async function restartProxy(): Promise<void> {
    await withBusy(async () => {
      const result = await kproxyRestart()
      if (!result.success) {
        throw new Error(result.error || 'Failed to restart')
      }
      await refreshState()
    })
  }

  async function applyDeviceId(): Promise<void> {
    const nextId = deviceIdDraft.trim()
    if (!isValidDeviceId(nextId)) {
      setError(isEn ? 'Device ID must be 64 hex characters' : '设备 ID 必须是 64 位十六进制')
      return
    }
    if (
      !window.confirm(
        isEn
          ? 'Apply this device ID to K-Proxy traffic now?'
          : '现在将这个设备 ID 应用到 K-Proxy 流量中吗？'
      )
    ) {
      return
    }

    await withBusy(async () => {
      const result = await kproxySetDeviceId(nextId)
      if (!result.success) {
        throw new Error(result.error || 'Failed to set device ID')
      }
      await refreshState()
    })
  }

  async function generateDeviceIdDraft(): Promise<void> {
    await withBusy(async () => {
      const result = await kproxyGenerateDeviceId()
      if (!result.success || !result.deviceId) {
        throw new Error(result.error || 'Failed to generate device ID')
      }
      setDeviceIdDraft(result.deviceId)
    })
  }

  async function bindActiveAccount(): Promise<void> {
    if (!activeAccountId || !activeAccount) {
      setError(isEn ? 'No active account selected' : '当前没有激活账号')
      return
    }
    if (!config.deviceId || !isValidDeviceId(config.deviceId)) {
      setError(isEn ? 'Apply a valid device ID first' : '请先应用有效的设备 ID')
      return
    }

    await withBusy(async () => {
      const result = await kproxyAddDeviceMapping({
        accountId: activeAccountId,
        deviceId: config.deviceId || '',
        description: activeAccount.email,
        createdAt: Date.now()
      })
      if (!result.success) {
        throw new Error(result.error || 'Failed to bind device mapping')
      }
      await refreshState()
    })
  }

  async function activateMapping(accountId: string): Promise<void> {
    await withBusy(async () => {
      const result = await kproxySwitchToAccount(accountId)
      if (!result.success) {
        throw new Error(result.error || 'Failed to switch mapping')
      }
      await refreshState()
    })
  }

  async function removeMapping(accountId: string): Promise<void> {
    if (
      !window.confirm(isEn ? 'Delete this device mapping?' : '确定删除这个 device mapping 吗？')
    ) {
      return
    }

    await withBusy(async () => {
      const result = await kproxyRemoveDeviceMapping(accountId)
      if (!result.success) {
        throw new Error(result.error || 'Failed to remove mapping')
      }
      await refreshState()
    })
  }

  async function installCertificate(): Promise<void> {
    if (
      !window.confirm(
        isEn
          ? 'Install the K-Proxy CA certificate into the system trust store?'
          : '确定把 K-Proxy CA 证书安装到系统信任存储吗？'
      )
    ) {
      return
    }

    await withBusy(async () => {
      const result = await kproxyInstallCaCert()
      if (!result.success) {
        throw new Error(result.error || 'Failed to install certificate')
      }
      await refreshState()
    })
  }

  async function uninstallCertificate(): Promise<void> {
    if (
      !window.confirm(
        isEn
          ? 'Remove the K-Proxy CA certificate from the system trust store?'
          : '确定从系统信任存储中卸载 K-Proxy CA 证书吗？'
      )
    ) {
      return
    }

    await withBusy(async () => {
      const result = await kproxyUninstallCaCert()
      if (!result.success) {
        throw new Error(result.error || 'Failed to uninstall certificate')
      }
      await refreshState()
    })
  }

  async function resetCertificate(): Promise<void> {
    if (
      !window.confirm(
        isEn
          ? 'Reset and regenerate the K-Proxy CA certificate?'
          : '确定重置并重新生成 K-Proxy CA 证书吗？'
      )
    ) {
      return
    }

    await withBusy(async () => {
      const result = await kproxyResetCaCert()
      if (!result.success) {
        throw new Error(result.error || 'Failed to reset certificate')
      }
      await refreshState()
    })
  }

  async function exportCertificate(): Promise<void> {
    await withBusy(async () => {
      const result = await kproxyExportCaCert()
      if (!result.success) {
        throw new Error(result.error || 'Failed to export certificate')
      }
    })
  }

  function copyProxyAddress(): void {
    void navigator.clipboard.writeText(`${config.host}:${config.port}`)
    setCopiedProxy(true)
    window.setTimeout(() => setCopiedProxy(false), 1500)
  }

  function copyCurrentDeviceId(): void {
    if (!config.deviceId) return
    void navigator.clipboard.writeText(config.deviceId)
    setCopiedDeviceId(true)
    window.setTimeout(() => setCopiedDeviceId(false), 1500)
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString()
  }

  if (!isInitialized && isBusy) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">
          {isEn ? 'Initializing K-Proxy...' : '正在初始化 K-Proxy...'}
        </p>
      </div>
    )
  }

  if (!isInitialized) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="max-w-md text-center text-sm text-destructive">
          {error || (isEn ? 'K-Proxy is not initialized yet.' : 'K-Proxy 还没有完成初始化。')}
        </p>
        <Button onClick={() => void initKProxy()} disabled={isBusy}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {isEn ? 'Retry' : '重试'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2"
            onClick={() => setError(null)}
          >
            x
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">K-Proxy MITM</CardTitle>
              <Badge
                variant={isRunning ? 'default' : 'secondary'}
                className={cn(isRunning && 'bg-green-600 hover:bg-green-600')}
              >
                {isRunning ? (isEn ? 'Running' : '运行中') : isEn ? 'Stopped' : '已停止'}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={isBusy} onClick={restartProxy}>
                <RefreshCw className="mr-1 h-4 w-4" />
                {isEn ? 'Restart' : '重启'}
              </Button>
              <Button
                size="sm"
                variant={isRunning ? 'destructive' : 'default'}
                disabled={isBusy}
                onClick={toggleProxy}
              >
                {isRunning ? (
                  <>
                    <Square className="mr-1 h-4 w-4" />
                    {isEn ? 'Stop' : '停止'}
                  </>
                ) : (
                  <>
                    <Play className="mr-1 h-4 w-4" />
                    {isEn ? 'Start' : '启动'}
                  </>
                )}
              </Button>
            </div>
          </div>
          <CardDescription>
            {isEn
              ? 'Inspect, switch, and protect K-Proxy traffic in one place.'
              : '把 K-Proxy 的启动、证书、映射和 MITM 流量排障收在一个面板里。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{isEn ? 'Proxy:' : '代理地址：'}</span>
            <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
              {config.host}:{config.port}
            </code>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copyProxyAddress}>
              {copiedProxy ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{isEn ? 'Port' : '端口'}</Label>
              <Input
                type="number"
                value={config.port ?? 8899}
                disabled={isBusy || isRunning}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    port: Number(event.target.value) || 8899
                  }))
                }
                onBlur={() => void saveConfig({ port: config.port })}
              />
            </div>
            <div className="space-y-2">
              <Label>{isEn ? 'Host' : '监听地址'}</Label>
              <Input
                value={config.host ?? '127.0.0.1'}
                disabled={isBusy || isRunning}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    host: event.target.value
                  }))
                }
                onBlur={() => void saveConfig({ host: config.host })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>{isEn ? 'Log Requests' : '记录请求日志'}</Label>
              <p className="text-xs text-muted-foreground">
                {isEn ? 'Keep MITM diagnostics for recent traffic.' : '保留近期 MITM 排障日志。'}
              </p>
            </div>
            <Switch
              checked={Boolean(config.logRequests)}
              disabled={isBusy}
              onCheckedChange={(checked) => void saveConfig({ logRequests: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>{isEn ? 'Auto Start' : '自动启动'}</Label>
              <p className="text-xs text-muted-foreground">
                {isEn
                  ? 'Restore K-Proxy on local admin startup.'
                  : '在本地控制台启动时恢复 K-Proxy。'}
              </p>
            </div>
            <Switch
              checked={Boolean(config.autoStart)}
              disabled={isBusy}
              onCheckedChange={(checked) => void saveConfig({ autoStart: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">
              {isEn ? 'Device ID Mapping' : 'Device ID 映射'}
            </CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? 'Bind accounts to fixed device IDs and auto-switch when the active account changes.'
              : '把账号绑定到固定 device ID，并在激活账号切换时自动同步。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {isEn ? 'Active account:' : '当前激活账号：'}
              </span>
              <span className="font-medium">{activeAccount?.email || (isEn ? 'None' : '无')}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {isEn ? 'Applied device ID:' : '当前生效 device ID：'} {config.deviceId || '-'}
              </span>
              {activeMapping && (
                <Badge variant="outline" className="h-5">
                  {isEn ? 'Mapped' : '已映射'}: {activeMapping.accountId}
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{isEn ? 'Device ID Draft' : 'Device ID 草稿'}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                value={deviceIdDraft}
                onChange={(event) => setDeviceIdDraft(event.target.value.trim())}
                placeholder={
                  isEn ? 'Generate or enter 64 hex characters' : '生成或输入 64 位十六进制'
                }
                className="min-w-[280px] flex-1 font-mono text-xs"
              />
              <Button variant="outline" size="sm" disabled={isBusy} onClick={generateDeviceIdDraft}>
                <Key className="mr-1 h-4 w-4" />
                {isEn ? 'Generate' : '生成'}
              </Button>
              <Button variant="default" size="sm" disabled={isBusy} onClick={applyDeviceId}>
                {isEn ? 'Apply' : '应用'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!config.deviceId}
                onClick={copyCurrentDeviceId}
              >
                {copiedDeviceId ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {isValidDeviceId(deviceIdDraft)
                ? isEn
                  ? 'Format looks valid.'
                  : '格式正确。'
                : isEn
                  ? 'Needs 64 hex characters before it can be applied.'
                  : '需要 64 位十六进制后才能应用。'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy || !activeAccountId}
              onClick={bindActiveAccount}
            >
              {isEn ? 'Bind Active Account' : '绑定当前激活账号'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy || !activeAccountId}
              onClick={() => activeAccountId && void activateMapping(activeAccountId)}
            >
              {isEn ? 'Use Active Mapping' : '切到当前账号映射'}
            </Button>
          </div>

          <div className="overflow-hidden rounded-md border">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_120px] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>{isEn ? 'Account' : '账号'}</span>
              <span>{isEn ? 'Device ID' : '设备 ID'}</span>
              <span className="text-right">{isEn ? 'Action' : '操作'}</span>
            </div>
            {mappings.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                {isEn ? 'No device mappings yet.' : '还没有 device mapping。'}
              </div>
            ) : (
              mappings.map((mapping) => {
                const account = accounts.get(mapping.accountId)
                const isCurrent = activeMapping?.accountId === mapping.accountId
                return (
                  <div
                    key={mapping.accountId}
                    className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_120px] gap-3 border-b px-3 py-3 text-sm last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {account?.email || mapping.description || mapping.accountId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {isCurrent ? (isEn ? 'Currently applied' : '当前生效') : mapping.accountId}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <code className="block truncate rounded bg-muted px-2 py-1 font-mono text-xs">
                        {mapping.deviceId}
                      </code>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {isEn ? 'Last used:' : '最近使用：'}{' '}
                        {mapping.lastUsed ? new Date(mapping.lastUsed).toLocaleString() : '-'}
                      </div>
                    </div>
                    <div className="flex items-start justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void activateMapping(mapping.accountId)}
                      >
                        {isEn ? 'Use' : '启用'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void removeMapping(mapping.accountId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{isEn ? 'CA Certificate' : 'CA 证书'}</CardTitle>
            </div>
            <Badge variant={systemInfo?.caInstalled ? 'default' : 'secondary'}>
              {systemInfo?.caInstalled
                ? isEn
                  ? 'Installed'
                  : '已安装'
                : isEn
                  ? 'Not Installed'
                  : '未安装'}
            </Badge>
          </div>
          <CardDescription>
            {isEn
              ? 'Inspect certificate validity, install state, and reset the CA when needed.'
              : '查看证书有效期、安装状态，并在需要时重置 CA。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {caInfo && (
            <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/20 p-3 text-sm md:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">
                  {isEn ? 'Certificate path' : '证书路径'}
                </div>
                <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {caInfo.certPath}
                </code>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{isEn ? 'Fingerprint' : '指纹'}</div>
                <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {caInfo.fingerprint}
                </code>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {isEn ? 'Valid from' : '开始时间'}
                </div>
                <div>{new Date(caInfo.validFrom).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {isEn ? 'Valid to' : '到期时间'}
                </div>
                <div>{new Date(caInfo.validTo).toLocaleString()}</div>
              </div>
            </div>
          )}

          {systemInfo?.adminHint && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              {systemInfo.adminHint}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="default" size="sm" disabled={isBusy} onClick={installCertificate}>
              {isEn ? 'Install' : '安装'}
            </Button>
            <Button variant="outline" size="sm" disabled={isBusy} onClick={uninstallCertificate}>
              {isEn ? 'Uninstall' : '卸载'}
            </Button>
            <Button variant="outline" size="sm" disabled={isBusy} onClick={exportCertificate}>
              <Download className="mr-1 h-4 w-4" />
              {isEn ? 'Export' : '导出'}
            </Button>
            <Button variant="outline" size="sm" disabled={isBusy} onClick={resetCertificate}>
              <RotateCcw className="mr-1 h-4 w-4" />
              {isEn ? 'Reset CA' : '重置 CA'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {stats && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{isEn ? 'Traffic Stats' : '流量统计'}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4">
              <div>
                <div className="text-2xl font-bold">{stats.totalRequests}</div>
                <div className="text-xs text-muted-foreground">{isEn ? 'Total' : '总请求'}</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-sky-600">{stats.mitmRequests}</div>
                <div className="text-xs text-muted-foreground">{isEn ? 'MITM' : 'MITM'}</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{stats.modifiedRequests}</div>
                <div className="text-xs text-muted-foreground">{isEn ? 'Modified' : '已替换'}</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-muted-foreground">
                  {stats.bypassRequests}
                </div>
                <div className="text-xs text-muted-foreground">{isEn ? 'Bypass' : '透传'}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{isEn ? 'MITM Logs' : 'MITM 日志'}</CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? 'Use host, path, response status, and duration to confirm whether requests were rewritten.'
              : '用 host、path、响应状态和耗时确认请求是否被替换。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentTraffic.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {isEn ? 'No K-Proxy traffic yet.' : '还没有 K-Proxy 流量记录。'}
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[88px_minmax(0,1.4fr)_92px_88px] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>{isEn ? 'Time' : '时间'}</span>
                <span>{isEn ? 'Request' : '请求'}</span>
                <span>{isEn ? 'Status' : '状态'}</span>
                <span className="text-right">{isEn ? 'Duration' : '耗时'}</span>
              </div>
              {recentTraffic.slice(0, 12).map((item) => (
                <div
                  key={item.requestId}
                  className="grid grid-cols-[88px_minmax(0,1.4fr)_92px_88px] gap-3 border-b px-3 py-3 text-sm last:border-b-0"
                >
                  <span className="text-xs text-muted-foreground">
                    {formatTime(item.timestamp)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">
                      {item.method} {item.host}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{item.path}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.statusCode >= 400 ? 'destructive' : 'outline'}>
                      {item.statusCode}
                    </Badge>
                    {item.deviceIdReplaced && (
                      <Badge variant="outline" className="text-green-700">
                        {isEn ? 'Replaced' : '已替换'}
                      </Badge>
                    )}
                  </div>
                  <span className="text-right text-xs text-muted-foreground">
                    {item.duration}ms
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
