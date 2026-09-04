import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // "true" faz o Vite escutar em todas as interfaces (não só localhost) -
    // necessário para outras máquinas na VPN acessarem o client em dev.
    host: true,
  },
  build: {
    // Nenhum .js importado com `?url` pode virar `data:text/javascript;base64,...`
    // no bundle: esses arquivos são AudioWorklets (noise gate, RNNoise, GTCRN,
    // DeepFilterNet3 - ver client/src/audio/*.js), carregados com
    // `audioWorklet.addModule(url)`, e a CSP de produção (`script-src 'self'`,
    // ver server/src/index.js) barra script em data: URI - em produção isso
    // aparecia como "AbortError: Unable to load a worklet's module" e o
    // supressor/gate caía silenciosamente pro áudio cru. Só o worklet do noise
    // gate era pequeno o bastante pra ser inlinado hoje (abaixo do limite
    // padrão de 4KB), mas a regra vale pra todos pra ninguém voltar a esbarrar
    // nisso ao trocar de biblioteca. Demais assets (imagens/fontes pequenas)
    // seguem a regra padrão do Vite - `undefined` = "decide você".
    assetsInlineLimit: (filePath) => (filePath.endsWith(".js") ? false : undefined),
  },
});
