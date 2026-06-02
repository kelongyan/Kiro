import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Network, Plus, Trash2, RefreshCw, Power, PowerOff, Upload, CheckCircle2,
  XCircle, Loader2, Globe, Clock, Activity, Settings2, Copy, FileText,
  Link2, Users, Shuffle, Unlink
} from 'lucide-react'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Switch, Badge } from '../ui'
import { cn } from '@/lib/utils'
import type { ProxyEntry, ProxyPoolStrategy } from '@/types/proxy'

const STRATEGY_OPTIONS: { value: ProxyPoolStrategy; label: string; labelEn: string; desc: string; descEn: string }[] = [
  { value: 'round_robin', label: '轮询', labelEn: 'Round Robin', desc: '依次使用每个代理', descEn: 'Use each proxy in sequence' },
  { value: 'random', label: '随机', labelEn: 'Random', desc: '随机挑选', descEn: 'Pick randomly' },
  { value: 'least_used', label: '最少使用', labelEn: 'Least Used', desc: '使用次数少的优先', descEn: 'Prefer proxies used less' },
  { value: 'fastest', label: '最快优先', labelEn: 'Fastest', desc: '按延迟升序', descEn: 'Sort by latency asc' }
]

function StatusBadge({ status, latency }: { status: ProxyEntry['status']; latency?: number }): React.ReactNode {
  const cfg = {
    untested: { color: 'bg-muted text-muted-foreground', label: '未测试', labelEn: 'Untested' },
    testing: { color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400', label: '测试中', labelEn: 'Testing' },
    alive: { color: 'bg-green-500/15 text-green-600 dark:text-green-400', label: '可用', labelEn: 'Alive' },
    slow: { color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', label: '较慢', labelEn: 'Slow' },
    dead: { color: 'bg-red-500/15 text-red-600 dark:text-red-400', label: '失效', labelEn: 'Dead' }
  }[status]

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium', cfg.color)}>
      {status === 'testing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'alive' && <CheckCircle2 className="h-3 w-3" />}
      {status === 'slow' && <Activity className="h-3 w-3" />}
      {status === 'dead' && <XCircle className="h-3 w-3" />}
      <span>{cfg.label}</span>
      {latency !== undefined && (status === 'alive' || status === 'slow') && (
        <span className="font-mono opacity-70">{latency}ms</span>
      )}
    </span>
  )
}

export function ProxyPoolPage(): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const {
    proxyPool,
    proxyPoolConfig,
    addProxy,
    importProxies,
    removeProxy,
    removeProxies,
    toggleProxyEnabled,
    validateProxy,
    validateProxiesBatch,
    clearProxyPool,
    setProxyPoolConfig,
    accounts,
    accountProxyBindings,
    unbindAccountFromProxy,
    clearAccountProxyBindings,
    autoDistributeAccountsToProxies
  } = useAccountsStore()

  const [singleInput, setSingleInput] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // 搜索 / 过滤（v1.8 扩展：协议 / 启用状态 / 延迟 / 最后验证时间 + 全文）
  const [filterText, setFilterText] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | ProxyEntry['status']>('all')
  const [filterProtocol, setFilterProtocol] = useState<'all' | ProxyEntry['protocol']>('all')
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [filterLatency, setFilterLatency] = useState<'all' | 'fast' | 'medium' | 'slow' | 'unknown'>('all')
  const [filterTestedWithin, setFilterTestedWithin] = useState<'all' | '1h' | '1d' | '7d' | 'never'>('all')
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false)
  const [isValidatingAll, setIsValidatingAll] = useState(false)
  const [testConcurrency, setTestConcurrency] = useState(10)
  // 反代分桶：每代理承载账号数（0 = 均分）
  const [accountsPerProxy, setAccountsPerProxy] = useState<number>(5)
  const [bindingPanelExpanded, setBindingPanelExpanded] = useState(false)

  const proxies = useMemo(() => Array.from(proxyPool.values()), [proxyPool])

  // 反代分桶：当前账号-代理绑定关系
  const bindingStats = useMemo(() => {
    const allAccounts = Array.from(accounts.values())
    const totalActive = allAccounts.filter((a) => a.status === 'active').length
    const boundCount = Object.keys(accountProxyBindings).filter(
      (aid) => accounts.has(aid)
    ).length
    const aliveProxies = proxies.filter((p) => p.enabled && p.status !== 'dead')
    // 每代理承载的账号数
    const perProxy: Record<string, number> = {}
    for (const [aid, pid] of Object.entries(accountProxyBindings)) {
      if (!accounts.has(aid)) continue
      perProxy[pid] = (perProxy[pid] || 0) + 1
    }
    // 风险点：单代理账号数 > 推荐阈值（默认 5）
    const overloadedProxies = Object.entries(perProxy)
      .filter(([, c]) => c > 10)
      .map(([pid, c]) => ({ pid, count: c, proxy: proxyPool.get(pid) }))
    return {
      totalActive,
      boundCount,
      unboundCount: totalActive - boundCount,
      aliveProxyCount: aliveProxies.length,
      perProxy,
      overloadedProxies
    }
  }, [accounts, accountProxyBindings, proxies, proxyPool])

  // 后台定时验活
  const lastAutoValidateRef = useRef(0)
  useEffect(() => {
    const intervalMin = proxyPoolConfig.autoValidateIntervalMin
    if (!intervalMin || intervalMin <= 0) return

    const tick = (): void => {
      const now = Date.now()
      if (now - lastAutoValidateRef.current < intervalMin * 60_000) return
      const enabledIds = Array.from(proxyPool.values())
        .filter((p) => p.enabled)
        .map((p) => p.id)
      if (enabledIds.length === 0) return
      lastAutoValidateRef.current = now
      console.log(`[ProxyPool] Auto-validate ${enabledIds.length} proxies`)
      void validateProxiesBatch(enabledIds, proxyPoolConfig.autoValidateConcurrency || 5)
    }

    // 每分钟检查一次
    const timer = setInterval(tick, 60_000)
    return () => clearInterval(timer)
  }, [proxyPoolConfig.autoValidateIntervalMin, proxyPoolConfig.autoValidateConcurrency, proxyPool, validateProxiesBatch])

  const handleAutoDistribute = useCallback((onlyUnbound: boolean) => {
    if (bindingStats.aliveProxyCount === 0) {
      alert(isEn ? 'No alive proxies. Validate proxies first.' : '没有可用代理，请先验活代理')
      return
    }
    const activeAccountIds = Array.from(accounts.values())
      .filter((a) => a.status === 'active')
      .map((a) => a.id)
    if (activeAccountIds.length === 0) {
      alert(isEn ? 'No active accounts.' : '没有可用账号')
      return
    }
    const result = autoDistributeAccountsToProxies({
      accountsPerProxy,
      onlyUnbound,
      accountIds: activeAccountIds
    })
    alert(isEn
      ? `Distributed ${result.distributed} accounts, skipped ${result.skipped}`
      : `已分配 ${result.distributed} 个账号，跳过 ${result.skipped}`
    )
  }, [accounts, accountsPerProxy, autoDistributeAccountsToProxies, bindingStats.aliveProxyCount, isEn])

  const stats = useMemo(() => {
    let alive = 0, dead = 0, slow = 0, untested = 0, enabled = 0
    for (const p of proxies) {
      if (p.enabled) enabled++
      if (p.status === 'alive') alive++
      else if (p.status === 'dead') dead++
      else if (p.status === 'slow') slow++
      else if (p.status === 'untested') untested++
    }
    return { total: proxies.length, alive, dead, slow, untested, enabled }
  }, [proxies])

  // v1.8 升级版过滤：全文匹配（任意字段片段都能搜到）+ 多维度筛选
  const filtered = useMemo(() => {
    const now = Date.now()
    const HOUR = 60 * 60 * 1000
    const DAY = 24 * HOUR
    return proxies.filter(p => {
      // 状态过滤
      if (filterStatus !== 'all' && p.status !== filterStatus) return false
      // 协议过滤
      if (filterProtocol !== 'all' && p.protocol !== filterProtocol) return false
      // 启用状态过滤
      if (filterEnabled === 'enabled' && !p.enabled) return false
      if (filterEnabled === 'disabled' && p.enabled) return false
      // 延迟范围过滤
      if (filterLatency !== 'all') {
        const lat = p.latencyMs
        if (filterLatency === 'unknown') {
          if (typeof lat === 'number') return false
        } else if (typeof lat !== 'number') {
          return false
        } else {
          if (filterLatency === 'fast' && lat >= 200) return false
          if (filterLatency === 'medium' && (lat < 200 || lat >= 1000)) return false
          if (filterLatency === 'slow' && lat < 1000) return false
        }
      }
      // 最后验证时间过滤
      if (filterTestedWithin !== 'all') {
        if (filterTestedWithin === 'never') {
          if (p.lastTestedAt) return false
        } else if (!p.lastTestedAt) {
          return false
        } else {
          const diff = now - p.lastTestedAt
          if (filterTestedWithin === '1h' && diff > HOUR) return false
          if (filterTestedWithin === '1d' && diff > DAY) return false
          if (filterTestedWithin === '7d' && diff > 7 * DAY) return false
        }
      }
      // 全文搜索（host / port / protocol / username / label / lastBoundEmail / url / tags）
      if (filterText) {
        const q = filterText.toLowerCase().trim()
        const haystack = [
          p.host,
          String(p.port),
          p.protocol,
          p.username || '',
          p.label || '',
          p.lastBoundEmail || '',
          p.url || '',
          (p.tags || []).join(' '),
          p.source || ''
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [proxies, filterText, filterStatus, filterProtocol, filterEnabled, filterLatency, filterTestedWithin])

  // 已应用的过滤条件计数（用于在 UI 显示"高级搜索"徽章）
  const activeAdvancedFilterCount = useMemo(() => {
    let n = 0
    if (filterProtocol !== 'all') n++
    if (filterEnabled !== 'all') n++
    if (filterLatency !== 'all') n++
    if (filterTestedWithin !== 'all') n++
    return n
  }, [filterProtocol, filterEnabled, filterLatency, filterTestedWithin])

  const clearAdvancedFilters = useCallback(() => {
    setFilterProtocol('all')
    setFilterEnabled('all')
    setFilterLatency('all')
    setFilterTestedWithin('all')
  }, [])

  const handleAddSingle = useCallback(() => {
    if (!singleInput.trim()) return
    const id = addProxy(singleInput.trim())
    if (id) {
      setSingleInput('')
    } else {
      alert(isEn ? 'Invalid proxy URL or duplicate' : '代理 URL 无效或重复')
    }
  }, [singleInput, addProxy, isEn])

  const handleImport = useCallback(() => {
    if (!bulkInput.trim()) return
    const result = importProxies(bulkInput)
    alert(isEn
      ? `Imported: added ${result.added}, skipped ${result.skipped}, failed ${result.failed}`
      : `导入完成：新增 ${result.added}，跳过 ${result.skipped}，失败 ${result.failed}`
    )
    setBulkInput('')
    setBulkOpen(false)
  }, [bulkInput, importProxies, isEn])

  const handleValidateAll = useCallback(async () => {
    const ids = filtered.map(p => p.id)
    if (ids.length === 0) return
    setIsValidatingAll(true)
    try {
      await validateProxiesBatch(ids, testConcurrency)
    } finally {
      setIsValidatingAll(false)
    }
  }, [filtered, validateProxiesBatch, testConcurrency])

  const handleValidateSelected = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setIsValidatingAll(true)
    try {
      await validateProxiesBatch(ids, testConcurrency)
    } finally {
      setIsValidatingAll(false)
    }
  }, [selectedIds, validateProxiesBatch, testConcurrency])

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return
    if (!confirm(isEn ? `Delete ${selectedIds.size} proxies?` : `确定删除 ${selectedIds.size} 个代理？`)) return
    removeProxies(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [selectedIds, removeProxies, isEn])

  const handleRemoveDead = useCallback(() => {
    const deadIds = proxies.filter(p => p.status === 'dead').map(p => p.id)
    if (deadIds.length === 0) return
    if (!confirm(isEn ? `Remove ${deadIds.length} dead proxies?` : `确定移除 ${deadIds.length} 个失效代理？`)) return
    removeProxies(deadIds)
  }, [proxies, removeProxies, isEn])

  const toggleSelect = (id: string): void => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (): void => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)))
    }
  }

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      {/* Header */}
      <div className="page-hero p-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-cyan-500/20 to-transparent rounded-full blur-2xl" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-cyan-500/20 to-transparent rounded-full blur-2xl" />
        <div className="relative flex items-center gap-4">
          <div className="p-3 rounded-xl bg-cyan-500 shadow-lg shadow-cyan-500/25">
            <Network className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">
              {isEn ? 'Proxy Pool' : '代理池'}
            </h1>
            <p className="text-muted-foreground">
              {isEn
                ? 'IP rotation pool for registration tasks. Reduces association/risk control on batch sign-ups.'
                : '注册批量任务的 IP 轮换池。降低同 IP 多账号关联风控。'
              }
            </p>
          </div>
        </div>
      </div>

      {/* 池总开关 + 调度策略 */}
      <Card className="hover-lift">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            {isEn ? 'Pool Configuration' : '池配置'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 总开关 */}
          <div className="flex items-center gap-3">
            <Switch
              checked={proxyPoolConfig.enabled}
              onCheckedChange={(v) => setProxyPoolConfig({ enabled: v })}
            />
            <div>
              <Label className="cursor-pointer text-sm">
                {isEn ? 'Enable proxy pool for registration' : '为注册流程启用代理池'}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {isEn
                  ? 'When enabled, each registration task picks an available proxy by the strategy below.'
                  : '开启后，每个注册任务会按下方策略自动选取一个可用代理'
                }
              </p>
            </div>
          </div>

          {/* 调度策略 */}
          <div className="space-y-2">
            <Label className="text-xs">{isEn ? 'Selection Strategy' : '调度策略'}</Label>
            <div className="flex flex-wrap gap-2">
              {STRATEGY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setProxyPoolConfig({ strategy: opt.value })}
                  className={cn(
                    'px-3 py-1.5 rounded-md border text-xs transition-colors',
                    proxyPoolConfig.strategy === opt.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border hover:border-primary/50'
                  )}
                  title={isEn ? opt.descEn : opt.desc}
                >
                  {isEn ? opt.labelEn : opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 自动停用 + 失败阈值 + 测试 URL */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={proxyPoolConfig.autoDisableDead}
                onCheckedChange={(v) => setProxyPoolConfig({ autoDisableDead: v })}
              />
              <Label className="text-xs cursor-pointer">
                {isEn ? 'Auto-disable on failure' : '失败自动停用'}
              </Label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{isEn ? 'Failure threshold' : '失败阈值'}</Label>
              <Input
                type="number" min={1} max={20}
                value={proxyPoolConfig.failureThreshold}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 1) setProxyPoolConfig({ failureThreshold: v })
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{isEn ? 'Test URL' : '验活 URL'}</Label>
              <Input
                value={proxyPoolConfig.testUrl}
                onChange={(e) => setProxyPoolConfig({ testUrl: e.target.value })}
                placeholder="https://api.ipify.org?format=json"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          {/* 定时自动验活 (B2) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {isEn ? 'Auto-validate interval (min, 0=off)' : '定时自动验活（分钟，0=关闭）'}
              </Label>
              <Input
                type="number" min={0} max={1440}
                value={proxyPoolConfig.autoValidateIntervalMin}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 0) setProxyPoolConfig({ autoValidateIntervalMin: v })
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{isEn ? 'Auto-validate concurrency' : '验活并发'}</Label>
              <Input
                type="number" min={1} max={50}
                value={proxyPoolConfig.autoValidateConcurrency}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 1) setProxyPoolConfig({ autoValidateConcurrency: v })
                }}
                disabled={proxyPoolConfig.autoValidateIntervalMin === 0}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 添加代理 */}
      <Card className="hover-lift">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            {isEn ? 'Add Proxies' : '添加代理'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 单个添加 */}
          <div className="flex gap-2">
            <Input
              value={singleInput}
              onChange={(e) => setSingleInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSingle()}
              placeholder={isEn
                ? 'http://user:pass@host:port  or  host:port  or  socks5://...'
                : 'http://user:pass@host:port 或 host:port 或 socks5://...'
              }
              className="font-mono text-xs"
            />
            <Button onClick={handleAddSingle} disabled={!singleInput.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              {isEn ? 'Add' : '添加'}
            </Button>
            <Button variant="outline" onClick={() => setBulkOpen(!bulkOpen)}>
              <Upload className="h-4 w-4 mr-1" />
              {isEn ? 'Bulk' : '批量'}
            </Button>
          </div>

          {/* 批量导入 */}
          {bulkOpen && (
            <div className="space-y-2 p-3 bg-muted/30 rounded-lg border border-dashed">
              <Label className="text-xs">
                {isEn
                  ? 'One proxy per line. Supports: http(s)://host:port, user:pass@host:port, host:port:user:pass, socks5://...'
                  : '每行一个代理。支持格式: http(s)://host:port、user:pass@host:port、host:port:user:pass、socks5://...'
                }
              </Label>
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 bg-background border rounded-lg text-xs font-mono resize-none"
                placeholder={'http://127.0.0.1:7890\nuser:pass@1.2.3.4:8080\nsocks5://example.com:1080'}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setBulkInput(''); setBulkOpen(false) }}>
                  {isEn ? 'Cancel' : '取消'}
                </Button>
                <Button size="sm" onClick={handleImport} disabled={!bulkInput.trim()}>
                  <FileText className="h-4 w-4 mr-1" />
                  {isEn ? 'Import' : '导入'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 统计 + 工具栏 */}
      <Card>
        <CardContent className="py-3 space-y-3">
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="text-muted-foreground">
              {isEn ? 'Total:' : '总计：'} <strong className="text-foreground">{stats.total}</strong>
            </span>
            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950/30">
              {isEn ? 'Alive' : '可用'}: {stats.alive}
            </Badge>
            <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30">
              {isEn ? 'Slow' : '较慢'}: {stats.slow}
            </Badge>
            <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 dark:bg-red-950/30">
              {isEn ? 'Dead' : '失效'}: {stats.dead}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              {isEn ? 'Untested' : '未测试'}: {stats.untested}
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {isEn ? `${stats.enabled} enabled` : `${stats.enabled} 已启用`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={isEn ? 'Search any field (host/port/protocol/user/email/label/url)...' : '搜索任意字段（host/端口/协议/user/邮箱/备注/URL）...'}
              className="h-8 max-w-md text-xs"
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | ProxyEntry['status'])}
              className="h-8 px-2 rounded-md border bg-background text-xs"
            >
              <option value="all">{isEn ? 'All Status' : '全部状态'}</option>
              <option value="alive">{isEn ? 'Alive' : '可用'}</option>
              <option value="slow">{isEn ? 'Slow' : '较慢'}</option>
              <option value="dead">{isEn ? 'Dead' : '失效'}</option>
              <option value="untested">{isEn ? 'Untested' : '未测试'}</option>
            </select>

            <Button
              size="sm"
              variant={advancedSearchOpen || activeAdvancedFilterCount > 0 ? 'default' : 'outline'}
              className="h-8"
              onClick={() => setAdvancedSearchOpen(!advancedSearchOpen)}
            >
              {isEn ? 'Advanced' : '高级'}
              {activeAdvancedFilterCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-background/30 text-[10px]">
                  {activeAdvancedFilterCount}
                </span>
              )}
            </Button>

            {(filterText || filterStatus !== 'all' || activeAdvancedFilterCount > 0) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => {
                  setFilterText('')
                  setFilterStatus('all')
                  clearAdvancedFilters()
                }}
              >
                {isEn ? 'Clear' : '清空'}
              </Button>
            )}

            <div className="w-px h-6 bg-border" />

            <Button
              size="sm"
              variant="outline"
              onClick={handleValidateAll}
              disabled={isValidatingAll || filtered.length === 0}
            >
              {isValidatingAll
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <RefreshCw className="h-4 w-4 mr-1" />
              }
              {isEn ? `Test All (${filtered.length})` : `全部测试 (${filtered.length})`}
            </Button>

            {selectedIds.size > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={handleValidateSelected}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {isEn ? `Test Selected (${selectedIds.size})` : `测试选中 (${selectedIds.size})`}
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={handleDeleteSelected}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  {isEn ? `Delete (${selectedIds.size})` : `删除 (${selectedIds.size})`}
                </Button>
              </>
            )}

            <Button size="sm" variant="ghost" onClick={handleRemoveDead} disabled={stats.dead === 0}>
              <XCircle className="h-4 w-4 mr-1" />
              {isEn ? 'Remove Dead' : '移除失效'}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="text-destructive ml-auto"
              onClick={() => {
                if (proxies.length === 0) return
                if (confirm(isEn ? 'Clear all proxies?' : '确定清空所有代理？')) clearProxyPool()
              }}
              disabled={proxies.length === 0}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {isEn ? 'Clear All' : '清空'}
            </Button>

            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">{isEn ? 'Concurrency:' : '并发:'}</span>
              <Input
                type="number" min={1} max={50}
                value={testConcurrency}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 1) setTestConcurrency(v)
                }}
                className="h-7 w-14 text-xs text-center"
              />
            </div>
          </div>

          {/* 高级搜索折叠面板：协议 / 启用 / 延迟 / 最后验证 */}
          {advancedSearchOpen && (
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-md border bg-muted/30 mt-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{isEn ? 'Protocol:' : '协议:'}</span>
                <select
                  value={filterProtocol}
                  onChange={(e) => setFilterProtocol(e.target.value as 'all' | ProxyEntry['protocol'])}
                  className="h-7 px-2 rounded-md border bg-background text-xs"
                >
                  <option value="all">{isEn ? 'All' : '全部'}</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="socks4">SOCKS4</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{isEn ? 'Enabled:' : '启用:'}</span>
                <select
                  value={filterEnabled}
                  onChange={(e) => setFilterEnabled(e.target.value as 'all' | 'enabled' | 'disabled')}
                  className="h-7 px-2 rounded-md border bg-background text-xs"
                >
                  <option value="all">{isEn ? 'All' : '全部'}</option>
                  <option value="enabled">{isEn ? 'Enabled' : '已启用'}</option>
                  <option value="disabled">{isEn ? 'Disabled' : '已停用'}</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{isEn ? 'Latency:' : '延迟:'}</span>
                <select
                  value={filterLatency}
                  onChange={(e) => setFilterLatency(e.target.value as 'all' | 'fast' | 'medium' | 'slow' | 'unknown')}
                  className="h-7 px-2 rounded-md border bg-background text-xs"
                >
                  <option value="all">{isEn ? 'All' : '全部'}</option>
                  <option value="fast">{isEn ? '< 200ms (Fast)' : '< 200ms（快）'}</option>
                  <option value="medium">{isEn ? '200-1000ms' : '200-1000ms'}</option>
                  <option value="slow">{isEn ? '> 1000ms (Slow)' : '> 1000ms（慢）'}</option>
                  <option value="unknown">{isEn ? 'Unknown' : '未知'}</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{isEn ? 'Tested:' : '验证于:'}</span>
                <select
                  value={filterTestedWithin}
                  onChange={(e) => setFilterTestedWithin(e.target.value as 'all' | '1h' | '1d' | '7d' | 'never')}
                  className="h-7 px-2 rounded-md border bg-background text-xs"
                >
                  <option value="all">{isEn ? 'Any time' : '任意时间'}</option>
                  <option value="1h">{isEn ? 'Last 1h' : '最近 1 小时'}</option>
                  <option value="1d">{isEn ? 'Last 1 day' : '最近 1 天'}</option>
                  <option value="7d">{isEn ? 'Last 7 days' : '最近 7 天'}</option>
                  <option value="never">{isEn ? 'Never tested' : '从未测试'}</option>
                </select>
              </div>

              {activeAdvancedFilterCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 ml-auto text-xs"
                  onClick={clearAdvancedFilters}
                >
                  {isEn ? 'Reset' : '重置'}
                </Button>
              )}

              <div className="w-full text-[10px] text-muted-foreground mt-1">
                {isEn
                  ? `Matched ${filtered.length} of ${proxies.length}`
                  : `匹配 ${filtered.length} / ${proxies.length}`}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 反代账号-代理 N:1 分桶 */}
      <Card className="hover-lift">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            {isEn ? 'Reverse Proxy: Account-to-IP Bucketing' : '反代分桶（账号绑定代理 IP）'}
            <span className="text-[10px] font-normal text-muted-foreground">
              {isEn
                ? '— Limit accounts per IP to avoid risk-control association'
                : '— 限制每 IP 账号数，避免被风控关联'
              }
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 统计 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="p-2 bg-muted/30 rounded">
              <div className="text-[10px] text-muted-foreground">{isEn ? 'Active Accounts' : '可用账号'}</div>
              <div className="text-lg font-bold">{bindingStats.totalActive}</div>
            </div>
            <div className="p-2 bg-green-50 dark:bg-green-950/20 rounded">
              <div className="text-[10px] text-muted-foreground">{isEn ? 'Bound' : '已绑定'}</div>
              <div className="text-lg font-bold text-green-600">{bindingStats.boundCount}</div>
            </div>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded">
              <div className="text-[10px] text-muted-foreground">{isEn ? 'Unbound' : '未绑定'}</div>
              <div className="text-lg font-bold text-amber-600">{bindingStats.unboundCount}</div>
            </div>
            <div className="p-2 bg-cyan-50 dark:bg-cyan-950/20 rounded">
              <div className="text-[10px] text-muted-foreground">{isEn ? 'Alive Proxies' : '可用代理'}</div>
              <div className="text-lg font-bold text-cyan-600">{bindingStats.aliveProxyCount}</div>
            </div>
          </div>

          {/* 风险提示 */}
          {bindingStats.overloadedProxies.length > 0 && (
            <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded text-xs">
              <div className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-300">
                <XCircle className="h-3.5 w-3.5" />
                {isEn ? 'Risk: Overloaded proxies' : '风险：超载代理'}
              </div>
              <p className="text-muted-foreground mt-1">
                {isEn
                  ? `${bindingStats.overloadedProxies.length} proxy/proxies are carrying more than 10 accounts. Consider re-distributing.`
                  : `${bindingStats.overloadedProxies.length} 个代理承载了超过 10 个账号，建议重新分配。`
                }
              </p>
            </div>
          )}

          {/* 自动分配 */}
          <div className="flex items-center gap-3 flex-wrap p-3 bg-muted/20 rounded-lg border border-dashed">
            <div className="flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-primary" />
              <Label className="text-sm">{isEn ? 'Accounts per proxy' : '每代理承载'}:</Label>
              <Input
                type="number" min={0} max={50}
                value={accountsPerProxy}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 0) setAccountsPerProxy(v)
                }}
                className="h-8 w-20 text-xs text-center"
              />
              <span className="text-[10px] text-muted-foreground italic">
                {accountsPerProxy === 0
                  ? (isEn ? '(0 = even split)' : '(0 = 均分)')
                  : (isEn ? `accounts → 1 IP` : '账号 / IP')
                }
              </span>
            </div>
            <Button size="sm" onClick={() => handleAutoDistribute(true)} disabled={bindingStats.unboundCount === 0}>
              <Users className="h-4 w-4 mr-1" />
              {isEn ? `Auto-Bind Unbound (${bindingStats.unboundCount})` : `自动绑定未分配 (${bindingStats.unboundCount})`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleAutoDistribute(false)}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {isEn ? 'Re-Distribute All' : '重新分配全部'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive ml-auto"
              onClick={() => {
                if (bindingStats.boundCount === 0) return
                if (confirm(isEn ? `Unbind all ${bindingStats.boundCount} accounts?` : `解绑全部 ${bindingStats.boundCount} 个账号？`)) {
                  clearAccountProxyBindings()
                }
              }}
              disabled={bindingStats.boundCount === 0}
            >
              <Unlink className="h-4 w-4 mr-1" />
              {isEn ? 'Unbind All' : '解绑全部'}
            </Button>
          </div>

          {/* 详细绑定关系（折叠） */}
          <button
            onClick={() => setBindingPanelExpanded(!bindingPanelExpanded)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            {bindingPanelExpanded
              ? (isEn ? '▼ Hide binding details' : '▼ 隐藏绑定明细')
              : (isEn ? '▶ Show binding details' : '▶ 显示绑定明细')
            }
          </button>

          {bindingPanelExpanded && (
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg">
              {proxies.filter((p) => p.enabled && p.status !== 'dead').map((p) => {
                const boundAccountIds = Object.entries(accountProxyBindings)
                  .filter(([, pid]) => pid === p.id)
                  .map(([aid]) => aid)
                if (boundAccountIds.length === 0) return null
                return (
                  <div key={p.id} className="p-2 border-b last:border-b-0">
                    <div className="flex items-center justify-between gap-2 text-xs mb-1">
                      <span className="font-mono truncate" title={p.url}>
                        {p.host}:{p.port}
                        {p.label && <Badge variant="outline" className="ml-1.5 h-4 text-[9px]">{p.label}</Badge>}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {boundAccountIds.length} {isEn ? 'accounts' : '账号'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1 pl-2">
                      {boundAccountIds.map((aid) => {
                        const acc = accounts.get(aid)
                        return (
                          <span
                            key={aid}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] hover:bg-destructive/10 transition-colors group"
                          >
                            <span title={acc?.email}>{(acc?.email || aid.slice(0, 8))}</span>
                            <button
                              onClick={() => unbindAccountFromProxy(aid)}
                              className="opacity-30 group-hover:opacity-100 text-destructive"
                              title={isEn ? 'Unbind' : '解绑'}
                            >
                              <XCircle className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {bindingStats.unboundCount > 0 && (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/10 text-xs">
                  <span className="text-amber-700 dark:text-amber-300">
                    {isEn ? `${bindingStats.unboundCount} accounts have no proxy binding (will use global proxy / direct).` : `${bindingStats.unboundCount} 个账号未绑定代理（将走全局代理 / 直连）`}
                  </span>
                </div>
              )}
              {bindingStats.boundCount === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {isEn ? 'No bindings yet. Click "Auto-Bind" above to start.' : '尚无绑定。点击上方"自动绑定"开始。'}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 代理列表 */}
      {filtered.length > 0 ? (
        <Card>
          <CardContent className="py-0 px-0">
            {/* 表头 */}
            <div className="flex items-center gap-3 py-2 px-3 border-b text-xs font-medium text-muted-foreground bg-muted/30">
              <button onClick={toggleSelectAll} className="flex-shrink-0">
                <input
                  type="checkbox"
                  readOnly
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  className="cursor-pointer"
                />
              </button>
              <span className="w-12 text-center">{isEn ? 'On' : '启用'}</span>
              <span className="flex-1">URL</span>
              <span className="w-24 text-center">{isEn ? 'Status' : '状态'}</span>
              <span className="w-20 text-center">{isEn ? 'Used' : '使用'}</span>
              <span className="w-20 text-center">{isEn ? 'Failed' : '失败'}</span>
              <span className="w-32 text-center">{isEn ? 'External IP / Email' : '出口 IP / 邮箱'}</span>
              <span className="w-24 text-center">{isEn ? 'Actions' : '操作'}</span>
            </div>

            <ProxyVirtualList
              filtered={filtered}
              selectedIds={selectedIds}
              onSelect={toggleSelect}
              onToggle={toggleProxyEnabled}
              onTest={validateProxy}
              onDelete={removeProxy}
              isEn={isEn}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {proxies.length === 0
                ? (isEn ? 'No proxies yet. Add some to begin.' : '暂无代理。先添加一些代理。')
                : (isEn ? 'No proxies match the current filter.' : '当前筛选无匹配代理。')
              }
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

interface ProxyRowProps {
  proxy: ProxyEntry
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onTest: () => Promise<unknown>
  onDelete: () => void
  isEn: boolean
}

function ProxyRow({ proxy, selected, onSelect, onToggle, onTest, onDelete, isEn }: ProxyRowProps): React.ReactNode {
  // 脱敏密码部分
  const displayUrl = useMemo(() => {
    if (!proxy.password) return proxy.url
    return proxy.url.replace(/:([^:@\/]+)@/, ':***@')
  }, [proxy.url, proxy.password])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(proxy.url)
  }

  return (
    <div className={cn(
      'flex items-center gap-3 py-2 px-3 border-b last:border-b-0 hover:bg-muted/40 text-xs transition-colors',
      selected && 'bg-primary/5',
      !proxy.enabled && 'opacity-60'
    )}>
      <input type="checkbox" checked={selected} onChange={onSelect} className="flex-shrink-0 cursor-pointer" />
      <button
        onClick={onToggle}
        className="w-12 flex justify-center text-muted-foreground hover:text-foreground"
        title={isEn ? (proxy.enabled ? 'Disable' : 'Enable') : (proxy.enabled ? '停用' : '启用')}
      >
        {proxy.enabled
          ? <Power className="h-4 w-4 text-green-500" />
          : <PowerOff className="h-4 w-4" />
        }
      </button>
      <span className="flex-1 font-mono truncate" title={displayUrl}>
        <span className="opacity-50 mr-1">{proxy.protocol}://</span>
        {proxy.host}:{proxy.port}
        {proxy.username && <span className="opacity-50 ml-1">@{proxy.username}</span>}
        {proxy.label && (
          <Badge variant="outline" className="ml-2 h-4 text-[9px]">{proxy.label}</Badge>
        )}
      </span>
      <span className="w-24 flex justify-center">
        <StatusBadge status={proxy.status} latency={proxy.latencyMs} />
      </span>
      <span className="w-20 text-center font-mono tabular-nums">{proxy.usedCount}</span>
      <span className={cn('w-20 text-center font-mono tabular-nums', proxy.failCount > 0 && 'text-amber-600')}>
        {proxy.failCount}
      </span>
      <span className="w-32 text-center text-[10px] truncate" title={proxy.lastBoundEmail}>
        {proxy.lastBoundEmail
          ? <span className="text-muted-foreground">{proxy.lastBoundEmail}</span>
          : (proxy.lastTestedAt
            ? <span className="text-muted-foreground inline-flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {Math.round((Date.now() - proxy.lastTestedAt) / 60000)}m
              </span>
            : <span className="opacity-40">-</span>
          )
        }
      </span>
      <span className="w-24 flex justify-center gap-1">
        <button
          onClick={() => void onTest()}
          disabled={proxy.status === 'testing'}
          className="p-1 rounded hover:bg-muted"
          title={isEn ? 'Test' : '测试'}
        >
          {proxy.status === 'testing'
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />
          }
        </button>
        <button onClick={handleCopy} className="p-1 rounded hover:bg-muted" title={isEn ? 'Copy URL' : '复制 URL'}>
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-destructive/10 text-destructive"
          title={isEn ? 'Delete' : '删除'}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}

/**
 * 代理列表虚拟化渲染（处理几百到几千个代理时避免卡顿）
 * 行高约 44px（含 padding 和 border）
 */
interface ProxyVirtualListProps {
  filtered: ProxyEntry[]
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onTest: (id: string) => Promise<unknown>
  onDelete: (id: string) => void
  isEn: boolean
}

function ProxyVirtualList({ filtered, selectedIds, onSelect, onToggle, onTest, onDelete, isEn }: ProxyVirtualListProps): React.ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)
  const ROW_HEIGHT = 44

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  // 行数较少（< 50）时不虚拟，直接渲染避免虚拟列表布局开销
  if (filtered.length < 50) {
    return (
      <div ref={parentRef} className="max-h-[60vh] overflow-y-auto">
        {filtered.map((p) => (
          <ProxyRow
            key={p.id}
            proxy={p}
            selected={selectedIds.has(p.id)}
            onSelect={() => onSelect(p.id)}
            onToggle={() => onToggle(p.id)}
            onTest={() => onTest(p.id)}
            onDelete={() => onDelete(p.id)}
            isEn={isEn}
          />
        ))}
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  return (
    <div ref={parentRef} className="max-h-[60vh] overflow-y-auto" style={{ contain: 'strict' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((virtualRow) => {
          const p = filtered[virtualRow.index]
          if (!p) return null
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              <ProxyRow
                proxy={p}
                selected={selectedIds.has(p.id)}
                onSelect={() => onSelect(p.id)}
                onToggle={() => onToggle(p.id)}
                onTest={() => onTest(p.id)}
                onDelete={() => onDelete(p.id)}
                isEn={isEn}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
