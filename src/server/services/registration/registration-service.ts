import {
  Registrar,
  newConfig,
  type RegistrationConfig,
  type RegistrationResult
} from '../../../core/registration'

const MANUAL_KEY = '__manual__'

export type RegistrationEventEmitter = (type: string, payload: unknown) => void

export interface RegistrationServiceDeps {
  emitEvent: RegistrationEventEmitter
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

export class RegistrationService {
  private registrarPool = new Map<string, Registrar>()
  private emitEvent: RegistrationEventEmitter

  constructor(deps: RegistrationServiceDeps) {
    this.emitEvent = deps.emitEvent
  }

  async startAuto(
    config: RegistrationStartConfig
  ): Promise<RegistrationServiceResult<RegistrationResult>> {
    const taskId = config.taskId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const logPrefix = config.taskId ? `[#${config.taskId.slice(0, 12)}] ` : ''

    const cfg = newConfig(config)
    cfg.manualMode = false
    const registrar = new Registrar(cfg, (message) =>
      this.sendLog(`${logPrefix}${message}`, config.taskId)
    )
    this.registrarPool.set(taskId, registrar)

    try {
      const result = await registrar.run()
      this.registrarPool.delete(taskId)
      if (!config.taskId) {
        this.emitEvent('registration-complete', result)
      }
      return { success: true, result }
    } catch (error) {
      this.registrarPool.delete(taskId)
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

    const cfg = newConfig(config)
    cfg.manualMode = true
    const registrar = new Registrar(cfg, (message) => this.sendLog(message))
    this.registrarPool.set(MANUAL_KEY, registrar)

    const result = await registrar.runManualPhase1()
    if (!result.success) {
      await registrar.destroy()
      this.registrarPool.delete(MANUAL_KEY)
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
    return { success: true, result }
  }

  async cancel(taskId?: string): Promise<{ success: true }> {
    if (taskId) {
      const registrar = this.registrarPool.get(taskId)
      if (registrar) {
        registrar.abort()
        await registrar.destroy()
        this.registrarPool.delete(taskId)
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
    this.emitEvent('registration-log', { message, taskId })
  }
}
