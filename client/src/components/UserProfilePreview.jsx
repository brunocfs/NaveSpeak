import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { bannerSrc, getUserCard } from "../api/profile.js";
import {
  acceptFriendRequest,
  declineFriendRequest,
  sendFriendRequest,
} from "../api/friends.js";
import { useToast } from "../context/ToastContext.jsx";
import Avatar from "./Avatar.jsx";
import StyledUsername from "./StyledUsername.jsx";
import TurboBadge from "./TurboBadge.jsx";

const POPUP_WIDTH = 320; // w-80

const smallBtn =
  "cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700";
const primarySmallBtn =
  "cursor-pointer rounded-lg bg-purple-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400";
const sectionTitle =
  "mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

// Posição do popup a partir do clique: nunca sai pela direita e, na metade
// de baixo da tela, cresce pra cima (ancorado no bottom) - a altura varia
// conforme cargos/botões, então não dá pra clampar o top com um valor fixo.
export function previewPosFromEvent(e) {
  const x = Math.max(
    8,
    Math.min(e.clientX, window.innerWidth - POPUP_WIDTH - 8),
  );
  return e.clientY > window.innerHeight / 2
    ? { left: x, bottom: Math.max(8, window.innerHeight - e.clientY) }
    : { left: x, top: e.clientY };
}

// Preview de perfil (voice roster e lista de membros). Já cuida do portal e
// de fechar ao clicar fora. `member` (opcional) vem da lista de membros que
// RoomPage já carregou (cargos + data de entrada no servidor atual) - assim
// não precisa de request extra nem de rota nova recebendo serverId.
export default function UserProfilePreview({
  pos,
  onClose,
  isSelf,
  userId,
  username,
  avatarPath,
  member,
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const ref = useRef(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // Cartão do servidor (nome estilizado/TURBO já filtrados lá, amizade,
  // servidores em comum respeitando a privacidade mútua). Até chegar (ou se
  // falhar) mostra só o que veio por props.
  const [card, setCard] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    getUserCard(userId)
      .then((data) => {
        if (!cancelled) setCard(data.user);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    function handlePointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Não manda a mensagem daqui - abre a conversa completa em /rooms (mesmo
  // formato de state que a notificação de DM usa, ver NotificationContext.jsx/
  // RoomsPage.jsx) já com o texto digitado pronto pra enviar (DmPanel.jsx
  // dispara o dm:send assim que a conversa abre).
  function handleSend(e) {
    e.preventDefault();
    const text = message.trim();
    if (!text || !userId) return;
    navigate("/rooms", {
      state: {
        openDmWith: { id: userId, username, avatarPath, pendingMessage: text },
      },
    });
  }

  // Cada ação troca o estado local da amizade só depois do servidor
  // confirmar - a regra (bloqueio, quem pode aceitar etc.) é toda do backend.
  // `action` devolve o novo estado da amizade.
  async function runFriendAction(action, successMsg) {
    setBusy(true);
    try {
      const nextFriendship = await action();
      setCard((prev) => ({ ...prev, friendship: nextFriendship }));
      showToast(successMsg, { type: "success" });
    } catch (err) {
      showToast(err.message || "Não foi possível concluir a ação.", {
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const friendship = card?.friendship;
  const roles = (member?.roles ?? []).filter((r) => !r.isDefault);
  const accountSince = formatDate(card?.createdAt);
  const serverSince = formatDate(member?.joinedAt);

  function renderFriendAction() {
    if (isSelf || !friendship || !card?.tag) return null;
    if (friendship.status === "accepted") {
      return (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          Amigos
        </span>
      );
    }
    if (friendship.status === "pending" && friendship.incoming) {
      return (
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            className={primarySmallBtn}
            onClick={() =>
              runFriendAction(async () => {
                await acceptFriendRequest(friendship.requestId);
                return { status: "accepted" };
              }, "Pedido de amizade aceito.")
            }
          >
            Aceitar pedido
          </button>
          <button
            type="button"
            disabled={busy}
            className={smallBtn}
            onClick={() =>
              runFriendAction(async () => {
                await declineFriendRequest(friendship.requestId);
                return { status: "none" };
              }, "Pedido recusado.")
            }
          >
            Recusar
          </button>
        </div>
      );
    }
    if (friendship.status === "pending") {
      return (
        <button
          type="button"
          disabled={busy}
          className={smallBtn}
          onClick={() =>
            runFriendAction(async () => {
              await declineFriendRequest(friendship.requestId);
              return { status: "none" };
            }, "Solicitação cancelada.")
          }
        >
          Pedido enviado · Cancelar
        </button>
      );
    }
    return (
      <button
        type="button"
        disabled={busy}
        className={primarySmallBtn}
        onClick={() =>
          runFriendAction(async () => {
            const res = await sendFriendRequest(card.tag);
            // Se o alvo já tinha me pedido, o servidor aceita direto.
            if (res?.autoAccepted) return { status: "accepted" };
            return {
              status: "pending",
              requestId: res?.friendship?.id,
              incoming: false,
            };
          }, "Pedido de amizade enviado.")
        }
      >
        Adicionar amigo
      </button>
    );
  }

  return createPortal(
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{ position: "fixed", ...pos }}
      className="z-[9999] w-80 max-w-[calc(100vw-1rem)] rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 dark:bg-[#181a20] dark:ring-slate-800"
    >
      <div className="flex flex-col p-3">
        <div
          className="relative -mx-3 -mt-3 h-25 rounded-t-2xl bg-slate-200 bg-cover bg-center dark:bg-black"
          style={card?.bannerPath ? { backgroundImage: `url(${bannerSrc(card.bannerPath, card.updatedAt)})` } : undefined}
        >
          <Avatar
            avatarPath={avatarPath}
            username={username}
            size="xl"
            className="absolute left-5 top-15 z-10 border"
          />
        </div>

        <div className="flex w-full flex-col gap-3 pt-12">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                <StyledUsername
                  username={username}
                  style={card?.nameStyle}
                  className="truncate"
                />
                {card?.isTurbo && <TurboBadge className="size-4" />}
              </span>
              {card?.tag && (
                <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {card.tag}
                </span>
              )}
            </span>
            {renderFriendAction()}
          </div>

          {(accountSince || serverSince) && (
            <div>
              <p className={sectionTitle}>Membro desde</p>
              <div className="flex flex-col gap-0.5 text-xs text-slate-700 dark:text-slate-300">
                {accountSince && <span>NaveSpeak: {accountSince}</span>}
                {serverSince && <span>Este servidor: {serverSince}</span>}
              </div>
            </div>
          )}

          {roles.length > 0 && (
            <div>
              <p className={sectionTitle}>Cargos</p>
              <ul className="flex flex-wrap gap-1">
                {roles.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: r.color || "#94a3b8" }}
                    />
                    {r.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {typeof card?.commonServers === "number" && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {card.commonServers === 1
                ? "1 servidor em comum"
                : `${card.commonServers} servidores em comum`}
            </p>
          )}

          {!isSelf && (
            <form onSubmit={handleSend}>
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500"
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Manda o papo.. "
                aria-label={`Mensagem para ${username}`}
              />
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
