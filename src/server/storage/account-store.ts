import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CryptoStore } from './crypto-store'

// ============ 账号数据类型 ============

export interface AccountData {
  accounts: Record<string, unknown>
  groups: Record<string, unknown>
  tags: Record<string, unknown>
  activeAccountId: string | null
  autoRefreshEnabled: boolean
  autoRefreshInterval: number
  autoRefreshConcurrency: number
  autoRefreshSyncInfo: boolean
  statusCheckInterval: number
  privacyMode: boolean
  usagePrecision: boolean
  proxyEnabled: boolean
  proxyUrl: string
  autoSwitchEnabled: boolean
  autoSwitchThreshold: number
  autoSwitchInterval: number
  switchTarget: string
  theme: string
  darkMode: boolean
  language: string
  machineIdConfig: Record<string, unknown>
  accountMachineIds: Record<string, string>
  machineIdHistory: Array<Record<string, unknown>>
  proxyPool: Record<string, unknown>
  proxyPoolConfig: Record<string, unknown>
  proxyPoolCursor: number
  accountProxyBindings: Record<string, string>
  [key: string]: unknown
}

// ============ 备份控制器接口 ============

interface BackupController {
  createBackup: (data: unknown) => Promise<void>
  flushBackupNow: () => Promise<void>
}

function createBackupController(
  getBackupDir: () => string,
  throttleMs: number = 5 * 60 * 1000
): BackupController {
  let lastBackupTime = 0
  let pendingBackupData: unknown = null
  let pendingBackupTimer: ReturnType<typeof setTimeout> | null = null

  async function writeBackupNow(): Promise<void> {
    if (pendingBackupData == null) return

    const data = pendingBackupData
    pendingBackupData = null
    lastBackupTime = Date.now()

    try {
      const dir = getBackupDir()
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const backupPath = join(dir, 'kiro-accounts.backup.json')
      writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf-8')
      console.log('[Backup] Data backup created')
    } catch (error) {
      console.error('[Backup] Failed to create backup:', error)
    }
  }

  async function createBackup(data: unknown): Promise<void> {
    pendingBackupData = data
    const now = Date.now()
    const elapsed = now - lastBackupTime

    if (elapsed >= throttleMs) {
      await writeBackupNow()
      return
    }

    if (!pendingBackupTimer) {
      const delay = throttleMs - elapsed
      pendingBackupTimer = setTimeout(() => {
        pendingBackupTimer = null
        void writeBackupNow()
      }, delay)
    }
  }

  async function flushBackupNow(): Promise<void> {
    if (pendingBackupTimer) {
      clearTimeout(pendingBackupTimer)
      pendingBackupTimer = null
    }
    if (pendingBackupData != null) {
      await writeBackupNow()
    }
  }

  return { createBackup, flushBackupNow }
}

// ============ AccountStore ============

export interface AccountStoreOptions {
  /** 数据目录 */
  dataDir: string
  /** 加密密码短语 */
  encryptionKey?: string
}

const DEFAULT_ENCRYPTION_KEY = 'kiro-account-manager-secret-key'

/**
 * 账号数据存储服务。
 *
 * 封装 load/save/backup，替代旧桌面存储直操模式。
 */
export class AccountStore {
  private crypto: CryptoStore
  private dataDir: string
  private backup: BackupController
  private lastSavedData: AccountData | null = null

  // 防抖写入
  private pendingWrites: Map<string, unknown> = new Map()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly FLUSH_INTERVAL = 5000

  constructor(opts: AccountStoreOptions) {
    this.dataDir = opts.dataDir

    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }

    const filePath = join(this.dataDir, 'kiro-accounts.enc.json')
    this.crypto = new CryptoStore({
      filePath,
      encryptionKey: opts.encryptionKey ?? DEFAULT_ENCRYPTION_KEY
    })

    this.backup = createBackupController(() => this.dataDir)
  }

  // ============ 数据读写 ============

  /**
   * 加载账号数据。只读取当前加密存储。
   */
  load(): AccountData | null {
    const data = this.crypto.get('accountData') as AccountData | undefined
    if (data) {
      this.lastSavedData = data
      return data
    }
    return null
  }

  /**
   * 保存账号数据。同时更新内存快照和触发备份。
   */
  save(data: AccountData): void {
    this.crypto.set('accountData', data)
    this.lastSavedData = data
    void this.backup.createBackup(data)
  }

  /**
   * 获取最后保存的数据（供 proxy server 回调等场景使用）。
   */
  getLastSavedData(): AccountData | null {
    return this.lastSavedData
  }

  // ============ 防抖写入（代理统计等高频场景） ============

  /**
   * 防抖设置单个 key（5 秒批量 flush，减少磁盘 I/O）。
   */
  debouncedSet(key: string, value: unknown): void {
    this.pendingWrites.set(key, value)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushPendingWrites(), this.FLUSH_INTERVAL)
    }
  }

  /**
   * 立即 flush 所有待写入数据。
   */
  flushPendingWrites(): void {
    this.flushTimer = null
    if (this.pendingWrites.size === 0) return

    for (const [key, value] of this.pendingWrites) {
      this.crypto.set(key, value)
    }
    this.pendingWrites.clear()
  }

  // ============ 备份 ============

  async createBackup(data: AccountData): Promise<void> {
    await this.backup.createBackup(data)
  }

  async flushBackupNow(): Promise<void> {
    await this.backup.flushBackupNow()
  }

  // ============ 存储路径信息 ============

  /** 获取存储文件路径 */
  get storePath(): string {
    return this.crypto.path
  }

  /** 获取数据目录路径 */
  get dataDirPath(): string {
    return this.dataDir
  }

  // ============ 关闭 ============

  /**
   * 关闭前 flush 所有待写入数据和备份。
   */
  async shutdown(): Promise<void> {
    this.flushPendingWrites()
    await this.backup.flushBackupNow()
  }
}
