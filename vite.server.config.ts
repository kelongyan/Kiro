import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'src/server/standalone.ts',
    outDir: 'out/server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: {
        entryFileNames: 'standalone.mjs'
      }
    }
  }
})
