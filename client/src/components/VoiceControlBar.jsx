import { useRef, useState } from "react";
import {
  Mic,
  MicOff,
  HeadphoneOff,
  Headphones,
  Camera,
  CameraOff,
  ScreenShare,
  RefreshCw,
  PhoneOff,
  Volume2,
  SwitchCamera,
} from "lucide-react";
import Avatar from "./Avatar.jsx";
import StatusDot from "./StatusDot.jsx";
import ConnectionStatusButton from "./ConnectionStatusButton.jsx";
import StatusSelector from "./StatusSelector.jsx";
import PreferencesModal from "./PreferencesModal.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import SoundboardPanel from "./SoundboardPanel.jsx";
import AudioQuickSettings from "./AudioQuickSettings.jsx";
// Mini painel de controles de mídia da sidebar de voz - extraído de
// RoomPage.jsx pra poder ser reusado em outras telas (ex.: uma janela
// separada/PiP no futuro). `media` (useMediaSession) e `user` (useAuth) vêm
// direto dos contexts, não como props - RoomPage já os lia dos mesmos
// hooks, então nenhuma tela que use este painel precisa estar dentro de um
// provider diferente do que já usa.
//
// `toggleScreenShare`/`switchScreenSource` continuam vindo de fora (props):
// no Electron eles abrem o seletor de fonte de tela (ScreenSourcePicker),
// cujo estado/modal mora na tela que hospeda este painel - mover isso pra cá
// também exigiria mover o modal inteiro junto, o que foge do escopo de só
// reaproveitar os botões de mic/câmera/tela/status.
// Troca frontal/traseira só faz sentido em aparelho de toque (celular/tablet);
// no desktop a webcam é escolhida em Preferências.
const isTouchDevice =
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches;
// Navegador de celular não tem getDisplayMedia - esconde o botão em vez de
// deixar um clique que só falha.
const canShareScreen =
  typeof navigator !== "undefined" &&
  (Boolean(navigator.mediaDevices?.getDisplayMedia) ||
    Boolean(window.naveSpeak?.getScreenSources));

export default function VoiceControlBar({
  toggleScreenShare,
  switchScreenSource,
}) {
  const media = useMediaSession();
  const { user } = useAuth();
  const [openUserStatus, setOpenUserStatus] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const soundboardBtnRef = useRef(null);
  return (
    <>
      {/* overflow-hidden removido de propósito: essa barra não tem cantos
          arredondados (não precisa clipar nada) e estava cortando o popover
          do ConnectionStatusButton, que abre pra CIMA (bottom-full) e
          precisa extrapolar essa caixa. */}
      {media.connected && (
        <div className="flex p-2 shadow-sm bg-slate-50 dark:bg-[#0b0c10f8] min-w-0">
          <div className="flex flex-1 gap-2 justify-between items-center min-w-0">
            {/* Estatísticas de conexão (ping/perda de pacote) - ver
              ConnectionStatusButton.jsx, dados vêm de
              useNetworkStats() (MediaSessionContext). */}
            <ConnectionStatusButton />
            <div className="flex gap-2  items-center">
              <button
                onClick={() =>
                  media.cameraOn ? media.stopCamera() : media.shareCamera()
                }
                title={media.cameraOn ? "Desligar câmera" : "Ligar câmera"}
                className={`rounded-xl px-2 py-2 cursor-pointer transition ${
                  media.cameraOn
                    ? "bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-400"
                    : "text-slate-600 hover:bg-slate-200 dark:text-white dark:hover:bg-gray-500"
                }`}
              >
                {media.cameraOn ? (
                  <CameraOff className="size-4" />
                ) : (
                  <Camera className="size-4" />
                )}
              </button>
              {media.cameraOn && isTouchDevice && (
                <button
                  onClick={() => media.flipCamera()}
                  title="Alternar câmera frontal/traseira"
                  aria-label="Alternar câmera frontal/traseira"
                  className="rounded-xl px-2 py-2 cursor-pointer transition text-slate-600 hover:bg-slate-200 dark:text-white dark:hover:bg-gray-500"
                >
                  <SwitchCamera className="size-4" />
                </button>
              )}
              {canShareScreen && (
              <button
                onClick={toggleScreenShare}
                title={
                  media.sharingScreen
                    ? "Parar compartilhamento"
                    : "Compartilhar tela"
                }
                className={`rounded-xl px-2 py-2 cursor-pointer transition ${
                  media.sharingScreen
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : "text-slate-600 hover:bg-slate-200 dark:text-white dark:hover:bg-gray-500"
                }`}
              >
                <ScreenShare className="size-4" />
              </button>
              )}
              {media.sharingScreen && (
                <button
                  onClick={switchScreenSource}
                  title="Trocar a tela/janela compartilhada (sem parar o compartilhamento)"
                  className="rounded-xl px-2 py-2 cursor-pointer bg-slate-600 text-white transition hover:bg-slate-500"
                >
                  <RefreshCw className="size-4" />
                </button>
              )}

              {media.voiceRoomId && (
                <button
                  ref={soundboardBtnRef}
                  onClick={() => setSoundboardOpen(true)}
                  title="Efeitos sonoros"
                  className="cursor-pointer rounded-lg px-2 py-2 text-sm transition text-slate-600 hover:bg-slate-200 dark:text-white dark:hover:bg-gray-500"
                >
                  <Volume2 className="size-4" />
                </button>
              )}

              {soundboardOpen && media.voiceRoomId && (
                <SoundboardPanel
                  roomId={media.voiceRoomId}
                  anchorEl={soundboardBtnRef.current}
                  onClose={() => setSoundboardOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {openUserStatus && (
        <div className=" fixed w-50 left-50 bottom-60 rounded-full">
          <button onClick={() => setOpenUserStatus((prev) => !prev)}>
            <StatusSelector onDot={true} />
          </button>
        </div>
      )}
      <div className="flex justify-between p-1 shadow-sm min-w-0 overflow-hidden bg-slate-50 dark:bg-[#0b0c10f8]">
        <div className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 transition dark:text-slate-200 min-w-0">
          <span className="relative inline-flex shrink-0">
            <button
              className="cursor-pointer"
              onClick={() => setOpenUserStatus((prev) => !prev)}
            >
              <Avatar
                avatarPath={user?.avatarPath}
                username={user?.username}
                size="md"
              />
            </button>

            <StatusDot
              status={user?.status ?? "offline"}
              className="absolute -right-0.5 -bottom-0.5 ring-2 ring-slate-50 dark:ring-slate-800/60"
            />
          </span>

          <PreferencesModal />
        </div>

        <div className="flex flex-1 gap-2 items-center   ">
          <div className="flex min-w-0">
            <button
              onClick={() => media.toggleMute()}
              title={media.muted ? "Ativar microfone" : "Silenciar microfone"}
              className="rounded-xl px-2 py-2 cursor-pointer transition text-slate-600 hover:bg-slate-200 dark:text-white dark:hover:bg-gray-500"
            >
              {media.micTransmitting ? (
                <Mic className="size-5" />
              ) : (
                <MicOff className="size-5 text-red-600" />
              )}
            </button>
            <AudioQuickSettings kind="mic" />
          </div>
          <div className="flex flex-1 gap-2 items-center mr-2  ">
            <button
              onClick={() => media.toggleDeafen()}
              title={media.deafened ? "Ouvir todos" : "Silenciar todos"}
              className="rounded-xl px-2 py-2 cursor-pointer transition text-slate-600 hover:bg-slate-200 dark:text-white dark:hover:bg-gray-500"
            >
              {media.deafened ? (
                <HeadphoneOff className="size-5 text-red-600" />
              ) : (
                <Headphones className="size-5" />
              )}
            </button>
            <AudioQuickSettings kind="output" />
          </div>
          {media.connected && (
            <button
              onClick={() => media.leaveVoice()}
              className={
                "cursor-pointer rounded-xl px-2 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-white dark:hover:bg-red-700"
              }
            >
              <PhoneOff className="size-5"></PhoneOff>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
