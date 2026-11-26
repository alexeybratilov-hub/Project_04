import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

// Dev-сервер по умолчанию доступен только локально.
// Для проверки с другого устройства задайте DEV_HOST=0.0.0.0 и DEV_ALLOWED_HOSTS=*.
const devHost = process.env.DEV_HOST || 'localhost';
const allowedHosts: true | string[] =
  process.env.DEV_ALLOWED_HOSTS === '*'
    ? true
    : (process.env.DEV_ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',');

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          id: '/',
          name: 'ОТ-База — База данных по охране труда',
          short_name: 'ОТ-База',
          description: 'Автономная база данных по охране труда для Windows',
          theme_color: '#1e293b',
          background_color: '#0f172a',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/download\//, /^\/api\//, /^\/app\.html$/],
          globIgnores: ['**/app.html', '**/download/**'],
        },
      }),
    ],
    server: {
      host: devHost,
      port: 3000,
      allowedHosts,
      // HMR можно отключить переменной DISABLE_HMR=true (полезно при работе агентов).
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
