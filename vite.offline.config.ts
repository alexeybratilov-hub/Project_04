import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname || '.', '.'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta': JSON.stringify({
      env: { MODE: 'production', PROD: true, DEV: false, BASE_URL: './' }
    }),
  },
  build: {
    outDir: 'dist-offline',
    emptyOutDir: true,
    copyPublicDir: false,
    assetsInlineLimit: 10000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'OTBazaApp',
        inlineDynamicImports: true,
        entryFileNames: 'bundle.js',
        assetFileNames: 'bundle.[ext]',
      },
    },
  },
});
