import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Honor the port the preview harness assigns via PORT; fall back to 5178
    // for a plain `npm run dev`. strictPort so the URL the harness watches is
    // exactly the one Vite binds.
    port: Number(process.env.PORT) || 5178,
    strictPort: true,
  },
})
