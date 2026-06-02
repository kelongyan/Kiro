import { join } from 'path'
import { CryptoStore } from './crypto-store'

export interface ConfigStoreOptions {
  dataDir: string
  encryptionKey?: string
}

const DEFAULT_ENCRYPTION_KEY = 'kiro-account-manager-secret-key'

export class ConfigStore {
  private store: CryptoStore

  constructor(options: ConfigStoreOptions) {
    this.store = new CryptoStore({
      filePath: join(options.dataDir, 'kiro-config.enc.json'),
      encryptionKey: options.encryptionKey || DEFAULT_ENCRYPTION_KEY
    })
  }

  get(key: string): unknown {
    return this.store.get(key)
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value)
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  has(key: string): boolean {
    return this.store.has(key)
  }
}
