import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const r = (p: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 直接从源码引用核心包（工作区内部包，无需预构建）
      '@studio/core': r('../../packages/core/src/index.ts'),
      '@': r('./src'),
    },
  },
  server: {
    port: 5175, strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/preview': 'http://127.0.0.1:8787',
    },
  },
});
