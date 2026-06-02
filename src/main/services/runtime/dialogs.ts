import {
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue
} from 'electron'

export function showOpenFileDialog(
  owner: BrowserWindow | null,
  options: OpenDialogOptions
): Promise<OpenDialogReturnValue> {
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

export function showSaveFileDialog(
  owner: BrowserWindow | null,
  options: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
}
