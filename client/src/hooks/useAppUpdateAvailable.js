import { useEffect, useState } from 'react';
import { version as APP_VERSION } from '../../package.json';
import { API_URL } from '../api/config.js';

const POLL_MS = 10 * 60 * 1000; // 10min - não precisa ser mais agressivo que isso

// Detecta quando existe uma versão do client MAIS NOVA que a que já tá
// rodando nesta aba/janela - resolve o caso que o header Cache-Control (ver
// server/src/index.js) NÃO resolve: quem já tem o app ABERTO não faz
// nenhum request novo sozinho só porque um deploy aconteceu, fica preso na
// versão que carregou até recarregar manualmente. Aqui a gente PERGUNTA
// pro server de tempos em tempos (e quando a aba/janela volta a ficar
// visível, que é quando mais importa - alguém que deixou minimizado a
// noite toda) se a versão mudou, e avisa (ver UpdateAvailableBanner.jsx).
export function useAppUpdateAvailable() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let stopped = false;
    let interval;

    async function check() {
      try {
        const res = await fetch(`${API_URL}/api/version`, { cache: 'no-store' });
        const data = await res.json();
        if (!stopped && data.version && data.version !== APP_VERSION) {
          setUpdateAvailable(true);
          stopped = true;
          clearInterval(interval);
          document.removeEventListener('visibilitychange', onVisible);
        }
      } catch {
        // Server fora do ar/rede caiu - não é motivo pra avisar "tem
        // update", só tenta de novo no próximo ciclo.
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check();
    }

    check();
    interval = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return updateAvailable;
}
