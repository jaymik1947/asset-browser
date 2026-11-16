import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5273,
    strictPort: true,
  },
  build: {
    target: 'chrome110',
    sourcemap: false,
  },
})
