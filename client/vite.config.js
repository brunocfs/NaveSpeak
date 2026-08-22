import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // "true" faz o Vite escutar em todas as interfaces (não só localhost) -
    // necessário para outras máquinas na VPN acessarem o client em dev.
    host: true,
  },
});
