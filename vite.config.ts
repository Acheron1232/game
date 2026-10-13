import { defineConfig } from 'vite';
// @ts-ignore - plain ESM module
import { attachRelay } from './server/relay.mjs';

export default defineConfig({
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  plugins: [
    {
      name: 'coop-relay',
      configureServer(server) {
        if (server.httpServer) attachRelay(server.httpServer);
      },
      configurePreviewServer(server) {
        if (server.httpServer) attachRelay(server.httpServer);
      },
    },
  ],
  test: { environment: 'node' },
} as any);
