export interface BackupStoreLike {
  path: string
}

export interface BackupController {
  createBackup: (data: unknown) => Promise<void>
  flushBackupNow: () => Promise<void>
}

export function createBackupController(
  getStore: () => BackupStoreLike | null,
  throttleMs: number = 5 * 60 * 1000
): BackupController {
  let lastBackupTime = 0
  let pendingBackupData: unknown = null
  let pendingBackupTimer: ReturnType<typeof setTimeout> | null = null

  async function writeBackupNow(): Promise<void> {
    const store = getStore()
    if (!store || pendingBackupData == null) return

    const data = pendingBackupData
    pendingBackupData = null
    lastBackupTime = Date.now()

    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      const backupPath = path.join(path.dirname(store.path), 'kiro-accounts.backup.json')
      await fs.writeFile(backupPath, JSON.stringify(data, null, 2), 'utf-8')
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

  return {
    createBackup,
    flushBackupNow
  }
}
