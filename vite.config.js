import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' lets us control exactly when the new SW activates,
      // so musicians see a banner and choose when to refresh.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg', 'searchWorker.js'],
      manifest: {
        name: 'Coro Pro-Web',
        short_name: 'Coro',
        description: 'Cancionero interactivo para músicos',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Cache all static assets with content-hash versioning
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],

        // CRITICAL: Never cache Google Sheets / Google API requests.
        // The app fetches live CSV data — the SW must never intercept it.
        navigateFallbackDenylist: [/^https:\/\/docs\.google\.com/, /^https:\/\/sheets\.googleapis\.com/],

        runtimeCaching: [
          {
            // Completely bypass the SW for any Google Sheets export URL
            urlPattern: /^https:\/\/docs\.google\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Bypass for Google APIs in general
            urlPattern: /^https:\/\/.*\.googleapis\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // JetBrains Mono font: cache-first (rarely changes)
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],

        // Clean up old caches automatically on SW activation
        cleanupOutdatedCaches: true,
        skipWaiting: false, // We control activation from the UI banner
        clientsClaim: true,
      },

      // Enable SW in dev so we can test the update flow
      devOptions: {
        enabled: false, // flip to true only for local SW debugging
        type: 'module',
      },
    })
  ],
  server: {
    port: 4000,
    strictPort: true,
  }
})
