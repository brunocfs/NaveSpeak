// Se VITE_API_URL não for definido explicitamente: em desenvolvimento
// (`vite`/`npm run dev:client`) assume a API rodando separada em
// localhost:4000; num build de produção (`vite build`), assume string vazia
// (mesma origem), porque em produção o próprio Express serve o bundle do
// client junto com a API (ver server/src/index.js) - então não há CORS
// envolvido nem necessidade de configurar nada.
export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');
