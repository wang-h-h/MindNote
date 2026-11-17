import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    ...(command === 'serve'
      ? [
          {
            name: 'local-development-csp',
            transformIndexHtml(html: string) {
              return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
            },
          },
        ]
      : []),
  ],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
