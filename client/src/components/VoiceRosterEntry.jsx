import { useSpeaking } from "../hooks/useSpeaking.js";
import Avatar from "./Avatar.jsx";
import {
  MicOff,
  Pin,
  PinOff,
  HeadphoneOff,
  Camera,
  MonitorUp,
  Volume2,
} from "lucide-react";
// Uma linha da lista de participantes de um canal de voz na sidebar de
// RoomPage.jsx. Extraída num componente à parte porque useSpeaking() é um
// hook - precisa de uma instância de componente por participante, não dá
// pra chamar dentro do .map() do componente pai (violaria as regras dos
// hooks). `micStream` só existe quando ESTE usuário está conectado ao mesmo
// canal (ver RoomPage.jsx) - sem isso não há track de áudio pra analisar, e
// useSpeaking(null) já retorna sempre false (anel fica parado, nunca quebra).
//
// `micMuted`/`deafened`/`cameraOn`/`sharingScreen` vêm já resolvidos por
// RoomPage.jsx PARA ESTE participante específico (self usa o estado local de
// useMediaSession(), os demais derivam de remoteStreams) - antes este
// componente chamava useMediaSession() direto, o que lia sempre o estado do
// usuário LOGADO e mostrava o mesmo ícone (ex.: mutado) em toda linha do
// roster, não só na do usuário que de fato mutou.
//
// `moderation` (opcional) é quem liga as ações de moderação do menu
// (mutar/desligar mídia/desconectar/mover) - RoomPage só passa ele quando o
// usuário logado tem QUALQUER uma das permissões relevantes e este
// participante não é ele mesmo (ver permissionKeysFor/hasPermission).
//
// `volumeControl` (opcional) é o slider de volume INDIVIDUAL - sem permissão
// nenhuma, RoomPage passa pra QUALQUER participante que não seja o próprio
// usuário logado (é só preferência de audição local, não afeta ninguém mais,
// ver RemoteAudioPlayers.jsx/PreferencesContext). Sozinho já é suficiente
// pra abrir o menu ⋮, mesmo sem nenhuma permissão de moderação.
export default function VoiceRosterEntry({
  username,
  avatarPath,
  micStream,
  micMuted,
  deafened,
  cameraOn,
  sharingScreen,
  moderation,
  volumeControl,
}) {
  const speaking = useSpeaking(micStream);
  return (
    <li className="flex items-center gap-1 px-3 py-1 text-sm font-medium text-slate-700 dark:text-slate-200">
      <Avatar
        avatarPath={avatarPath}
        username={username}
        size="xs"
        className={`ring-2 transition ${speaking ? "ring-emerald-500" : "ring-transparent"}`}
      />

      <span className="ml-1 truncate">{username}</span>

      {micMuted ? (
        <MicOff className="size-3.5 shrink-0 text-red-400"></MicOff>
      ) : (
        ""
      )}

      {deafened ? (
        <HeadphoneOff className="size-3.5 shrink-0 text-red-400"></HeadphoneOff>
      ) : (
        ""
      )}

      {cameraOn ? (
        <Camera className="size-3.5 shrink-0 text-green-400"></Camera>
      ) : (
        ""
      )}

      {sharingScreen ? (
        <div className="group relative inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)] backdrop-blur-md transition-all duration-200 ease-out">
          <span className="relative flex size-4 items-center justify-center">
            <span className="absolute size-4 rounded-full bg-emerald-400/20 animate-pulse" />
            <span className="absolute size-4 rounded-full border border-emerald-300/40 animate-ping" />
            <MonitorUp className="relative z-10 size-3 text-emerald-400" />
          </span>
        </div>
      ) : null}

      {(moderation || volumeControl) && (
        <details className="group relative ml-auto shrink-0">
          <summary className="cursor-pointer list-none rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100">
            ⋮
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-56 space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
            {volumeControl && (
              <label className="block px-2 py-1">
                <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                  <Volume2 className="size-3.5 shrink-0" />
                  Volume ({volumeControl.value}%)
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={volumeControl.value}
                  onChange={(e) => volumeControl.onChange(Number(e.target.value))}
                  className="mt-1 w-full accent-emerald-500"
                />
              </label>
            )}
            {moderation?.canMute && (
              <>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onMute(true, "once")}
                >
                  Mutar
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onMute(true, "lock")}
                >
                  Mutar e travar 🔒
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onMute(false, "lock")}
                >
                  Destravar áudio
                </button>
              </>
            )}
            {moderation?.canDisableMedia && (
              <>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onDisableMedia(true, "once")}
                >
                  Desligar mídia
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onDisableMedia(true, "lock")}
                >
                  Desligar mídia e travar 🔒
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onDisableMedia(false, "lock")}
                >
                  Destravar mídia
                </button>
              </>
            )}
            {moderation?.canMove && moderation.voiceChannels?.length > 0 && (
              <label className="block px-2 py-1">
                Mover para...
                <select
                  defaultValue=""
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                  onChange={(e) => {
                    if (e.target.value) moderation.onMove(e.target.value);
                  }}
                >
                  <option value="" disabled>
                    Escolher canal
                  </option>
                  {moderation.voiceChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {moderation?.canDisconnect && (
              <button
                className="block w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                onClick={moderation.onDisconnect}
              >
                Desconectar
              </button>
            )}
          </div>
        </details>
      )}
    </li>
  );
}
