import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), 'storage-worker': resolve('src/main/storage-worker.ts'),
          'storage-acceptance': resolve('src/main/storage-acceptance.ts') },
        output: { entryFileNames: '[name].cjs', format: 'cjs' }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { entryFileNames: 'index.cjs', format: 'cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: {
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve('src/renderer/index.html') }
    }
  }
});
