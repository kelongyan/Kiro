import {
  Registrar,
  newConfig,
  type LogFn,
  type RegistrationConfig,
  type RegistrationResult
} from '../../../core/registration'
import type { ProxyPoolPick } from '../proxy-pool/proxy-pool-service'

const MANUAL_KEY = '__manual__'

export type RegistrationEventEmitter = (type: string, payload: unknown) => void

export interface RegistrationServiceDeps {
  emitEvent: RegistrationEventEmitter
  pickProxyForRegistration?: () => ProxyPoolPick | null
  reportProxyResult?: (
    proxyId: string,
    success: boolean,
    boundEmail?: string,
    error?: string
  ) => void
  createRegistrar?: (config: RegistrationConfig, log: LogFn) => RegistrationRunner
}

export interface RegistrationStatus {
  inProgress: boolean
  count: number
}

export interface RegistrationStartConfig extends Partial<RegistrationConfig> {
  taskId?: string
}

export interface RegistrationServiceResult<T = unknown> {
  success: boolean
  result?: T
  error?: string
}

interface RegistrationRunner {
  run(): Promise<RegistrationResult>
  runManualPhase1(): Promise<{ success: boolean; error?: string }>
  runManualPhase2(email: string, fullName?: string): Promise<{ success: boolean; error?: string }>
  runManualPhase3(otp: string): Promise<RegistrationResult>
  abort(): void
  destroy(): Promise<void>
}

interface SelectedRegistrationProxy {
  id: string
  url: string
}

export class RegistrationService {
  private registrarPool = new Map<string, RegistrationRunner>()
  private manualProxySelections = new Map<string, SelectedRegistrationProxy>()
  private deps: RegistrationServiceDeps

  constructor(deps: RegistrationServiceDeps) {
    this.deps = deps
  }

  async startAuto(
    config: RegistrationStartConfig
  ): Promise<RegistrationServiceResult<RegistrationResult>> {
    const taskId = config.taskId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const logPrefix = config.taskId ? `[#${config.taskId.slice(0, 12)}] ` : ''

    const selectedProxy = this.pickProxyIfNeeded(config)
    const cfg = newConfig({
      ...config,
      proxy: config.proxy || selectedProxy?.url || ''
    })
    cfg.manualMode = false
    const registrar = this.createRegistrar(cfg, (message) =>
      this.sendLog(`${logPrefix}${message}`, config.taskId)
    )
    this.registrarPool.set(taskId, registrar)

    try {
      const result = await registrar.run()
      this.registrarPool.delete(taskId)
      this.reportSelectedProxy(
        selectedProxy,
        result.status === 'success',
        result.email,
        result.error
      )
      if (!config.taskId) {
        this.deps.emitEvent('registration-complete', result)
      }
      return { success: true, result }
    } catch (error) {
      this.registrarPool.delete(taskId)
      this.reportSelectedProxy(
        selectedProxy,
        false,
        undefined,
        error instanceof Error ? error.message : String(error)
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async manualPhase1(
    config: Partial<RegistrationConfig>
  ): Promise<{ success: boolean; error?: string }> {
    if (this.registrarPool.has(MANUAL_KEY)) {
      return { success: false, error: '已有手动注册流程正在进行' }
    }

    const selectedProxy = this.pickProxyIfNeeded(config)
    const cfg = newConfig({
      ...config,
      proxy: config.proxy || selectedProxy?.url || ''
    })
    cfg.manualMode = true
    const registrar = this.createRegistrar(cfg, (message) => this.sendLog(message))
    this.registrarPool.set(MANUAL_KEY, registrar)
    if (selectedProxy) {
      this.manualProxySelections.set(MANUAL_KEY, selectedProxy)
    }

    const result = await registrar.runManualPhase1()
    if (!result.success) {
      await registrar.destroy()
      this.registrarPool.delete(MANUAL_KEY)
      this.reportManualProxy(false, undefined, result.error)
    }
    return result
  }

  async manualPhase2(
    email: string,
    fullName?: string
  ): Promise<{ success: boolean; error?: string }> {
    const registrar = this.registrarPool.get(MANUAL_KEY)
    if (!registrar) {
      return { success: false, error: '无进行中的注册流程' }
    }

    const result = await registrar.runManualPhase2(email, fullName)
    if (!result.success) {
      await registrar.destroy()
      this.registrarPool.delete(MANUAL_KEY)
      this.reportManualProxy(false, email, result.error)
    }
    return result
  }

  async manualPhase3(otp: string): Promise<RegistrationServiceResult<RegistrationResult>> {
    const registrar = this.registrarPool.get(MANUAL_KEY)
    if (!registrar) {
      return { success: false, error: '无进行中的注册流程' }
    }

    const result = await registrar.runManualPhase3(otp)
    await registrar.destroy()
    this.registrarPool.delete(MANUAL_KEY)
    this.reportManualProxy(result.status === 'success', result.email, result.error)
    return { success: true, result }
  }

  async cancel(taskId?: string): Promise<{ success: true }> {
    if (taskId) {
      const registrar = this.registrarPool.get(taskId)
      if (registrar) {
        registrar.abort()
        await registrar.destroy()
        this.registrarPool.delete(taskId)
        if (taskId === MANUAL_KEY) {
          this.reportManualProxy(false, undefined, '注册已取消')
        }
      }
      return { success: true }
    }

    const tasks = Array.from(this.registrarPool.entries())
    for (const [id, registrar] of tasks) {
      registrar.abort()
      await registrar.destroy()
      this.registrarPool.delete(id)
    }
    return { success: true }
  }

  status(): RegistrationStatus {
    return {
      inProgress: this.registrarPool.size > 0,
      count: this.registrarPool.size
    }
  }

  async shutdown(): Promise<void> {
    await this.cancel()
  }

  private sendLog(message: string, taskId?: string): void {
    this.deps.emitEvent('registration-log', { message, taskId })
  }

  private createRegistrar(config: RegistrationConfig, log: LogFn): RegistrationRunner {
    return this.deps.createRegistrar?.(config, log) || new Registrar(config, log)
  }

  private pickProxyIfNeeded(config: Partial<RegistrationConfig>): SelectedRegistrationProxy | null {
    if (config.proxy && config.proxy.trim()) return null
    const picked = this.deps.pickProxyForRegistration?.()
    if (!picked) return null
    this.sendLog(`[ProxyPool] Using ${picked.protocol}://${picked.host}:${picked.port}`)
    return { id: picked.id, url: picked.url }
  }

  private reportSelectedProxy(
    proxy: SelectedRegistrationProxy | null,
    success: boolean,
    boundEmail?: string,
    error?: string
  ): void {
    if (!proxy) return
    this.deps.reportProxyResult?.(proxy.id, success, boundEmail, error)
  }

  private reportManualProxy(success: boolean, boundEmail?: string, error?: string): void {
    const proxy = this.manualProxySelections.get(MANUAL_KEY)
    if (!proxy) return
    this.manualProxySelections.delete(MANUAL_KEY)
    this.reportSelectedProxy(proxy, success, boundEmail, error)
  }
}
