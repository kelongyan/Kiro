import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

interface EncryptedPayload {
  salt: string
  iv: string
  tag: string
  data: string
}

export interface CryptoStoreOptions {
  /** 存储文件绝对路径 */
  filePath: string
  /** 密码短语 */
  encryptionKey: string
  /** PBKDF2 迭代次数，默认 100000 */
  iterations?: number
}

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const SALT_LENGTH = 32

/**
 * 纯 Node.js 的 AES-256-GCM 加密 JSON 存储。
 *
 * - 使用 PBKDF2 从密码短语派生 256-bit key
 * - AES-256-GCM 加密（带 auth tag 防篡改）
 * - 原子写入：先写 .tmp 再 rename
 * - 提供 get/set/delete/has 存储 API
 */
export class CryptoStore {
  private filePath: string
  private derivedKey: Buffer
  private salt: Buffer
  private store: Record<string, unknown> = {}
  private dirty = false

  constructor(opts: CryptoStoreOptions) {
    this.filePath = opts.filePath
    const iterations = opts.iterations ?? 100_000

    // 尝试从已有文件读取 salt，否则生成新的
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8')
        const payload = JSON.parse(raw) as EncryptedPayload
        this.salt = Buffer.from(payload.salt, 'hex')
      } catch {
        this.salt = randomBytes(SALT_LENGTH)
      }
    } else {
      this.salt = randomBytes(SALT_LENGTH)
    }

    this.derivedKey = pbkdf2Sync(opts.encryptionKey, this.salt, iterations, KEY_LENGTH, 'sha512')

    // 如果文件存在，加载数据
    if (existsSync(this.filePath)) {
      try {
        this.load()
      } catch (error) {
        console.error('[CryptoStore] Failed to load, starting fresh:', error)
        this.store = {}
      }
    }
  }

  get path(): string {
    return this.filePath
  }

  get(key: string, defaultValue?: unknown): unknown {
    const value = this.store[key]
    return value === undefined ? defaultValue : value
  }

  set(key: string, value: unknown): void {
    this.store[key] = value
    this.dirty = true
    this.save()
  }

  delete(key: string): void {
    delete this.store[key]
    this.dirty = true
    this.save()
  }

  has(key: string): boolean {
    return key in this.store
  }

  /** 从文件读取并解密 */
  load(): void {
    const raw = readFileSync(this.filePath, 'utf-8')
    const payload = JSON.parse(raw) as EncryptedPayload
    const decrypted = this.decrypt(payload)
    this.store = JSON.parse(decrypted) as Record<string, unknown>
    this.dirty = false
  }

  /** 加密并写入文件（原子操作） */
  save(): void {
    const json = JSON.stringify(this.store)
    const payload = this.encrypt(json)

    // 确保目录存在
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // 原子写入：先写 .tmp 再 rename
    const tmpPath = this.filePath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8')
    renameSync(tmpPath, this.filePath)
    this.dirty = false
  }

  /** 是否有未持久化的改动 */
  isDirty(): boolean {
    return this.dirty
  }

  /** 获取底层存储对象（用于迁移/调试） */
  getStoreObject(): Record<string, unknown> {
    return this.store
  }

  /** 批量设置（不触发立即保存，配合手动 save()） */
  setBatch(entries: Record<string, unknown>): void {
    Object.assign(this.store, entries)
    this.dirty = true
  }

  private encrypt(data: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.derivedKey, iv)

    let encrypted = cipher.update(data, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const tag = cipher.getAuthTag()

    return {
      salt: this.salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted
    }
  }

  private decrypt(payload: EncryptedPayload): string {
    const iv = Buffer.from(payload.iv, 'hex')
    const tag = Buffer.from(payload.tag, 'hex')

    const decipher = createDecipheriv(ALGORITHM, this.derivedKey, iv)
    decipher.setAuthTag(tag)

    let decrypted = decipher.update(payload.data, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }
}
