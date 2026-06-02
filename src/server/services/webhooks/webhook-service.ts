import { randomUUID } from 'crypto'

export type WebhookKind = 'dingtalk' | 'wechat-work' | 'telegram' | 'discord' | 'feishu' | 'custom'

export type WebhookEvent =
  | 'batch-completed'
  | 'batch-error'
  | 'risk-warning'
  | 'account-banned'
  | 'register-success'
  | 'register-failed'
  | 'token-expired'

export interface WebhookEntry {
  id: string
  kind: WebhookKind
  url: string
  label?: string
  enabled: boolean
  telegramChatId?: string
  customTemplate?: string
  events: WebhookEvent[]
  createdAt: number
}

export interface WebhookMessage {
  title: string
  message: string
  level: 'info' | 'warn' | 'error' | 'success'
  fields?: Record<string, string | number>
}

export interface WebhookKeyValueStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface WebhookServiceDeps {
  store?: WebhookKeyValueStore
}

type WebhookInput = Omit<WebhookEntry, 'id' | 'createdAt'>

const STORAGE_KEY = 'webhooks'
const MAX_PER_MINUTE = 20
const RETRY_COUNT = 3
const RETRY_DELAY_BASE_MS = 1500

export class WebhookService {
  private deps: WebhookServiceDeps
  private webhooks = new Map<string, WebhookEntry>()
  private sendTimestamps = new Map<string, number[]>()
  private loaded = false

  constructor(deps: WebhookServiceDeps = {}) {
    this.deps = deps
  }

  health(): { success: boolean; count: number } {
    this.ensureLoaded()
    return { success: true, count: this.webhooks.size }
  }

  list(): { success: boolean; webhooks: WebhookEntry[] } {
    this.ensureLoaded()
    return { success: true, webhooks: Array.from(this.webhooks.values()) }
  }

  add(input: WebhookInput): { success: boolean; webhook?: WebhookEntry; error?: string } {
    this.ensureLoaded()
    const normalized = this.normalizeInput(input)
    if (!normalized.url) return { success: false, error: 'Missing url' }
    const webhook: WebhookEntry = {
      ...normalized,
      id: randomUUID(),
      createdAt: Date.now()
    }
    this.webhooks.set(webhook.id, webhook)
    this.save()
    return { success: true, webhook }
  }

  update(
    id: string,
    updates: Partial<WebhookInput>
  ): { success: boolean; webhook?: WebhookEntry; error?: string } {
    this.ensureLoaded()
    const existing = this.webhooks.get(id)
    if (!existing) return { success: false, error: 'Webhook 不存在' }
    const webhook = {
      ...existing,
      ...this.normalizePartial(updates),
      id,
      createdAt: existing.createdAt
    }
    this.webhooks.set(id, webhook)
    this.save()
    return { success: true, webhook }
  }

  remove(id: string): { success: boolean; error?: string } {
    this.ensureLoaded()
    if (!this.webhooks.delete(id)) return { success: false, error: 'Webhook 不存在' }
    this.save()
    return { success: true }
  }

  toggle(id: string): { success: boolean; webhook?: WebhookEntry; error?: string } {
    this.ensureLoaded()
    const existing = this.webhooks.get(id)
    if (!existing) return { success: false, error: 'Webhook 不存在' }
    const webhook = { ...existing, enabled: !existing.enabled }
    this.webhooks.set(id, webhook)
    this.save()
    return { success: true, webhook }
  }

  async test(id: string): Promise<{ success: boolean; error?: string }> {
    this.ensureLoaded()
    const webhook = this.webhooks.get(id)
    if (!webhook) return { success: false, error: 'Webhook 不存在' }
    try {
      await this.sendWebhook(webhook, {
        title: '测试通知',
        message: '这是来自 Kiro 账号管理器的测试消息。如果你看到这条消息，说明 Webhook 配置正确。',
        level: 'info',
        fields: { 时间: new Date().toLocaleString('zh-CN') }
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async trigger(
    event: WebhookEvent,
    payload: WebhookMessage
  ): Promise<{
    success: boolean
    delivered: number
    skipped: number
  }> {
    this.ensureLoaded()
    const targets = Array.from(this.webhooks.values()).filter(
      (webhook) => webhook.enabled && webhook.events.includes(event)
    )
    if (targets.length === 0) return { success: true, delivered: 0, skipped: 0 }

    const results = await Promise.allSettled(
      targets.map(async (webhook) => {
        await this.sendWebhook(webhook, payload)
      })
    )
    return {
      success: true,
      delivered: results.filter((result) => result.status === 'fulfilled').length,
      skipped: results.filter((result) => result.status === 'rejected').length
    }
  }

  triggerProxyEvent(event: string, payload: unknown): void {
    const mappedEvent = this.mapProxyEvent(event)
    const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const rawLevel = typeof data.level === 'string' ? data.level : undefined
    const level: WebhookMessage['level'] =
      rawLevel === 'error'
        ? 'error'
        : rawLevel === 'info'
          ? 'info'
          : rawLevel === 'success'
            ? 'success'
            : 'warn'

    void this.trigger(mappedEvent, {
      title: String(data.title ?? '反代告警'),
      message: String(data.message ?? ''),
      level,
      fields:
        data.fields && typeof data.fields === 'object'
          ? (data.fields as Record<string, string | number>)
          : undefined
    })
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    const saved = this.deps.store?.get(STORAGE_KEY)
    if (Array.isArray(saved)) {
      for (const item of saved) {
        if (this.isWebhookEntry(item)) {
          this.webhooks.set(item.id, item)
        }
      }
    }
    this.loaded = true
  }

  private save(): void {
    this.deps.store?.set(STORAGE_KEY, Array.from(this.webhooks.values()))
  }

  private async sendWebhook(webhook: WebhookEntry, payload: WebhookMessage): Promise<void> {
    if (!this.checkAndRecordRate(webhook.id)) {
      console.warn(
        `[Webhook] ${webhook.kind} ${webhook.label || webhook.id} rate limit exceeded (>${MAX_PER_MINUTE}/min), drop`
      )
      return
    }

    const body = this.buildWebhookBody(webhook, payload)
    const url = webhook.kind === 'telegram' ? this.buildTelegramUrl(webhook) : webhook.url
    let lastError: unknown
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      if (attempt > 0) {
        await this.delay(RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1))
      }
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        })
        clearTimeout(timer)
        if (resp.ok) return
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
          return
        }
        lastError = new Error(`HTTP ${resp.status}`)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private checkAndRecordRate(webhookId: string): boolean {
    const now = Date.now()
    const arr = this.sendTimestamps.get(webhookId) || []
    const filtered = arr.filter((time) => now - time < 60_000)
    if (filtered.length >= MAX_PER_MINUTE) {
      this.sendTimestamps.set(webhookId, filtered)
      return false
    }
    filtered.push(now)
    this.sendTimestamps.set(webhookId, filtered)
    return true
  }

  private buildTelegramUrl(webhook: WebhookEntry): string {
    return webhook.url.endsWith('/sendMessage')
      ? webhook.url
      : `${webhook.url.replace(/\/$/, '')}/sendMessage`
  }

  private buildWebhookBody(webhook: WebhookEntry, payload: WebhookMessage): unknown {
    const icon = ({ info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅' } as const)[payload.level]
    const fieldsText = payload.fields
      ? '\n' +
        Object.entries(payload.fields)
          .map(([key, value]) => `**${key}**: ${value}`)
          .join('\n')
      : ''
    const plainFields = payload.fields
      ? '\n' +
        Object.entries(payload.fields)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n')
      : ''
    const fullText = `${icon} ${payload.title}\n\n${payload.message}${plainFields}`

    switch (webhook.kind) {
      case 'dingtalk':
        return {
          msgtype: 'markdown',
          markdown: {
            title: payload.title,
            text: `### ${icon} ${payload.title}\n\n${payload.message}${fieldsText}`
          }
        }
      case 'wechat-work':
        return {
          msgtype: 'markdown',
          markdown: {
            content: `## ${icon} ${payload.title}\n\n${payload.message}${fieldsText}`
          }
        }
      case 'feishu':
        return {
          msg_type: 'text',
          content: { text: fullText }
        }
      case 'telegram':
        return {
          chat_id: webhook.telegramChatId,
          text: fullText,
          parse_mode: 'Markdown'
        }
      case 'discord':
        return {
          username: 'Kiro Account Manager',
          embeds: [
            {
              title: `${icon} ${payload.title}`,
              description: payload.message,
              color: this.discordColor(payload.level),
              fields: payload.fields
                ? Object.entries(payload.fields).map(([name, value]) => ({
                    name,
                    value: String(value),
                    inline: true
                  }))
                : undefined,
              timestamp: new Date().toISOString()
            }
          ]
        }
      case 'custom':
      default:
        if (webhook.customTemplate) {
          try {
            const template = webhook.customTemplate
              .replace(/\{\{title\}\}/g, this.escapeJsonString(payload.title))
              .replace(/\{\{message\}\}/g, this.escapeJsonString(payload.message))
              .replace(/\{\{level\}\}/g, payload.level)
              .replace(/\{\{icon\}\}/g, icon)
            return JSON.parse(template)
          } catch {
            // Fall through to default JSON body when a custom template is invalid.
          }
        }
        return {
          title: payload.title,
          message: payload.message,
          level: payload.level,
          fields: payload.fields,
          timestamp: new Date().toISOString()
        }
    }
  }

  private normalizeInput(input: WebhookInput): WebhookInput {
    return {
      ...input,
      kind: input.kind || 'custom',
      url: input.url || '',
      enabled: input.enabled !== false,
      events: Array.isArray(input.events)
        ? input.events
        : ['batch-completed', 'risk-warning', 'account-banned']
    }
  }

  private normalizePartial(input: Partial<WebhookInput>): Partial<WebhookInput> {
    return {
      ...input,
      events: Array.isArray(input.events) ? input.events : input.events
    }
  }

  private isWebhookEntry(value: unknown): value is WebhookEntry {
    if (!value || typeof value !== 'object') return false
    const item = value as Partial<WebhookEntry>
    return (
      typeof item.id === 'string' && typeof item.url === 'string' && typeof item.kind === 'string'
    )
  }

  private mapProxyEvent(event: string): WebhookEvent {
    if (event === 'proxy-account-suspended') return 'account-banned'
    return 'risk-warning'
  }

  private discordColor(level: WebhookMessage['level']): number {
    if (level === 'error') return 0xff0000
    if (level === 'warn') return 0xffaa00
    if (level === 'success') return 0x00ff00
    return 0x4a9eff
  }

  private escapeJsonString(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
