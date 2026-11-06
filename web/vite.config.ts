import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5174/3002 so this runs next to the docs-chatbot project (5173/3001).
    port: 5174,
    // The proxy makes the API same-origin in development, so the session cookie just works.
    proxy: { '/api': 'http://localhost:3002' },
  },
  build: { sourcemap: true },
});
