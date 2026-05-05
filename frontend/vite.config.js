import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/upload': 'http://localhost:4000',
      '/assess': 'http://localhost:4000',
      '/plan': 'http://localhost:4000',
      '/migrate': 'http://localhost:4000',
      '/dashboard': 'http://localhost:4000',
    }
  }
})
