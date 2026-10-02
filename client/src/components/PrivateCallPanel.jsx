import { useState } from "react";
import {
  Camera,
  CameraOff,
  ExternalLink,
  Fullscreen,
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Shrink,
} from "lucide-react";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useCall } from "../context/CallContext.jsx";
import { isElectron, listScreenSources } from "../api/media.js";
import SimpleVideoGrid from "./SimpleVideoGrid.jsx";
import ScreenSourcePicker from "./ScreenSourcePicker.jsx";
import AddCallParticipant from "./AddCallParticipant.jsx";
import Avatar from "./Avatar.jsx";

const ctrlBtn =
  "cursor-pointer inline-flex size-11 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50";
const ctrlIdle =
  "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
const ctrlOn = "bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-400";
const ctrlOff = "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400";
const smallBtn =
  "cursor-pointer inline-flex size-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white";

// Conteúdo do VoicePanel quando a voz ativa é uma CHAMADA PRIVADA - embutido
// na DM (DmPanel.jsx registra o panelAnchor) ou na janela desacoplada. Só a
// apresentação muda: tiles, <audio>, popouts e fullscreen continuam vindo do
// VoicePanel (uma única instância de cada <video>/<audio>, nada de consumir a
// mesma mídia duas vezes). Todos os controles ficam na barra de baixo.
export default function PrivateCallPanel({
  contentRef,
  tiles,
  pinnedKeys,
  onTogglePin,
  poppedOutKeys,
  onTogglePopoutTile,
  popout,
  onTogglePopout,
  isFullscreen,
  onToggleFullscreen,
  error,
}) {
  const media = useMediaSession();
  const { activeRoster, callPeer, ringing, callExpanded, setCallExpanded, leaveCall } = useCall();
  const [pickerSources, setPickerSources] = useState(null);
  const [pickerMode, setPickerMode] = useState("share");
  const [pickerError, setPickerError] = useState(null);

  // Mesmo fluxo de openSourcePicker de RoomPage/DmSidebar: abre o modal na
  // hora ("loading") e preenche quando o Electron devolver as fontes.
  async function openSourcePicker(mode) {
    setPickerError(null);
    setPickerMode(mode);
    if (!isElectron()) {
      setPickerSources([]);
      return;
    }
    setPickerSources("loading");
    try {
      const sources = await listScreenSources();
      setPickerSources((cur) => (cur === "loading" ? (sources ?? []) : cur));
    } catch (err) {
      setPickerSources(null);
      setPickerError(err.message ?? "Não foi possível listar as telas/janelas disponíveis.");
    }
  }

  const invitedNames = activeRoster.filter((p) => p.status === "invited").map((p) => p.username);
  const micBlocked = media.muted && media.audioLocked;
  const camBlocked = !media.cameraOn && media.mediaLocked;

  return (
    <div
      ref={contentRef}
      className="flex h-full min-h-0 flex-col bg-slate-100 text-slate-900 dark:bg-[#0f1117] dark:text-white"
    >
      {(invitedNames.length > 0 || error) && (
        <div className="shrink-0 px-4 pt-3 text-center text-xs">
          {invitedNames.length > 0 && (
            <p className="text-slate-500 dark:text-slate-400">Chamando {invitedNames.join(", ")}...</p>
          )}
          {error && <p className="text-red-500 dark:text-red-400">{error}</p>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {ringing && callPeer ? (
          <div className="flex h-full flex-col items-center justify-center gap-4" role="status">
            <span className="relative inline-flex">
              <span className="absolute inset-0 animate-ping rounded-full bg-purple-500/30 motion-reduce:animate-none" />
              <Avatar avatarPath={callPeer.avatarPath} username={callPeer.username} size="xl" />
            </span>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Chamando {callPeer.username}...
            </p>
          </div>
        ) : (
          <SimpleVideoGrid
            tiles={tiles}
            pinnedKeys={pinnedKeys}
            onTogglePin={onTogglePin}
            deafened={media.deafened}
            poppedOutKeys={poppedOutKeys}
            onTogglePopout={onTogglePopoutTile}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="flex items-center gap-1">
          <AddCallParticipant roster={activeRoster} />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={media.toggleMute}
            disabled={micBlocked}
            aria-pressed={media.muted}
            aria-label={media.muted ? "Ativar microfone" : "Silenciar microfone"}
            title={micBlocked ? "Seu áudio foi bloqueado" : media.muted ? "Ativar microfone" : "Silenciar microfone"}
            className={`${ctrlBtn} ${media.muted ? ctrlOff : ctrlIdle}`}
          >
            {media.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
          <button
            type="button"
            onClick={media.toggleDeafen}
            aria-pressed={media.deafened}
            aria-label={media.deafened ? "Voltar a ouvir" : "Ensurdecer"}
            title={media.deafened ? "Voltar a ouvir" : "Ensurdecer"}
            className={`${ctrlBtn} ${media.deafened ? ctrlOff : ctrlIdle}`}
          >
            {media.deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
          </button>
          <button
            type="button"
            onClick={media.cameraOn ? media.stopCamera : media.shareCamera}
            disabled={camBlocked}
            aria-pressed={media.cameraOn}
            aria-label={media.cameraOn ? "Desligar câmera" : "Ligar câmera"}
            title={camBlocked ? "Sua mídia foi bloqueada" : media.cameraOn ? "Desligar câmera" : "Ligar câmera"}
            className={`${ctrlBtn} ${media.cameraOn ? ctrlOn : ctrlIdle}`}
          >
            {media.cameraOn ? <Camera className="size-5" /> : <CameraOff className="size-5" />}
          </button>
          <button
            type="button"
            onClick={() => (media.sharingScreen ? media.stopScreenShare() : openSourcePicker("share"))}
            onContextMenu={(e) => {
              if (!media.sharingScreen) return;
              e.preventDefault();
              openSourcePicker("switch");
            }}
            disabled={!media.sharingScreen && media.mediaLocked}
            aria-pressed={media.sharingScreen}
            aria-label={media.sharingScreen ? "Parar de compartilhar a tela" : "Compartilhar tela"}
            title={
              media.sharingScreen
                ? "Parar de compartilhar (clique direito: trocar a fonte)"
                : "Compartilhar tela"
            }
            className={`${ctrlBtn} ${media.sharingScreen ? ctrlOn : ctrlIdle}`}
          >
            {media.sharingScreen ? <MonitorX className="size-5" /> : <MonitorUp className="size-5" />}
          </button>
          <button
            type="button"
            onClick={leaveCall}
            aria-label="Desligar"
            title="Desligar"
            className={`${ctrlBtn} w-14 ${ctrlOff}`}
          >
            <PhoneOff className="size-5" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* Expandir só faz sentido embutido na DM - na janela desacoplada o
              painel já é a janela inteira. */}
          {!popout && (
            <button
              type="button"
              onClick={() => setCallExpanded((v) => !v)}
              aria-pressed={callExpanded}
              aria-label={callExpanded ? "Mostrar o chat" : "Expandir chamada"}
              title={callExpanded ? "Mostrar o chat" : "Expandir chamada"}
              className={smallBtn}
            >
              {callExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={onTogglePopout}
            aria-label={popout ? "Encaixar de volta" : "Abrir em uma nova janela"}
            title={popout ? "Encaixar de volta" : "Abrir em uma nova janela"}
            className={smallBtn}
          >
            <ExternalLink className="size-4" />
          </button>
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            className={smallBtn}
          >
            {isFullscreen ? <Shrink className="size-4" /> : <Fullscreen className="size-4" />}
          </button>
        </div>
      </div>

      {pickerSources && (
        <ScreenSourcePicker
          sources={pickerSources}
          title={pickerMode === "switch" ? "Trocar para qual fonte?" : "Escolha o que compartilhar"}
          defaultWithAudio={pickerMode === "switch" ? media.screenAudioEnabled : false}
          onSelect={(sourceId, withAudio, quality) => {
            setPickerSources(null);
            if (pickerMode === "switch") media.switchScreenSource(sourceId, { withAudio, quality });
            else media.shareScreen(sourceId, { withAudio, quality });
          }}
          onCancel={() => setPickerSources(null)}
        />
      )}
      {pickerError && (
        <p role="alert" className="shrink-0 px-4 pb-2 text-center text-xs text-red-500 dark:text-red-400">
          {pickerError}
        </p>
      )}
    </div>
  );
}
