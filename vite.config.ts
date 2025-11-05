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
        // Ensure proper chunk loading order
        chunkFileNames: 'assets/[name]-[hash].js',

        // Manual chunk splitting for better caching
        manualChunks: (id) => {
          // React, React-DOM, and React-dependent libraries stay together
          // Let Vite handle React automatically to ensure proper dependency order
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }

          // UI components that depend on React (Radix UI)
          // These will load after vendor-react automatically
          if (id.includes('node_modules/@radix-ui')) {
            return 'vendor-ui';
          }

          // Date utilities
          if (id.includes('node_modules/date-fns')) {
            return 'vendor-date';
          }

          // Icons
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }

          // Drag and drop library
          if (id.includes('node_modules/@atlaskit') ||
              id.includes('node_modules/@atlaskit/pragmatic-drag-and-drop')) {
            return 'vendor-dnd';
          }

          // State management
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
