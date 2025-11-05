import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Source maps for production debugging
    sourcemap: false,

    // Chunk size warning threshold (500kb)
    chunkSizeWarningLimit: 500,

    rollupOptions: {
      output: {
        // Conservative manual chunk splitting to avoid circular dependencies
        manualChunks: (id) => {
          // Only split large, stable libraries that rarely change
          // Everything else stays together to avoid dependency issues

          // React ecosystem - bundle everything React-related together
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/@radix-ui') ||
              id.includes('node_modules/scheduler')) {
            return 'vendor';
          }

          // Date utilities - large and stable
          if (id.includes('node_modules/date-fns')) {
            return 'vendor';
          }

          // Icons - large and stable
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor';
          }

          // Everything else goes into vendor (no micro-chunking)
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },

    // Minification settings
    minify: 'esbuild',
    target: 'es2020',
  },
})
