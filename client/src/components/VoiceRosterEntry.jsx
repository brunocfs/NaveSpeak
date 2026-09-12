import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useSpeaking } from "../hooks/useSpeaking.js";
import UserProfilePreview from "./UserProfilePreview.jsx";
import Avatar from "./Avatar.jsx";
import {
  sendFriendRequest,
  isMyFriend,
  declineFriendRequest,
  removeFriend,
} from "../api/friends.js";
import { useToast } from "../context/ToastContext.jsx";
import {
  MicOff,
  Pin,
  PinOff,
  HeadphoneOff,
  Camera,
  MonitorUp,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
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
// pra habilitar o menu (clique direito), mesmo sem nenhuma permissão de
// moderação.
//
// `localControls` (opcional, mesma régua de volumeControl - sem permissão
// nenhuma, nunca pro próprio usuário) reúne mute-local do mic e ocultar
// webcam/tela - tudo 100% local, nunca chega no servidor nem afeta o que os
// outros participantes veem/ouvem. Mesmas ações que já existem por tile
// dentro da chamada (ParticipantTile.jsx/VoicePanel.jsx), disponíveis aqui
// pra quem prefere a sidebar (ex.: participante sem câmera/tela ligada
// ainda não tem tile de mídia pra clicar).
export default function VoiceRosterEntry({
  userId,
  isSelf,
  username,
  discriminator,
  avatarPath,
  micStream,
  micMuted,
  deafened,
  cameraOn,
  sharingScreen,
  moderation,
  volumeControl,
  localControls,
}) {
  const navigate = useNavigate();
  const speaking = useSpeaking(micStream);
  const hasMenu = Boolean(moderation || volumeControl || localControls);
  const [menuPos, setMenuPos] = useState(null);
  const [profilePreviewPos, setProfilePreviewPos] = useState(null);
  // "none" | "pending" | "accepted" - ver GET /friends/isMyFriend/:tag.
  const [friendship, setFriendship] = useState({ status: "none" });
  const menuRef = useRef(null);
  const profilePreviewRef = useRef(null);
  const { showToast, dismissToast } = useToast();
  // Menu agora abre só com clique direito (botão ⋮ foi removido - ver
  // pedido do usuário). Posição vem do próprio evento de contexto e o menu
  // é renderizado num portal pra `document.body`: assim ele nunca fica
  // cortado pelo `overflow-y-auto`/`overflow-hidden` dos containers da
  // lista (RoomPage.jsx) e sempre fica acima de qualquer card (z-index de
  // portal não compete com o stacking context dos ancestrais).
  function handleContextMenu(e) {
    if (!hasMenu) return;
    e.preventDefault();
    const menuWidth = 224; // w-56
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - 8);
    setMenuPos({ x: Math.max(8, x), y });
  }

  function handleUserProfilePreview(e) {
    e.preventDefault();
    const menuWidth = 224; // w-56
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - 8);
    setProfilePreviewPos({ x: Math.max(8, x), y });
  }

  // Sai da room de voz e abre a conversa em /rooms - mesmo formato de state
  // de openDmWith usado pela notificação de DM (ver NotificationContext.jsx/
  // RoomsPage.jsx). Funciona com qualquer participante do roster, amigo ou
  // não (ver dm.handler.js: DM libera pra quem está no mesmo servidor).
  function handleMessage() {
    setMenuPos(null);
    navigate("/rooms", { state: { openDmWith: { id: userId, username, avatarPath } } });
  }

  async function handleAddFriend(tag) {
    if (!tag) return;
    const loadingToast = showToast("Em busca de um novo amigo... ", {
      type: "loading",
      duration: 5,
    });
    try {
      await sendFriendRequest(tag);
      dismissToast(loadingToast);
      showToast("Feito. Aguardando ansiosamente pelo novo amigo", {
        type: "success",
      });
      setFriendship({ status: "pending" });
    } catch (err) {
      dismissToast(loadingToast);
      showToast(`Oh no! Ficarei sozinho neste planeta?  ${err.message}`, {
        type: "error",
      });
    }
  }

  async function handleCancelRequest(requestId) {
    if (!requestId) return;
    try {
      await declineFriendRequest(requestId);
      setFriendship({ status: "none" });
      showToast("Solicitação cancelada.", { type: "success" });
    } catch (err) {
      showToast(`Não foi possível cancelar. ${err.message}`, {
        type: "error",
      });
    }
  }

  async function handleRemoveFriend(targetUserId) {
    if (!targetUserId) return;
    try {
      await removeFriend(targetUserId);
      setFriendship({ status: "none" });
      showToast("Amizade desfeita.", { type: "success" });
    } catch (err) {
      showToast(`Não foi possível desfazer a amizade. ${err.message}`, {
        type: "error",
      });
    }
  }
  useEffect(() => {
    if (!menuPos) return;
    function handlePointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuPos(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuPos]);

  useEffect(() => {
    if (!profilePreviewPos) return;
    function handlePointerDown(e) {
      if (
        profilePreviewRef.current &&
        !profilePreviewRef.current.contains(e.target)
      ) {
        setProfilePreviewPos(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [profilePreviewPos]);
  useEffect(() => {
    if (!menuPos || isSelf) return;
    let cancelled = false;
    isMyFriend(`${username}#${discriminator}`)
      .then((result) => {
        if (!cancelled) setFriendship(result);
      })
      .catch((e) => {});
    return () => {
      cancelled = true;
    };
  }, [menuPos, username, discriminator, isSelf]);

  return (
    <li
      onContextMenu={handleContextMenu}
      onClick={handleUserProfilePreview}
      className=" cursor-pointer flex rounded-xl items-center gap-1 px-3 py-1 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
    >
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

      {/* Câmera/tela clicáveis quando `localControls` existe: atalho pra
          reativar rápido uma mídia que o próprio usuário ocultou (ver
          onToggleCameraHidden/onToggleScreenHidden) SEM precisar desligar
          "esconder quem está sem câmera/tela" em VoicePanel.jsx só pra achar
          o tile de novo - o indicador já fica bem aqui, na frente do nome,
          então funciona mesmo com o painel de vídeo inteiro escondido/
          minimizado. Cor esmaecida = ligada mas ocultada por você (ainda
          clicável, clique de novo mostra); cor cheia = visível normalmente.
          Sem `localControls` (é você mesmo, ou não há nada pra alternar),
          continua um indicador não-clicável, como sempre foi. */}
      {cameraOn ? (
        localControls ? (
          <button
            type="button"
            onClick={localControls.onToggleCameraHidden}
            title={
              localControls.cameraHidden
                ? "Webcam ocultada por você - clique para mostrar"
                : "Ocultar webcam (só pra você)"
            }
            className={`shrink-0 transition ${
              localControls.cameraHidden
                ? "text-slate-400 hover:text-slate-300"
                : "text-green-400 hover:text-green-300"
            }`}
          >
            <Camera className="size-3.5" />
          </button>
        ) : (
          <Camera className="size-3.5 shrink-0 text-green-400" />
        )
      ) : (
        ""
      )}

      {sharingScreen ? (
        localControls ? (
          <button
            type="button"
            onClick={localControls.onToggleScreenHidden}
            title={
              localControls.screenHidden
                ? "Tela ocultada por você - clique para mostrar"
                : "Ocultar tela compartilhada (só pra você)"
            }
            className={`group relative inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)] backdrop-blur-md transition-all duration-200 ease-out ${
              localControls.screenHidden ? "opacity-50 grayscale" : ""
            }`}
          >
            <span className="relative flex size-4 items-center justify-center">
              <span className="absolute size-4 rounded-full bg-emerald-400/20 animate-pulse" />
              <span className="absolute size-4 rounded-full border border-emerald-300/40 animate-ping" />
              <MonitorUp className="relative z-10 size-3 text-emerald-400" />
            </span>
          </button>
        ) : (
          <div className="group relative inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)] backdrop-blur-md transition-all duration-200 ease-out">
            <span className="relative flex size-4 items-center justify-center">
              <span className="absolute size-4 rounded-full bg-emerald-400/20 animate-pulse" />
              <span className="absolute size-4 rounded-full border border-emerald-300/40 animate-ping" />
              <MonitorUp className="relative z-10 size-3 text-emerald-400" />
            </span>
          </div>
        )
      ) : null}

      {profilePreviewPos &&
        createPortal(
          <div
            ref={profilePreviewRef}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: profilePreviewPos.x,
              top: profilePreviewPos.y,
            }}
          >
            <UserProfilePreview
              isSelf={isSelf}
              userId={userId}
              avatarPath={avatarPath}
              username={username}
              discriminator={discriminator}
            />
          </div>,
          document.body,
        )}

      {hasMenu &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: menuPos.x, top: menuPos.y }}
            className="z-[9999]  space-y-1 rounded-lg border border-slate-200 bg-white p-3  shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <button className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700">
              Perfil
            </button>
            {!isSelf && (
              <button
                className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={handleMessage}
              >
                Mensagem
              </button>
            )}
            {!isSelf && friendship.status === "none" && (
              <button
                className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => handleAddFriend(`${username}#${discriminator}`)}
              >
                Adicionar Amigo
              </button>
            )}
            {!isSelf && friendship.status === "pending" && (
              <button
                className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => handleCancelRequest(friendship.requestId)}
              >
                Cancelar Solicitação de Amizade
              </button>
            )}
            {!isSelf && friendship.status === "accepted" && (
              <button
                className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => handleRemoveFriend(userId)}
              >
                Desfazer Amizade
              </button>
            )}
            {localControls && (
              <>
                <button
                  className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={localControls.onToggleLocalMute}
                >
                  {localControls.locallyMuted ? (
                    <VolumeX className="size-3.5 shrink-0" />
                  ) : (
                    <Volume2 className="size-3.5 shrink-0" />
                  )}
                  {localControls.locallyMuted
                    ? "Reativar áudio (só pra você)"
                    : "Mutar localmente (só pra você)"}
                </button>
                <button
                  className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={localControls.onToggleCameraHidden}
                >
                  {localControls.cameraHidden ? (
                    <EyeOff className="size-3.5 shrink-0" />
                  ) : (
                    <Eye className="size-3.5 shrink-0" />
                  )}
                  {localControls.cameraHidden
                    ? "Mostrar webcam"
                    : "Ocultar webcam (só pra você)"}
                </button>
                <button
                  className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={localControls.onToggleScreenHidden}
                >
                  {localControls.screenHidden ? (
                    <EyeOff className="size-3.5 shrink-0" />
                  ) : (
                    <Eye className="size-3.5 shrink-0" />
                  )}
                  {localControls.screenHidden
                    ? "Mostrar tela compartilhada"
                    : "Ocultar tela compartilhada (só pra você)"}
                </button>
              </>
            )}
            {volumeControl && (
              <label className="block px-2 py-1">
                <span className="flex items-center gap-1.5 text-slate-500 dark:text-white">
                  <Volume2 className="size-3.5 shrink-0" />
                  Volume ({volumeControl.value}%)
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={volumeControl.value}
                  onChange={(e) =>
                    volumeControl.onChange(Number(e.target.value))
                  }
                  className=" cursor-pointer mt-1 w-full accent-green-700 border-0"
                />
              </label>
            )}
            {moderation?.canMute && (
              <>
                <button
                  className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onMute(true, "once")}
                >
                  Silenciar voz no servidor
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onMute(true, "lock")}
                >
                  Desativar voz no servidor
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onMute(false, "lock")}
                >
                  Ativar áudio
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
                  Desativar mídia
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => moderation.onDisableMedia(false, "lock")}
                >
                  Rativar mídia
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
          </div>,
          document.body,
        )}
    </li>
  );
}
