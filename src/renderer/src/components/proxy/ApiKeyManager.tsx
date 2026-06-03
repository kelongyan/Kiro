import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  BarChart3,
  Clock,
  Zap,
  MessageSquare,
  ExternalLink
} from 'lucide-react'
import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/store/accounts'
import * as proxyAdmin from '@/services/local-admin-proxy'
import { ApiKeyUsageDialog } from './ApiKeyUsageDialog'

type ApiKeyFormat = 'sk' | 'simple' | 'token'

interface UsageRecord {
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  credits: number
  path: string
}

interface ApiKey {
  id: string
  name: string
  key: string
  format?: ApiKeyFormat
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
  creditsLimit?: number
  modelAllowlist?: string[]
  accountAllowlist?: string[]
  usage: {
    totalRequests: number
    totalCredits: number
    totalInputTokens: number
    totalOutputTokens: number
    daily: Record<
      string,
      {
        requests: number
        credits: number
        inputTokens: number
        outputTokens: number
      }
    >
    byModel?: Record<
      string,
      {
        requests: number
        credits: number
        inputTokens: number
        outputTokens: number
      }
    >
  }
  usageHistory?: UsageRecord[]
}

export function ApiKeyManager() {
  const { language } = useAccountsStore()
  const accounts = useAccountsStore((state) => state.accounts)
  const isEn = language === 'en'

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyFormat, setNewKeyFormat] = useState<ApiKeyFormat>('sk')
  const [newKeyCreditsLimit, setNewKeyCreditsLimit] = useState<string>('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showUsageDialog, setShowUsageDialog] = useState(false)

  const loadApiKeys = useCallback(async () => {
    try {
      const result = await proxyAdmin.proxyGetApiKeys()
      if (result.success) {
        setApiKeys(result.apiKeys)
      }
    } catch (error) {
      console.error('Failed to load API keys:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApiKeys()
  }, [loadApiKeys])

  const handleAddKey = async () => {
    if (!newKeyName.trim()) return

    try {
      const creditsLimit = newKeyCreditsLimit ? parseFloat(newKeyCreditsLimit) : undefined
      const result = await proxyAdmin.proxyAddApiKey({
        name: newKeyName.trim(),
        format: newKeyFormat,
        creditsLimit: creditsLimit && creditsLimit > 0 ? creditsLimit : undefined
      })
      if (result.success && result.apiKey) {
        setApiKeys((prev) => [...prev, result.apiKey!])
        setNewKeyName('')
        setNewKeyCreditsLimit('')
      }
    } catch (error) {
      console.error('Failed to add API key:', error)
    }
  }

  const handleDeleteKey = async (id: string) => {
    if (!confirm(isEn ? 'Delete this API key?' : '确定删除此 API Key？')) return

    try {
      const result = await proxyAdmin.proxyDeleteApiKey(id)
      if (result.success) {
        setApiKeys((prev) => prev.filter((k) => k.id !== id))
        if (selectedKey === id) setSelectedKey(null)
      }
    } catch (error) {
      console.error('Failed to delete API key:', error)
    }
  }

  const handleToggleKey = async (id: string, enabled: boolean) => {
    try {
      const result = await proxyAdmin.proxyUpdateApiKey(id, { enabled })
      if (result.success) {
        setApiKeys((prev) => prev.map((k) => (k.id === id ? { ...k, enabled } : k)))
      }
    } catch (error) {
      console.error('Failed to toggle API key:', error)
    }
  }

  const applyApiKeyUpdates = async (
    id: string,
    updates: {
      creditsLimit?: number | null
      modelAllowlist?: string[]
      accountAllowlist?: string[]
    }
  ) => {
    const result = await proxyAdmin.proxyUpdateApiKey(id, updates)
    if (result.success && result.apiKey) {
      setApiKeys((prev) => prev.map((key) => (key.id === id ? result.apiKey! : key)))
    }
  }

  const handleResetUsage = async (id: string) => {
    if (!confirm(isEn ? 'Reset usage statistics?' : '确定重置用量统计？')) return

    try {
      const result = await proxyAdmin.proxyResetApiKeyUsage(id)
      if (result.success) {
        setApiKeys((prev) =>
          prev.map((k) =>
            k.id === id
              ? {
                  ...k,
                  usage: {
                    totalRequests: 0,
                    totalCredits: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    daily: {}
                  }
                }
              : k
          )
        )
      }
    } catch (error) {
      console.error('Failed to reset usage:', error)
    }
  }

  const copyToClipboard = (id: string, key: string) => {
    navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  }

  const maskKey = (key: string) => {
    return key.substring(0, 8) + '...' + key.substring(key.length - 4)
  }

  const parseList = (value: string): string[] => {
    return Array.from(
      new Set(
        value
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )
  }

  const accountOptions = Array.from(accounts.values()).filter((account) => account.email)
  const selectedKeyData = apiKeys.find((k) => k.id === selectedKey)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{isEn ? 'API Keys' : 'API 密钥'}</CardTitle>
            </div>
            <span className="text-sm text-muted-foreground">
              {apiKeys.length} {isEn ? 'keys' : '个'}
            </span>
          </div>
          <CardDescription>
            {isEn ? 'Manage API keys for authentication' : '管理用于身份验证的 API 密钥'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder={isEn ? 'Key name...' : '密钥名称...'}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
                className="flex-1"
              />
              <Select
                value={newKeyFormat}
                options={[
                  { value: 'sk', label: 'sk-xxx' },
                  { value: 'simple', label: 'PROXY_KEY' },
                  { value: 'token', label: 'KEY:TOKEN' }
                ]}
                onChange={(v) => setNewKeyFormat(v as ApiKeyFormat)}
                className="w-[120px]"
              />
              <Button onClick={handleAddKey} disabled={!newKeyName.trim()}>
                <Plus className="h-4 w-4 mr-1" />
                {isEn ? 'Add' : '添加'}
              </Button>
            </div>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                placeholder={isEn ? 'Credits limit (optional)' : 'Credits 额度限制（可选）'}
                value={newKeyCreditsLimit}
                onChange={(e) => setNewKeyCreditsLimit(e.target.value)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {isEn ? '0 = unlimited' : '0 = 无限制'}
              </span>
            </div>
          </div>

          {apiKeys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isEn ? 'No API keys yet' : '暂无 API 密钥'}
            </div>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((apiKey) => (
                <div
                  key={apiKey.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer',
                    selectedKey === apiKey.id ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50',
                    !apiKey.enabled && 'opacity-50'
                  )}
                  onClick={() => setSelectedKey(selectedKey === apiKey.id ? null : apiKey.id)}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={apiKey.enabled}
                      onCheckedChange={(enabled) => handleToggleKey(apiKey.id, enabled)}
                    />
                  </div>

                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="font-medium truncate">{apiKey.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <code className="bg-muted px-1 rounded">
                        {showKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                      </code>
                      <button
                        className="hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleShowKey(apiKey.id)
                        }}
                      >
                        {showKeys.has(apiKey.id) ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        className="hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyToClipboard(apiKey.id, apiKey.key)
                        }}
                      >
                        {copiedId === apiKey.id ? (
                          <Check className="h-3 w-3 text-success" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="text-right text-xs text-muted-foreground">
                    <div>
                      {apiKey.usage.totalRequests} {isEn ? 'requests' : '请求'}
                    </div>
                    <div
                      className={cn(
                        apiKey.creditsLimit &&
                          apiKey.usage.totalCredits >= apiKey.creditsLimit &&
                          'text-destructive font-medium'
                      )}
                    >
                      {apiKey.usage.totalCredits.toFixed(2)}
                      {apiKey.creditsLimit ? `/${apiKey.creditsLimit}` : ''} credits
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteKey(apiKey.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedKeyData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">
                  {isEn ? 'Usage Details' : '用量详情'}: {selectedKeyData.name}
                </CardTitle>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowUsageDialog(true)}>
                  <ExternalLink className="h-3 w-3 mr-1" />
                  {isEn ? 'View Details' : '查看详情'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResetUsage(selectedKeyData.id)}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {isEn ? 'Reset Usage' : '重置用量'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-xs">{isEn ? 'Total Requests' : '总请求数'}</span>
                </div>
                <div className="text-2xl font-bold">{selectedKeyData.usage.totalRequests}</div>
              </div>

              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Zap className="h-4 w-4" />
                  <span className="text-xs">{isEn ? 'Total Credits' : '总 Credits'}</span>
                </div>
                <div className="text-2xl font-bold">
                  {selectedKeyData.usage.totalCredits.toFixed(2)}
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <span className="text-xs">{isEn ? 'Input Tokens' : '输入 Tokens'}</span>
                </div>
                <div className="text-2xl font-bold">
                  {selectedKeyData.usage.totalInputTokens.toLocaleString()}
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <span className="text-xs">{isEn ? 'Output Tokens' : '输出 Tokens'}</span>
                </div>
                <div className="text-2xl font-bold">
                  {selectedKeyData.usage.totalOutputTokens.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {isEn ? 'Credits Limit:' : 'Credits 额度限制:'}
                </span>
                <Input
                  type="number"
                  placeholder={isEn ? 'Unlimited' : '无限制'}
                  value={selectedKeyData.creditsLimit || ''}
                  onChange={async (e) => {
                    const limit = e.target.value ? parseFloat(e.target.value) : null
                    await applyApiKeyUpdates(selectedKeyData.id, {
                      creditsLimit: limit && limit > 0 ? limit : null
                    })
                  }}
                  className="w-32 h-8"
                />
                <span className="text-xs text-muted-foreground">
                  {isEn ? '(0 = unlimited)' : '(0 = 无限制)'}
                </span>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="text-sm font-medium">{isEn ? 'Permission Scope' : '权限范围'}</div>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">
                    {isEn ? 'Model allowlist' : '模型白名单'}
                  </div>
                  <Input
                    key={`models-${selectedKeyData.id}-${selectedKeyData.modelAllowlist?.join('|') || 'all'}`}
                    defaultValue={selectedKeyData.modelAllowlist?.join(', ') || ''}
                    placeholder={
                      isEn
                        ? 'Empty = all models, e.g. anthropic.*, model-id'
                        : '留空 = 全部模型，例如 anthropic.*, model-id'
                    }
                    onBlur={(event) =>
                      void applyApiKeyUpdates(selectedKeyData.id, {
                        modelAllowlist: parseList(event.currentTarget.value)
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {isEn ? 'Account allowlist' : '账号白名单'}
                    </div>
                    {(selectedKeyData.accountAllowlist?.length || 0) > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          void applyApiKeyUpdates(selectedKeyData.id, { accountAllowlist: [] })
                        }
                      >
                        {isEn ? 'Allow all' : '允许全部'}
                      </Button>
                    )}
                  </div>
                  {accountOptions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {isEn ? 'No local accounts available' : '暂无本地账号可选'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {accountOptions.slice(0, 8).map((account) => {
                        const selected = selectedKeyData.accountAllowlist?.includes(account.id)
                        return (
                          <button
                            key={account.id}
                            type="button"
                            className={cn(
                              'rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                              selected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'hover:bg-muted/60'
                            )}
                            onClick={() => {
                              const current = new Set(selectedKeyData.accountAllowlist || [])
                              if (current.has(account.id)) current.delete(account.id)
                              else current.add(account.id)
                              void applyApiKeyUpdates(selectedKeyData.id, {
                                accountAllowlist: Array.from(current)
                              })
                            }}
                          >
                            <div className="truncate font-medium">{account.email}</div>
                            <div className="truncate text-muted-foreground">{account.id}</div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    {isEn
                      ? 'Empty account scope lets this key use every synced proxy account.'
                      : '账号范围为空时，此 Key 可使用所有已同步到反代池的账号。'}
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  <span>
                    {isEn ? 'Created:' : '创建时间:'} {formatDate(selectedKeyData.createdAt)}
                  </span>
                </div>
                {selectedKeyData.lastUsedAt && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    <span>
                      {isEn ? 'Last used:' : '最后使用:'} {formatDate(selectedKeyData.lastUsedAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 用量详情对话框 */}
      <ApiKeyUsageDialog
        open={showUsageDialog}
        onOpenChange={setShowUsageDialog}
        apiKey={selectedKeyData || null}
      />
    </div>
  )
}
