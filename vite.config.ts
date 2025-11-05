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
        // Manual chunk splitting for better caching
        manualChunks: (id) => {
          // CRITICAL: Bundle React with all React-dependent libraries
          // to avoid race conditions in chunk loading
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/@radix-ui') ||
              id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }

          // Date utilities - safe to separate (no React dependency)
          if (id.includes('node_modules/date-fns')) {
            return 'vendor-date';
          }

          // Icons - safe to separate (tree-shaken, minimal React usage)
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }

          // Drag and drop library
          if (id.includes('node_modules/@atlaskit')) {
            return 'vendor-dnd';
          }

          // State management - safe to separate
          if (id.includes('node_modules/zustand')) {
            return 'vendor-state';
          }

          // All other vendor dependencies
          if (id.includes('node_modules')) {
            return 'vendor-misc';
          }
        },
      },
    },

    // Minification settings
    minify: 'esbuild',
    target: 'es2020',
  },
})
