import { useState } from "react";
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
} from "lucide-react";
import Avatar from "./Avatar.jsx";
import StatusDot from "./StatusDot.jsx";
import ConnectionStatusButton from "./ConnectionStatusButton.jsx";
import StatusSelector from "./StatusSelector.jsx";
import PreferencesModal from "./PreferencesModal.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";

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
export default function VoiceControlBar({
  toggleScreenShare,
  switchScreenSource,
}) {
  const media = useMediaSession();
  const { user } = useAuth();
  const [openUserStatus, setOpenUserStatus] = useState(false);

  return (
    <>
      {/* overflow-hidden removido de propósito: essa barra não tem cantos
          arredondados (não precisa clipar nada) e estava cortando o popover
          do ConnectionStatusButton, que abre pra CIMA (bottom-full) e
          precisa extrapolar essa caixa. */}
      {media.connected && (
        <div className="flex p-2   ring-slate-200 shadow-sm ring-1  border-slate-700  dark:bg-slate-800 dark:ring-slate-800 ">
          <div className="flex flex-1 gap-2 justify-between items-center">
            {/* Estatísticas de conexão (ping/perda de pacote) - ver
              ConnectionStatusButton.jsx, dados vêm de
              media.networkStats (MediaSessionContext). */}
            <ConnectionStatusButton />
            <div className="flex gap-2  items-center">
              <button
                onClick={() =>
                  media.cameraOn ? media.stopCamera() : media.shareCamera()
                }
                title={media.cameraOn ? "Desligar câmera" : "Ligar câmera"}
                className={`rounded-xl px-2 py-2 cursor-pointer transition ${
                  media.cameraOn
                    ? "bg-blue-600 hover:bg-blue-500"
                    : "bg-gray-600 hover:bg-gray-500"
                }`}
              >
                {media.cameraOn ? (
                  <Camera className="size-4 text-white" />
                ) : (
                  <CameraOff className="size-4 text-white" />
                )}
              </button>
              <button
                onClick={toggleScreenShare}
                title={
                  media.sharingScreen
                    ? "Parar compartilhamento"
                    : "Compartilhar tela"
                }
                className={`rounded-xl px-2 py-2 cursor-pointer transition ${
                  media.sharingScreen
                    ? "bg-green-600 hover:bg-green-500"
                    : "bg-gray-600 hover:bg-gray-500"
                }`}
              >
                <ScreenShare className="size-4 text-white" />
              </button>
              {media.sharingScreen && (
                <button
                  onClick={switchScreenSource}
                  title="Trocar a tela/janela compartilhada (sem parar o compartilhamento)"
                  className="rounded-xl px-2 py-2 cursor-pointer bg-gray-600 transition hover:bg-gray-500"
                >
                  <RefreshCw className="size-4 text-white" />
                </button>
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
      <div className="flex justify-between p-1 border-t-1 rounded-b-2xl shadow-sm ring-1  overflow-hidden border-slate-100 dark:border-slate-600 ring-slate-200 dark:bg-slate-800 dark:ring-slate-800 ">
        <div className="hidden items-center gap-2 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition sm:flex dark:bg-slate-800 dark:text-slate-200 ">
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

        <div className="flex flex-1 gap-2 items-center  ">
          <button
            onClick={() => media.toggleMute()}
            title={media.muted ? "Ativar microfone" : "Silenciar microfone"}
            className={`rounded-xl px-2 py-2 cursor-pointer transition ${
              media.micTransmitting
                ? " hover:bg-gray-500"
                : "dark:bg-slate-900 hover:bg-gray-500 "
            }`}
          >
            {media.micTransmitting ? (
              <Mic className="size-5 text-white" />
            ) : (
              <MicOff className="size-5 text-red-600" />
            )}
          </button>
          <button
            onClick={() => media.toggleDeafen()}
            title={media.deafened ? "Ouvir todos" : "Silenciar todos"}
            className={`rounded-xl px-2 py-2 cursor-pointer transition ${
              media.deafened
                ? "dark:bg-slate-900 hover:bg-gray-500"
                : " hover:bg-gray-500"
            }`}
          >
            {media.deafened ? (
              <HeadphoneOff className="size-5 text-red-600" />
            ) : (
              <Headphones className="size-5 text-white" />
            )}
          </button>
          {media.connected && (
            <button
              onClick={() => media.leaveVoice()}
              className={
                "cursor-pointer rounded-xl  px-2 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
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
