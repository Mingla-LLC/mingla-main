import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@components': path.resolve(__dirname, './components'),
      '@screens': path.resolve(__dirname, './screens'),
      '@theme': path.resolve(__dirname, './theme'),
      '@navigation': path.resolve(__dirname, './navigation'),
      '@utils': path.resolve(__dirname, './components/utils'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['lucide-react', 'motion'],
          'utils': ['date-fns'],
        },
      },
    },
  },
});
