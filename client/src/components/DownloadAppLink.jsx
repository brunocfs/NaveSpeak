import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { isElectron } from "../api/media.js";

// Link "Baixar app" pra barra superior das telas - só faz sentido pra quem
// tá usando pelo NAVEGADOR: quem já abriu pelo app Electron não precisa
// baixar nada, ele mesmo é o app (nunca renderiza nada lá, `isElectron()`
// mesma detecção usada em VoiceStatusBar/media.js/PresenceContext).
// Aponta pra /baixar (DownloadPage.jsx) - a página escolhe Windows/Linux;
// ela é quem de fato chama /download no server (redireciona pro instalador
// mais recente publicado, ver server/src/index.js).
export default function DownloadAppLink() {
  if (isElectron()) return null;

  return (
    <Link
      to="/baixar"
      title="Baixar o app NaveSpeak para desktop"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <Download className="size-4" />
      Baixar app
    </Link>
  );
}
