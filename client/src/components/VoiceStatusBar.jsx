import { useState } from "react";
import { Link } from "react-router-dom";
import { Mic, MicOff, Video, VideoOff, ScreenShare, Headphones } from "lucide-react";
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

  if (!media.voiceChannelId) return null;

  async function toggleScreenShare() {
    if (media.sharingScreen) {
      media.stopScreenShare();
      return;
    }
    if (isElectron()) {
      const sources = await listScreenSources();
      setScreenPickerSources(sources ?? []);
      return;
    }
    media.shareScreen();
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
        <ScreenShare className="size-5 text-white" />
      </button>
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
          onSelect={(sourceId) => {
            setScreenPickerSources(null);
            media.shareScreen(sourceId);
          }}
          onCancel={() => setScreenPickerSources(null)}
        />
      )}
    </div>
  );
}
