import { shell } from 'electron'

export async function openExternalUrl(url: string): Promise<void> {
  await shell.openExternal(url)
}

export async function openFilePath(path: string): Promise<string> {
  return shell.openPath(path)
}
