import { useState } from "react";
import { Link } from "react-router-dom";
import { Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, RefreshCw, Volume2, Headphones } from "lucide-react";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { isElectron, listScreenSources } from "../api/media.js";
import ScreenSourcePicker from "./ScreenSourcePicker.jsx";

// Barra fixa "na voz", montada uma única vez em App.jsx (fora de <Routes>),
// para ficar visível em qualquer tela - sala, tela inicial, chat privado -
// enquanto a chamada de voz seguir ativa. Antes ela vivia dentro de RoomPage
// e sumia (sem derrubar a chamada, só a visão dela) sempre que o usuário
// saía da tela da sala.
export default function VoiceStatusBar() {
  const media = useMediaSession();
  // Fontes de tela/janela do Electron - fora dele, getDisplayMedia já mostra
  // o seletor nativo do navegador, então isso fica sempre null.
  const [screenPickerSources, setScreenPickerSources] = useState(null);
  // 'share' = começar um compartilhamento novo; 'switch' = trocar a fonte de
  // um compartilhamento JÁ ativo (mesmo modal, texto/callback diferentes -
  // ver ScreenSourcePicker.jsx). Só importa enquanto screenPickerSources !=
  // null.
  const [screenPickerMode, setScreenPickerMode] = useState("share");
  const [screenPickerError, setScreenPickerError] = useState(null);

  if (!media.voiceChannelId) return null;

  async function openSourcePicker(mode) {
    setScreenPickerError(null);
    try {
      const sources = await listScreenSources();
      setScreenPickerMode(mode);
      setScreenPickerSources(sources ?? []);
    } catch (err) {
      // Sem try/catch aqui antes: se o IPC (ipcMain.handle('screen:get-sources'))
      // rejeitasse - desktopCapturer falhando por qualquer motivo do lado
      // nativo -, a promise estourava sem handler e o clique parecia não
      // fazer NADA (sem seletor, sem erro visível nenhum). Agora loga e
      // mostra o motivo real em vez de falhar em silêncio.
      console.error("[screen-share] Falha ao listar fontes de tela:", err);
      setScreenPickerError(err.message ?? "Não foi possível listar as telas/janelas disponíveis.");
    }
  }

  function toggleScreenShare() {
    if (media.sharingScreen) {
      media.stopScreenShare();
      return;
    }
    if (isElectron()) {
      openSourcePicker("share");
      return;
    }
    // Navegador comum: getDisplayMedia({ audio: true }) só faz o seletor
    // NATIVO mostrar a opção "Compartilhar áudio" - quem decide de verdade
    // se ela vem é o usuário ali (ver requestScreenStream em api/media.js).
    media.shareScreen(undefined, { withAudio: true });
  }

  function switchScreenSource() {
    if (isElectron()) {
      openSourcePicker("switch");
      return;
    }
    media.switchScreenSource(undefined, { withAudio: true });
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-lg dark:bg-slate-900 dark:text-slate-100">
      <Link
        to={media.voiceRoomId ? `/rooms/${media.voiceRoomId}` : "/rooms"}
        className="text-sm font-medium hover:underline"
        title="Voltar para a chamada"
      >
        🔊 Na voz:{" "}
        {media.voiceRoomName ? `${media.voiceRoomName} · ` : ""}
        {media.voiceChannelName ?? "canal"}
      </Link>
      <button
        onClick={() => (media.cameraOn ? media.stopCamera() : media.shareCamera())}
        title={media.cameraOn ? "Desligar câmera" : "Ligar câmera"}
        className={`rounded-xl px-3 py-3 cursor-pointer transition ${
          media.cameraOn ? "bg-blue-600 hover:bg-blue-500" : "bg-gray-600 hover:bg-gray-500"
        }`}
      >
        {media.cameraOn ? (
          <Video className="size-5 text-white" />
        ) : (
          <VideoOff className="size-5 text-white" />
        )}
      </button>
      <button
        onClick={toggleScreenShare}
        title={media.sharingScreen ? "Parar compartilhamento" : "Compartilhar tela"}
        className={`rounded-xl px-3 py-3 cursor-pointer transition ${
          media.sharingScreen ? "bg-blue-600 hover:bg-blue-500" : "bg-gray-600 hover:bg-gray-500"
        }`}
      >
        {media.sharingScreen ? (
          <ScreenShareOff className="size-5 text-white" />
        ) : (
          <ScreenShare className="size-5 text-white" />
        )}
      </button>
      {media.sharingScreen && (
        <button
          onClick={switchScreenSource}
          title="Trocar a tela/janela compartilhada (sem parar o compartilhamento)"
          className="rounded-xl bg-gray-600 px-3 py-3 cursor-pointer transition hover:bg-gray-500"
        >
          <RefreshCw className="size-5 text-white" />
        </button>
      )}
      {media.sharingScreen && media.screenAudioEnabled && (
        <div
          className="flex items-center gap-1.5 rounded-xl bg-gray-700 px-2.5 py-2"
          title={`Volume do áudio compartilhado: ${media.screenAudioVolume}%`}
        >
          <Volume2 className="size-4 text-white shrink-0" />
          <input
            type="range"
            min={0}
            max={200}
            value={media.screenAudioVolume}
            onChange={(e) => media.setLocalScreenAudioVolume(Number(e.target.value))}
            className="h-1 w-16 cursor-pointer accent-blue-400"
          />
        </div>
      )}
      <button
        onClick={() => media.toggleMute()}
        title={media.muted ? "Ativar microfone" : "Silenciar microfone"}
        className={`rounded-xl px-3 py-3 cursor-pointer transition ${
          // Cor segue `micTransmitting` (mute manual + trava + push-to-talk
          // juntos), não só `muted` - com push-to-talk ligado o botão
          // continua alternando o mute MANUAL (onClick), mas o vermelho
          // precisa refletir se o mic está mesmo transmitindo agora, senão
          // ficaria cinza (parece ativo) com a tecla de PTT solta.
          media.micTransmitting ? "bg-gray-600 hover:bg-gray-500" : "bg-red-600 hover:bg-red-500"
        }`}
      >
        {media.micTransmitting ? (
          <Mic className="size-5 text-white" />
        ) : (
          <MicOff className="size-5 text-white" />
        )}
      </button>
      <button
        onClick={() => media.toggleDeafen()}
        title={media.deafened ? "Ouvir todos" : "Silenciar todos"}
        className={`rounded-xl px-3 py-3 cursor-pointer transition ${
          media.deafened ? "bg-red-600 hover:bg-red-500" : "bg-gray-600 hover:bg-gray-500"
        }`}
      >
        <Headphones className="size-5 text-white" />
      </button>
      <button
        onClick={() => media.leaveVoice()}
        className="rounded-xl bg-red-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
      >
        Sair da voz
      </button>

      {screenPickerSources && (
        <ScreenSourcePicker
          sources={screenPickerSources}
          title={screenPickerMode === "switch" ? "Trocar para qual fonte?" : "Escolha o que compartilhar"}
          defaultWithAudio={screenPickerMode === "switch" ? media.screenAudioEnabled : false}
          onSelect={(sourceId, withAudio) => {
            setScreenPickerSources(null);
            if (screenPickerMode === "switch") media.switchScreenSource(sourceId, { withAudio });
            else media.shareScreen(sourceId, { withAudio });
          }}
          onCancel={() => setScreenPickerSources(null)}
        />
      )}

      {screenPickerError && (
        <div
          className="fixed bottom-24 left-1/2 z-10 -translate-x-1/2 cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
          role="alert"
          title="Clique para fechar"
          onClick={() => setScreenPickerError(null)}
        >
          {screenPickerError}
        </div>
      )}
    </div>
  );
}
