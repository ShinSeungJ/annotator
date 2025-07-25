import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/

export default defineConfig({
  plugins: [react()],
  base: '/annotator/',
  server: {
    port: 5174,
    host: true, // allows access from LAN
  },
})
