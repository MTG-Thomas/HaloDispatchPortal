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
          // React core libraries
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }

          // React Router
          if (id.includes('node_modules/react-router-dom') || id.includes('node_modules/react-router')) {
            return 'router';
          }

          // Radix UI components (shadcn/ui base)
          if (id.includes('node_modules/@radix-ui')) {
            return 'ui-components';
          }

          // Date utilities
          if (id.includes('node_modules/date-fns')) {
            return 'date-utils';
          }

          // Icons
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }

          // Drag and drop library
          if (id.includes('node_modules/@atlaskit')) {
            return 'drag-drop';
          }

          // State management
          if (id.includes('node_modules/zustand')) {
            return 'state';
          }

          // Other vendor code
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
