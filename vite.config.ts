import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://jon.doblados.net/pickleme/ (GitHub Pages project site).
export default defineConfig({
  plugins: [react()],
  base: '/pickleme/',
})
