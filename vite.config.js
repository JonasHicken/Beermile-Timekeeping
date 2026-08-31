import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Offline support is not a nicety here: this app is used trackside, where
    // signal is unreliable. Timing DATA already lives in localStorage, but
    // without a service worker the app SHELL still needs the network — so a
    // reload (or a relaunch from the home screen) with no bars would show a
    // blank page mid-race. Precaching the shell makes it start from cache.
    VitePWA({
      registerType: 'autoUpdate',
      // index.html already links public/manifest.webmanifest; don't emit a second.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // Keep the Excel parser out of the offline install: it's ~425 kB, and
        // importing a start list is a pre-race job done with a connection.
        // What has to work offline is TIMING, not setup.
        globIgnores: ['**/xlsx-*.js'],
        // React Router routes aren't files, so unmatched navigations must fall
        // back to the cached shell rather than a cache miss.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    // Honor the port the preview harness assigns via PORT; fall back to 5178
    // for a plain `npm run dev`. strictPort so the URL the harness watches is
    // exactly the one Vite binds.
    port: Number(process.env.PORT) || 5178,
    strictPort: true,
  },
})
