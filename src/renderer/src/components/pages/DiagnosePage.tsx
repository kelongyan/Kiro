import { useState, useCallback } from 'react'
import {
  Stethoscope, CheckCircle2, XCircle, Loader2, Play, AlertTriangle,
  Globe, Network, Mail, Activity, Download
} from 'lucide-react'
import { useTranslation } from '@/hooks/useTranslation'
import { useAccountsStore } from '@/store/accounts'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Label, Input } from '../ui'
import { cn } from '@/lib/utils'

interface DiagnoseTarget {
  id: string
  label: string
  url: string
  category: 'network' | 'kiro' | 'email' | 'proxy' | 'custom'
  description: string
  expectStatus?: number[]
}

const DEFAULT_TARGETS: DiagnoseTarget[] = [
  // 网络连通
  {
    id: 'public-ip', label: '公网连通性', url: 'https://api.ipify.org?format=json',
    category: 'network', description: '检测能否访问互联网（基础连通性）'
  },
  {
    id: 'cloudflare', label: 'Cloudflare', url: 'https://1.1.1.1',
    category: 'network', description: '检测国际网络是否通畅'
  },
  // Kiro / AWS
  {
    id: 'kiro-auth', label: 'Kiro Auth Endpoint',
    url: 'https://prod.us-east-1.auth.desktop.kiro.dev/.well-known/openid-configuration',
    category: 'kiro', description: '社交登录 Token 刷新端点',
    expectStatus: [200, 401, 403, 404]
  },
  {
    id: 'kiro-oidc', label: 'AWS OIDC',
    url: 'https://oidc.us-east-1.amazonaws.com/',
    category: 'kiro', description: 'OIDC 注册端点',
    expectStatus: [200, 400, 403, 405]
  },
  {
    id: 'kiro-codewhisperer', label: 'CodeWhisperer API',
    url: 'https://q.us-east-1.amazonaws.com/',
    category: 'kiro', description: 'Kiro 主 API 端点（q.amazonaws.com）',
    expectStatus: [200, 400, 403, 405]
  },
  {
    id: 'aws-signin', label: 'AWS SignIn',
    url: 'https://us-east-1.signin.aws/',
    category: 'kiro', description: '注册流程必经端点',
    expectStatus: [200, 400, 403]
  },
  // Email Services
  {
    id: 'tempmail-plus', label: 'TempMail.Plus API',
    url: 'https://tempmail.plus/api/mails?email=test@mailto.plus',
    category: 'email', description: 'TempMail.Plus 邮箱服务',
    expectStatus: [200, 400, 401, 403]
  },
  {
    id: 'outlook-login', label: 'Outlook Login',
    url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    category: 'email', description: 'Outlook Token 刷新端点',
    expectStatus: [200, 400, 405]
  }
]

const CATEGORIES = [
  { id: 'network', label: '网络', icon: Globe, color: 'text-blue-500' },
  { id: 'kiro', label: 'Kiro / AWS', icon: Activity, color: 'text-purple-500' },
  { id: 'email', label: '邮箱服务', icon: Mail, color: 'text-amber-500' },
  { id: 'proxy', label: '代理', icon: Network, color: 'text-cyan-500' },
  { id: 'custom', label: '自定义', icon: Activity, color: 'text-emerald-500' }
] as const

type DiagnoseResult = { id: string; success: boolean; httpStatus?: number; latencyMs?: number; error?: string }

export function DiagnosePage(): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const { proxyPool, proxyPoolConfig } = useAccountsStore()

  // 自定义探测 URL（替代旧的 MoEmail 字段，可填任意 HTTP/HTTPS 端点做连通性测试）
  // 兼容老配置：先读新 key，找不到则尝试读旧的 MoEmail key 完成迁移
  const [customProbeUrl, setCustomProbeUrl] = useState<string>(() => {
    try {
      const v = localStorage.getItem('kiro-diagnose-probe-url')
      if (v !== null) return v
      // 一次性迁移老数据
      const legacy = localStorage.getItem('kiro-diagnose-moemail') || ''
      if (legacy) {
        try {
          localStorage.setItem('kiro-diagnose-probe-url', legacy)
          localStorage.removeItem('kiro-diagnose-moemail')
        } catch { /* ignore */ }
      }
      return legacy
    } catch { return '' }
  })
  const [useProxy, setUseProxy] = useState<boolean>(false)
  const [selectedProxyId, setSelectedProxyId] = useState<string>('')
  const [isRunning, setIsRunning] = useState(false)
  const [results, setResults] = useState<Record<string, DiagnoseResult>>({})
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })

  const availableProxies = Array.from(proxyPool.values()).filter((p) => p.enabled && p.status !== 'dead')

  const buildTargets = useCallback((): DiagnoseTarget[] => {
    const list = [...DEFAULT_TARGETS]
    const trimmed = customProbeUrl.trim()
    if (trimmed) {
      // 用户填的 URL 直接作为探测目标，不再追加任何路径
      // 自动补 https:// 前缀（如果用户只填了域名）
      const probeUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      list.push({
        id: 'custom-probe',
        label: isEn ? 'Custom Probe URL' : '自定义探测 URL',
        url: probeUrl,
        category: 'custom',
        description: isEn ? 'User-provided URL for connectivity test' : '用户填写的 URL 连通性测试',
        expectStatus: [200, 201, 204, 301, 302, 400, 401, 403, 404, 405]
      })
    }
    return list
  }, [customProbeUrl, isEn])

  const runDiagnose = useCallback(async (): Promise<void> => {
    const targets = buildTargets()
    setIsRunning(true)
    setResults({})
    setProgress({ done: 0, total: targets.length })

    const proxyUrl = useProxy && selectedProxyId
      ? proxyPool.get(selectedProxyId)?.url
      : undefined

    try {
      // 分批跑，每次 4 个，让结果逐步出现
      const BATCH = 4
      const next: Record<string, DiagnoseResult> = {}
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH)
        const resp = await window.api.diagnoseRun({
          proxyUrl,
          targets: slice.map((tg) => ({ id: tg.id, label: tg.label, url: tg.url, expectStatus: tg.expectStatus }))
        })
        for (const r of resp.results) {
          next[r.id] = r
        }
        setResults({ ...next })
        setProgress({ done: Math.min(i + BATCH, targets.length), total: targets.length })
      }
    } finally {
      setIsRunning(false)
      // 持久化用户填的探测 URL
      try { localStorage.setItem('kiro-diagnose-probe-url', customProbeUrl) } catch { /* ignore */ }
    }
  }, [buildTargets, useProxy, selectedProxyId, proxyPool, customProbeUrl])

  const exportReport = useCallback(() => {
    const targets = buildTargets()
    const lines = [
      `Kiro Account Manager - 诊断报告`,
      `生成时间: ${new Date().toLocaleString('zh-CN')}`,
      `代理: ${useProxy && selectedProxyId ? proxyPool.get(selectedProxyId)?.url : '直连'}`,
      `------------------------------------`
    ]
    for (const tg of targets) {
      const r = results[tg.id]
      lines.push(`[${tg.label}]`)
      lines.push(`  URL: ${tg.url}`)
      if (!r) {
        lines.push(`  状态: 未测试`)
      } else {
        lines.push(`  状态: ${r.success ? '✓ 通过' : '✗ 失败'}`)
        if (r.httpStatus) lines.push(`  HTTP: ${r.httpStatus}`)
        if (r.latencyMs != null) lines.push(`  延迟: ${r.latencyMs}ms`)
        if (r.error) lines.push(`  错误: ${r.error}`)
      }
      lines.push('')
    }
    void navigator.clipboard.writeText(lines.join('\n'))
    alert(isEn ? 'Report copied to clipboard' : '诊断报告已复制到剪贴板')
  }, [buildTargets, results, useProxy, selectedProxyId, proxyPool, isEn])

  const stats = (() => {
    const all = Object.values(results)
    return {
      total: all.length,
      passed: all.filter((r) => r.success).length,
      failed: all.filter((r) => !r.success).length
    }
  })()

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      {/* Header */}
      <div className="page-hero p-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/20 to-transparent rounded-full blur-2xl" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-emerald-500/20 to-transparent rounded-full blur-2xl" />
        <div className="relative flex items-center gap-4">
          <div className="p-3 rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/25">
            <Stethoscope className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {isEn ? 'Diagnostics' : '一键诊断'}
            </h1>
            <p className="text-muted-foreground">
              {isEn
                ? 'Test network / Kiro API / email service / proxy connectivity in one click.'
                : '一键检测网络、Kiro/AWS API、邮箱服务、代理连通性，快速定位问题'
              }
            </p>
          </div>
        </div>
      </div>

      {/* 配置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            诊断配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 自定义探测 URL */}
          <div className="space-y-1">
            <Label className="text-xs">{isEn ? 'Custom probe URL (optional)' : '自定义探测 URL（可选）'}</Label>
            <Input
              value={customProbeUrl}
              onChange={(e) => setCustomProbeUrl(e.target.value)}
              placeholder={isEn ? 'https://example.com/health' : 'https://example.com/health'}
              disabled={isRunning}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              {isEn
                ? 'Any HTTP/HTTPS endpoint will be added to the diagnostic list (HEAD request, expecting 2xx/3xx/4xx).'
                : '可填任意 HTTP/HTTPS 地址用于连通性测试（HEAD 请求，2xx/3xx/4xx 都视为通）。'}
            </p>
          </div>

          {/* 代理选项 */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={useProxy}
                onChange={(e) => setUseProxy(e.target.checked)}
                disabled={isRunning}
              />
              <span>{isEn ? 'Test through proxy' : '通过代理测试'}</span>
            </label>
            {useProxy && (
              availableProxies.length > 0 ? (
                <select
                  value={selectedProxyId}
                  onChange={(e) => setSelectedProxyId(e.target.value)}
                  disabled={isRunning}
                  className="h-8 px-2 rounded-md border bg-background text-xs flex-1 max-w-md"
                >
                  <option value="">-- {isEn ? 'Select a proxy' : '选择一个代理'} --</option>
                  {availableProxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.protocol}://{p.host}:{p.port}
                      {p.label ? ` (${p.label})` : ''}
                      {p.status === 'alive' && p.latencyMs ? ` - ${p.latencyMs}ms` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted-foreground italic">
                  {proxyPoolConfig.enabled ? '代理池无可用代理' : '代理池未启用，请先在「代理池」配置'}
                </span>
              )
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={runDiagnose} disabled={isRunning}>
              {isRunning
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <Play className="h-4 w-4 mr-1" />
              }
              {isRunning
                ? `运行中 ${progress.done}/${progress.total}`
                : (isEn ? 'Run Diagnostics' : '开始诊断')
              }
            </Button>
            {stats.total > 0 && (
              <Button variant="outline" size="sm" onClick={exportReport}>
                <Download className="h-4 w-4 mr-1" />
                {isEn ? 'Copy Report' : '复制报告'}
              </Button>
            )}
            {stats.total > 0 && (
              <div className="ml-auto flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-green-600 border-green-200">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> {stats.passed}
                </Badge>
                {stats.failed > 0 && (
                  <Badge variant="outline" className="text-red-600 border-red-200">
                    <XCircle className="h-3 w-3 mr-1" /> {stats.failed}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 结果分组 */}
      {CATEGORIES.map((cat) => {
        const items = buildTargets().filter((t) => t.category === cat.id)
        if (items.length === 0) return null
        const Icon = cat.icon
        return (
          <Card key={cat.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Icon className={cn('h-4 w-4', cat.color)} />
                {cat.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {items.map((tg) => {
                const r = results[tg.id]
                return (
                  <div
                    key={tg.id}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-md text-xs',
                      r?.success && 'bg-green-50/50 dark:bg-green-950/10',
                      r && !r.success && 'bg-red-50/50 dark:bg-red-950/10',
                      !r && 'bg-muted/30'
                    )}
                  >
                    <div className="w-5 flex justify-center">
                      {!r && <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />}
                      {r?.success && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                      {r && !r.success && <XCircle className="h-4 w-4 text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{tg.label}</div>
                      <div className="text-[10px] text-muted-foreground truncate" title={tg.url}>
                        {tg.url}
                      </div>
                      {tg.description && (
                        <div className="text-[10px] text-muted-foreground italic">{tg.description}</div>
                      )}
                      {r?.error && (
                        <div className="text-[10px] text-red-500 mt-0.5 flex items-start gap-1">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                          <span className="break-all">{r.error}</span>
                        </div>
                      )}
                    </div>
                    {r && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {r.httpStatus && (
                          <span className={cn(
                            'font-mono px-1.5 py-0.5 rounded',
                            r.httpStatus >= 200 && r.httpStatus < 300 && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                            r.httpStatus >= 400 && 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          )}>HTTP {r.httpStatus}</span>
                        )}
                        {r.latencyMs != null && (
                          <span className="font-mono tabular-nums">{r.latencyMs}ms</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
