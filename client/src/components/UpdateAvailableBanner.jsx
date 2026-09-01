import { RefreshCw } from "lucide-react";
import { useAppUpdateAvailable } from "../hooks/useAppUpdateAvailable.js";

// Aviso "tem versão nova" pra quem já tá com o app aberto (aba do
// navegador OU janela do Electron) - ver useAppUpdateAvailable.js pro
// porquê disso existir além do Cache-Control (server/src/index.js): quem
// já carregou a página não faz nenhum request novo sozinho só porque um
// deploy aconteceu. reload() força buscar o index.html de novo (sempre
// fresco, no-store) e, por consequência, o bundle JS/CSS atual.
export default function UpdateAvailableBanner() {
  const updateAvailable = useAppUpdateAvailable();
  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md dark:bg-blue-700">
      <span>Uma nova versão do NaveSpeak está disponível.</span>
      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1 font-semibold transition hover:bg-white/25"
      >
        <RefreshCw className="size-3.5" />
        Atualizar agora
      </button>
    </div>
  );
}
