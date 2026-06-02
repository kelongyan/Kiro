export interface ImportedTextFile {
  content: string
  format: string
  name: string
}

export function exportTextFile(data: string, filename: string, type = 'text/plain'): boolean {
  try {
    const blob = new Blob([data], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    return true
  } catch (error) {
    console.error('[BrowserFiles] Export failed:', error)
    return false
  }
}

export function importTextFile(accept = '.json,.csv,.txt'): Promise<ImportedTextFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'

    const cleanup = (): void => {
      input.remove()
    }

    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        cleanup()
        resolve(null)
        return
      }

      try {
        const content = await file.text()
        const format = file.name.split('.').pop()?.toLowerCase() || 'json'
        resolve({ content, format, name: file.name })
      } catch (error) {
        console.error('[BrowserFiles] Import failed:', error)
        resolve(null)
      } finally {
        cleanup()
      }
    }

    document.body.appendChild(input)
    input.click()
  })
}
