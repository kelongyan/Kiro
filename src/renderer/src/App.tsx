import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, KeyRound, RefreshCw, WifiOff } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar } from './components/layout'
import { renderPage } from './app/page-registry'
import type { PageType } from './app/navigation'
import { getInitialPageFromUrl, setPageInUrl } from './app/page-url'
import { Button, Card, CardContent, CardHeader, CardTitle } from './components/ui'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import { cn } from './lib/utils'
import { useWebhookStore } from './store/webhooks'
import { useAccountsStore } from './store/accounts'
import {
  closeLocalAdminEvents,
  connectLocalAdminEvents,
  onLocalAdminEvent
} from './services/local-admin-events'
import {
  getLocalAdminAccessToken,
  requestJson,
  setLocalAdminAccessToken,
  LocalAdminClientError
} from './services/local-admin-client'

// 后台刷新结果批量化间隔：N 条结果合并到一次 set，避免 N 次 Map 全量复制 + 渲染抖动
const BACKGROUND_RESULT_FLUSH_MS = 120

type AppShellState = 'ready' | 'missing-token' | 'connecting' | 'offline' | 'unauthorized'

function isLocalAdminUnavailable(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /fetch/i.test(error.message))
}

function App(): React.JSX.Element {
  const [currentPage, setCurrentPage] = useState<PageType>(() =>
    getInitialPageFromUrl(window.location.search, window.location.hash)
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [shellState, setShellState] = useState<AppShellState>(() =>
    getLocalAdminAccessToken() ? 'connecting' : 'missing-token'
  )
  const [shellError, setShellError] = useState<string | null>(null)

  const {
    loadFromStorage,
    startAutoTokenRefresh,
    stopAutoTokenRefresh,
    applyBackgroundRefreshResults,
    applyBackgroundCheckResults,
    flushSaveImmediately,
    updateAccountStatus
  } = useAccountsStore()

  const handlePageChange = useCallback((page: PageType): void => {
    setCurrentPage(page)
    window.history.replaceState(null, '', setPageInUrl(window.location.href, page))
  }, [])

  const verifyLocalAdmin = useCallback(async (): Promise<void> => {
    const token = getLocalAdminAccessToken()
    if (!token) {
      setShellState('missing-token')
      setShellError('缺少本地管理访问令牌')
      return
    }

    setShellState((prev) => (prev === 'ready' ? prev : 'connecting'))
    try {
      await requestJson('/api/proxy/status')
      setShellState('ready')
      setShellError(null)
    } catch (error) {
      if (error instanceof LocalAdminClientError && error.status === 401) {
        setShellState('unauthorized')
        setShellError(error.message)
        return
      }
      if (isLocalAdminUnavailable(error)) {
        setShellState('offline')
        setShellError(error instanceof Error ? error.message : '本地服务不可达')
        return
      }
      setShellState('offline')
      setShellError(error instanceof Error ? error.message : '本地服务不可用')
    }
  }, [])

  // 应用启动时加载数据并启动自动刷新
  useEffect(() => {
    void verifyLocalAdmin()
  }, [verifyLocalAdmin])

  useEffect(() => {
    loadFromStorage().then(() => {
      startAutoTokenRefresh()
    })
    // 加载 Webhook 配置
    useWebhookStore.getState().loadFromStorage()

    return () => {
      stopAutoTokenRefresh()
    }
  }, [loadFromStorage, startAutoTokenRefresh, stopAutoTokenRefresh])

  useEffect(() => {
    if (shellState !== 'ready') return
    connectLocalAdminEvents()
    return () => {
      closeLocalAdminEvents()
    }
  }, [shellState])

  useEffect(() => {
    const handlePopState = (): void => {
      setCurrentPage(getInitialPageFromUrl(window.location.search, window.location.hash))
    }
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  // 反代关键事件 → 触发 webhook（v1.8 新增）
  // 由 proxyServer 内置的 webhookTrigger 通过本地 SSE 推送过来，统一在 renderer 调 useWebhookStore
  useEffect(() => {
    const unsubscribe = onLocalAdminEvent('proxy-webhook-trigger', ({ payload: eventPayload }) => {
      try {
        const { event, payload } = eventPayload
        const store = useWebhookStore.getState()
        // 映射反代事件名 → Webhook 事件类型
        const webhookEventMap: Record<string, 'risk-warning' | 'account-banned'> = {
          'proxy-account-suspended': 'account-banned',
          'proxy-all-exhausted': 'risk-warning'
        }
        const targetEvent = webhookEventMap[event] || 'risk-warning'
        // 规范化 level（main 用 'error'/'info' 等字符串字面量，需要映射到 store 接受的类型）
        const rawLevel = (payload as { level?: string })?.level
        const level: 'info' | 'warn' | 'error' | 'success' =
          rawLevel === 'error'
            ? 'error'
            : rawLevel === 'info'
              ? 'info'
              : rawLevel === 'success'
                ? 'success'
                : 'warn'
        void store.triggerEvent(targetEvent, {
          title: String((payload as Record<string, unknown>).title ?? '反代告警'),
          message: String((payload as Record<string, unknown>).message ?? ''),
          level,
          fields: (payload as { fields?: Record<string, string | number> })?.fields
        })
      } catch (err) {
        console.error('[App] Proxy webhook trigger failed:', err)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  // 关闭/刷新前强制 flush 防抖中的待保存数据，防止数据丢失
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      void flushSaveImmediately()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [flushSaveImmediately])

  // 监听后台刷新结果：缓冲 + 批量化 flush，N 条结果合并为一次 set，消除 Map 复制风暴
  useEffect(() => {
    const refreshBuffer: Array<{ id: string; success: boolean; data?: unknown; error?: string }> =
      []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = (): void => {
      flushTimer = null
      if (refreshBuffer.length === 0) return
      const batch = refreshBuffer.splice(0)
      applyBackgroundRefreshResults(batch)
    }

    const unsubscribe = onLocalAdminEvent('background-refresh-result', ({ payload }) => {
      refreshBuffer.push(payload)
      if (!flushTimer) {
        flushTimer = setTimeout(flush, BACKGROUND_RESULT_FLUSH_MS)
      }
    })
    return () => {
      unsubscribe()
      if (flushTimer) {
        clearTimeout(flushTimer)
        // 卸载前 flush 剩余结果，防止丢失
        flush()
      }
    }
  }, [applyBackgroundRefreshResults])

  // 监听后台检查结果：同样的批量化策略
  useEffect(() => {
    const checkBuffer: Array<{ id: string; success: boolean; data?: unknown; error?: string }> = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = (): void => {
      flushTimer = null
      if (checkBuffer.length === 0) return
      const batch = checkBuffer.splice(0)
      applyBackgroundCheckResults(batch)
    }

    const unsubscribe = onLocalAdminEvent('background-check-result', ({ payload }) => {
      checkBuffer.push(payload)
      if (!flushTimer) {
        flushTimer = setTimeout(flush, BACKGROUND_RESULT_FLUSH_MS)
      }
    })
    return () => {
      unsubscribe()
      if (flushTimer) {
        clearTimeout(flushTimer)
        flush()
      }
    }
  }, [applyBackgroundCheckResults])

  // 监听反代账号被封禁事件（TEMPORARILY_SUSPENDED / AccountSuspendedException）
  // 反代触发后，把封禁状态同步到 store 让 UI 显示
  useEffect(() => {
    const unsubscribe = onLocalAdminEvent('proxy-account-suspended', ({ payload: info }) => {
      console.warn(`[App] Account suspended via proxy: ${info.email || info.id} (${info.reason})`)
      updateAccountStatus(info.id, 'error', `[${info.reason}] ${info.message}`)
    })
    return () => {
      unsubscribe()
    }
  }, [updateAccountStatus])

  return (
    <AppErrorBoundary>
      {shellState !== 'ready' ? (
        <AppShellFallback
          shellState={shellState}
          shellError={shellError}
          onRetry={() => void verifyLocalAdmin()}
          onClearToken={() => {
            setLocalAdminAccessToken(null)
            setShellState('missing-token')
            setShellError('本地访问令牌已清除')
          }}
        />
      ) : (
        <div className="h-screen ambient-bg overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 flex gap-2 p-2">
            <Sidebar
              currentPage={currentPage}
              onPageChange={handlePageChange}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
            <main className="flex-1 min-w-0 overflow-hidden rounded-3xl page-surface">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentPage}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  className="h-full flex flex-col"
                >
                  {renderPage(currentPage)}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      )}
    </AppErrorBoundary>
  )
}

export default App

function AppShellFallback({
  shellState,
  shellError,
  onRetry,
  onClearToken
}: {
  shellState: AppShellState
  shellError: string | null
  onRetry: () => void
  onClearToken: () => void
}): React.JSX.Element {
  const icon =
    shellState === 'missing-token' ? (
      <KeyRound className="h-5 w-5" />
    ) : shellState === 'connecting' ? (
      <RefreshCw className="h-5 w-5 animate-spin" />
    ) : shellState === 'unauthorized' ? (
      <AlertTriangle className="h-5 w-5" />
    ) : (
      <WifiOff className="h-5 w-5" />
    )

  const title =
    shellState === 'missing-token'
      ? '缺少访问令牌'
      : shellState === 'connecting'
        ? '正在连接本地服务'
        : shellState === 'unauthorized'
          ? '访问令牌无效'
          : '本地服务不可达'

  const description =
    shellState === 'missing-token'
      ? '请使用带 ?token=... 的本地管理地址打开页面，或重新从服务端复制访问链接。'
      : shellState === 'connecting'
        ? '正在验证本地管理服务与访问令牌。'
        : shellState === 'unauthorized'
          ? '当前保存的本地访问令牌已失效，清除后请重新从服务端访问链接进入。'
          : '本地服务当前没有响应。确认 standalone 服务还在运行，然后再重试。'

  return (
    <div className="min-h-screen ambient-bg flex items-center justify-center p-6">
      <Card variant="glass-strong" className="w-full max-w-2xl rounded-3xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3 text-foreground">
            {icon}
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>{description}</p>
          {shellError && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-foreground">
              {shellError}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button onClick={onRetry}>
              <RefreshCw className={cn('h-4 w-4', shellState === 'connecting' && 'animate-spin')} />
              重试连接
            </Button>
            {shellState === 'unauthorized' && (
              <Button variant="outline" onClick={onClearToken}>
                清除令牌
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
