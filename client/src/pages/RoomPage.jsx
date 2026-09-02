import { useEffect, useRef, useState } from "react";
import {
  Settings,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
  Mic,
  MicOff,
  HeadphoneOff,
  Headphones,
  Video,
  VideoOff,
  ScreenShare,
  PhoneOff,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import { markChannelRead } from "../api/messages.js";
import ChatPanel from "../components/ChatPanel.jsx";
import StatusDot, { statusLabel } from "../components/StatusDot.jsx";
import Avatar from "../components/Avatar.jsx";
import VoiceRosterEntry from "../components/VoiceRosterEntry.jsx";
import ServerSettingsModal from "../components/ServerSettingsModal.jsx";
import CreateChannelModal from "../components/CreateChannelModal.jsx";
import { hasPermission } from "../api/roles.js";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useNotifications } from "../context/NotificationContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { usePreferences } from "../context/PreferencesContext.jsx";
import DownloadAppLink from "../components/DownloadAppLink.jsx";
import PreferencesModal from "../components/PreferencesModal.jsx";
import ScreenSourcePicker from "../components/ScreenSourcePicker.jsx";
import ConnectionStatusButton from "../components/ConnectionStatusButton.jsx";
import { isElectron, listScreenSources } from "../api/media.js";
export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const { setActiveChannel } = useNotifications();
  const {
    membersSidebarVisible,
    toggleMembersSidebar,
    getUserVolume,
    setUserVolume,
  } = usePreferences();
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [settings, setSettings] = useState({ memberListMode: "grouped" });
  const [myPermissions, setMyPermissions] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [online, setOnline] = useState([]);
  // Status de presença global por usuário (independente de canal/servidor) -
  // distinto de `online` acima, que é só quem está vendo o canal ativo.
  // Mapa { userId: 'online'|'busy'|'away' } - quem não aparece aqui está
  // offline (ou invisível, que pra quem vê é a mesma coisa).
  const [userStatuses, setUserStatuses] = useState(() => ({}));
  // Roster de voz de TODOS os canais do servidor, por channelId - mantido à
  // parte de `channels` (e não como um campo dentro de cada canal) de
  // propósito: os eventos voice:update do server:join podem chegar antes da
  // resposta REST que popula `channels` (é uma corrida entre socket e HTTP),
  // e um Map indexado por channelId nunca perde esse evento só porque o
  // canal ainda não existe no array no momento em que ele chega.
  const [voiceRosters, setVoiceRosters] = useState({});
  const [error, setError] = useState(null);
  const [screenPickerSources, setScreenPickerSources] = useState(null);
  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;
  const selectedChannel =
    channels.find((c) => c.id === selectedChannelId) ?? null;
  const isVoice = activeChannel?.type === "voice";
  // A conexão de voz é independente do canal visualizado E da tela atual:
  // media vem do MediaSessionProvider (montado em App.jsx, acima das rotas),
  // não de um hook local aqui - assim sair da tela da sala não desconecta a
  // chamada. Ver context/MediaSessionContext.jsx.
  const media = useMediaSession();
  const preferences = usePreferences();
  // Nó onde o VoicePanel (global, montado em App.jsx) deve portar seu
  // conteúdo quando exibido embutido nesta tela - registrado/desregistrado
  // no efeito abaixo. O painel em si (grade de participantes, controles) não
  // é mais renderizado aqui, só este container vazio que serve de alvo do
  // portal.
  const voicePanelAnchorRef = useRef(null);

  // Clicar num canal de voz seleciona ELE e já conecta na chamada - não
  // exige um segundo clique em "Entrar na voz". Só entra de novo se ainda
  // não estiver conectado a esse canal (reclicar o canal já ativo não deve
  // recriar a conexão de mídia). O meta ({roomId, roomName, channelName}) é
  // só para a barra global (VoiceStatusBar) exibir onde é a chamada quando o
  // usuário estiver em outra tela.
  // Clique num canal de TEXTO: seleciona e zera o badge de não lidas dele na
  // hora (mesmo padrão de FriendsPanel.handleSelectFriend), sincronizando o
  // cursor de leitura no servidor em seguida.
  function selectTextChannel(channelId) {
    setActiveChannelId(channelId);
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
    );
    markChannelRead(channelId).catch(() => {});
  }

  function openVoiceChannel(channelId) {
    setActiveChannelId(channelId);
    if (media.voiceChannelId !== channelId) {
      media.joinVoice(channelId, {
        roomId,
        roomName: room?.name,
        channelName: channels.find((c) => c.id === channelId)?.name,
      });
    }
  }
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
  const showingVoicePanel =
    isVoice && media.voiceChannelId === activeChannel?.id && media.connected;

  // Registra o container acima como alvo do portal do VoicePanel enquanto
  // esta tela estiver mostrando o canal de voz ativo. Ao deixar de mostrar
  // (trocar de canal, sair da voz, ou desmontar por navegar pra outra tela)
  // desregistra - mas só se ainda for o dono do anchor atual, pra não apagar
  // o anchor de uma montagem mais nova numa troca rápida de tela.
  //
  // `node` é capturado numa const LOCAL, não lido de voicePanelAnchorRef.current
  // dentro do cleanup: showingVoicePanel virar false (ex.: trocar pra uma
  // chamada privada sem sair da tela) desmonta a <div ref=.../> antes deste
  // cleanup rodar, e o React já zera o ref pra null nesse momento - comparar
  // contra o ref ao vivo então nunca bate (nó antigo !== null) e o
  // panelAnchor velho, um nó DOM já desanexado, nunca era limpo. VoicePanel
  // via ali um alvo "válido" e portava o conteúdo pra dentro dele - que não
  // aparecia em lugar nenhum (era exatamente o bug de "VoicePanel some numa
  // chamada privada"). Guardando `node` antes do dep mudar, a comparação no
  // cleanup segue correta mesmo com o ref já nulo.
  useEffect(() => {
    if (!showingVoicePanel) return undefined;
    const node = voicePanelAnchorRef.current;
    media.setPanelAnchor(node);
    return () => {
      media.setPanelAnchor((current) => (current === node ? null : current));
    };
  }, [showingVoicePanel, media.setPanelAnchor]);

  // Recarrega tudo que GET /rooms/:roomId devolve (room, members, channels,
  // roles, settings, isOwner, myPermissions) - reaproveitado tanto na carga
  // inicial quanto como onRefresh do ServerSettingsModal, pra qualquer
  // mutação lá (criar role, editar canal, etc.) refletir aqui sem duplicar a
  // lógica de fetch.
  async function refresh() {
    const roomData = await apiRequest(`/rooms/${roomId}`);
    setRoom(roomData.room);
    setMembers(roomData.members);
    setChannels(roomData.channels ?? []);
    setRoles(roomData.roles ?? []);
    setSettings(roomData.settings ?? { memberListMode: "grouped" });
    setIsOwner(Boolean(roomData.isOwner));
    setMyPermissions(roomData.myPermissions ?? []);
    return roomData;
  }

  useEffect(() => {
    let cancelled = false;
    // Troca de servidor: descarta o roster de voz do servidor anterior (os
    // channelIds são de outro servidor, não colidem, mas não há por que
    // manter esse estado morto em memória).
    setVoiceRosters({});

    refresh()
      .then((roomData) => {
        if (cancelled) return;
        const chs = roomData.channels ?? [];
        // Clique numa notificação desktop de mensagem chega aqui como
        // /rooms/:roomId?channel=<id> (ver NotificationContext.jsx) - abre
        // direto nesse canal em vez do primeiro canal de texto, se ele
        // existir e pertencer a este servidor.
        const requestedChannelId = searchParams.get("channel");
        const requested = chs.find((c) => c.id === requestedChannelId);
        const firstText = chs.find((c) => c.type === "text");
        const initialChannelId =
          requested?.id ?? firstText?.id ?? chs[0]?.id ?? null;
        setActiveChannelId(initialChannelId);
        // Canal de texto já abre "lido" - zera o badge local (o cursor no
        // servidor é avançado pelo próprio ChatPanel ao montar).
        const initialChannel = chs.find((c) => c.id === initialChannelId);
        if (initialChannel?.type === "text" && initialChannel.unreadCount) {
          setChannels((prev) =>
            prev.map((c) =>
              c.id === initialChannelId ? { ...c, unreadCount: 0 } : c,
            ),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Removido do servidor (expulso ou banido - ver rooms.routes.js) enquanto
  // esta tela está aberta: some daqui direto, sem esperar um refresh manual.
  useEffect(() => {
    const socket = getSocket();
    function handleRemoved(payload) {
      if (payload.roomId !== roomId) return;
      navigate("/rooms", {
        replace: true,
        state: {
          removedNotice:
            payload.reason === "ban"
              ? "Você foi banido deste servidor."
              : "Você foi removido deste servidor.",
        },
      });
    }
    socket.on("server:removed", handleRemoved);
    return () => socket.off("server:removed", handleRemoved);
  }, [roomId, navigate]);

  // Reporta o canal de TEXTO ativo pro NotificationContext - é o que decide
  // se uma mensagem nova nesse canal deve virar notificação desktop ou não
  // (conversa já aberta = suprime, se a janela também estiver em foco).
  // Canal de voz não tem chat, então nunca é "ativo" pra esse efeito.
  useEffect(() => {
    setActiveChannel(activeChannel?.type === "text" ? activeChannel.id : null);
    return () => setActiveChannel(null);
  }, [activeChannel, setActiveChannel]);

  useEffect(() => {
    const socket = getSocket();

    // Entrar no servidor entrega, via voice:update (tratado no efeito
    // abaixo, que já está com listener registrado antes do server:join
    // responder), o roster inicial de cada canal de voz - sem precisar abrir
    // cada um.
    function serverJoin() {
      socket.emit("server:join", roomId, (response) => {
        if (response?.error) setError(response.error);
        else if (response?.statuses) setUserStatuses(response.statuses);
      });
    }
    // Status 'offline' remove a entrada do mapa em vez de gravar a string -
    // é assim que a lista de membros abaixo já trata quem não aparece aqui
    // (userStatuses[m.id] ?? "offline").
    function handleUserStatus({ userId, status }) {
      setUserStatuses((prev) => {
        if (status === "offline") {
          if (!(userId in prev)) return prev;
          const next = { ...prev };
          delete next[userId];
          return next;
        }
        return { ...prev, [userId]: status };
      });
    }
    // Roster de voz de qualquer canal do servidor - chega assim que o
    // usuário entra no servidor (server:join manda o roster de todo canal de
    // voz) e a cada entra/sai de alguém, independente de qual canal está
    // selecionado. Registrado aqui (efeito por servidor, não por canal
    // ativo) para nunca perder um evento por causa de trocar de canal.
    function handleVoice(update) {
      setVoiceRosters((prev) => ({
        ...prev,
        [update.channelId]: update.participants ?? [],
      }));
    }

    if (socket.connected) serverJoin();
    socket.on("connect", serverJoin);
    socket.on("presence:status", handleUserStatus);
    socket.on("voice:update", handleVoice);
    return () => {
      socket.off("connect", serverJoin);
      socket.off("presence:status", handleUserStatus);
      socket.off("voice:update", handleVoice);
    };
  }, [roomId]);

  // Mensagem nova em QUALQUER canal de texto deste servidor (o socket já
  // está na room `channel.server_id` desde a conexão, ver
  // online.handler.js) - incrementa o badge do canal na sidebar, exceto se
  // for a própria mensagem do usuário ou o canal já estiver aberto (aí quem
  // avança o cursor de leitura é o ChatPanel, ao vivo).
  useEffect(() => {
    const socket = getSocket();
    function handleChatMessage(message) {
      if (message.serverId !== roomId) return;
      if (message.user_id === user?.id) return;
      if (message.channel_id === activeChannelId) return;
      setChannels((prev) =>
        prev.map((c) =>
          c.id === message.channel_id
            ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 }
            : c,
        ),
      );
    }
    socket.on("chat:message", handleChatMessage);
    return () => socket.off("chat:message", handleChatMessage);
  }, [roomId, activeChannelId, user?.id]);

  useEffect(() => {
    // Guarda ANTES de registrar qualquer listener - crucial: activeChannelId
    // começa null (canais ainda não carregaram, ver efeito de `refresh()`
    // acima) e este efeito roda uma vez nesse estado a cada
    // montagem/refresh da página. Registrar socket.on("connect", join) já
    // aqui, mesmo sem entrar no `if`, prendia um listener com `join` fechado
    // sobre activeChannelId=null PARA SEMPRE (o `return;` antigo, no meio da
    // função, pulava o `return () => {...}` de limpeza no fim - o efeito
    // nunca desfazia esse registro). Numa reconexão do socket (ex.: F5,
    // trocando o transporte), esse "connect" antigo disparava
    // channel:join(null) - o servidor rejeita (exige UUID), a resposta de
    // erro ("ID de canal inválido.") virava `error` e derrubava a tela
    // inteira. Com o guarda aqui em cima, este efeito simplesmente não
    // registra nada enquanto não há canal ativo de verdade.
    if (!activeChannelId) return;
    const socket = getSocket();
    function handlePresence(update) {
      if (update.channelId === activeChannelId) setOnline(update.members);
    }

    // channel:join vale para qualquer tipo de canal (texto ou voz) - é o que
    // popula a presença "quem está vendo este canal" e, em canais de voz,
    // entrega o roster inicial da chamada.
    function join() {
      socket.emit("channel:join", activeChannelId, (response) => {
        if (response?.error) setError(response.error);
        else if (response?.members) setOnline(response.members);
      });
    }

    socket.on("connect", join);
    socket.on("presence:update", handlePresence);
    if (socket.connected) join();

    return () => {
      socket.emit("channel:leave", activeChannelId);
      socket.off("connect", join);
      socket.off("presence:update", handlePresence);
    };
  }, [activeChannelId]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900/50 dark:bg-slate-900">
          <p className="text-sm font-medium text-red-600 dark:text-red-300">
            {error}
          </p>
          <Link
            to="/rooms"
            className="mt-4 inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Voltar para as salas
          </Link>
        </div>
      </div>
    );
  }

  if (!room || !activeChannel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Carregando...
        </p>
      </div>
    );
  }

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  // Qualquer permissão de admin (ou dono) já libera o botão de engrenagem -
  // cada aba do modal filtra de novo pela permissão específica dela.
  const canOpenSettings =
    isOwner ||
    ["MANAGE_SERVER", "ADMINISTRATOR", "MANAGE_CHANNELS", "BAN_MEMBERS"].some(
      (p) => hasPermission(myPermissions, p),
    );
  // Botão (+) da lista de canais (atalho pra CreateChannelModal) - mesma
  // permissão que a aba "Canais" de ServerSettingsModal exige no servidor
  // (POST /rooms/:roomId/channels -> requirePermission(MANAGE_CHANNELS)).
  const canManageChannels =
    isOwner || hasPermission(myPermissions, "MANAGE_CHANNELS");

  const voicePerms = {
    canMute: hasPermission(myPermissions, "MUTE_MEMBERS"),
    canDisableMedia: hasPermission(myPermissions, "DISABLE_MEDIA"),
    canDisconnect: hasPermission(myPermissions, "DISCONNECT_MEMBERS"),
    canMove: hasPermission(myPermissions, "MOVE_MEMBERS"),
  };
  const anyVoiceModeration =
    voicePerms.canMute ||
    voicePerms.canDisableMedia ||
    voicePerms.canDisconnect ||
    voicePerms.canMove;

  // Agrupamento da lista de membros - configurável em Configurações > Geral
  // (settings.memberListMode). "grouped": uma seção por role (título = nome
  // da role, cor = cor da role), membro com mais de uma role aparece só na
  // de maior `position` (roles já vêm ordenadas position DESC do backend -
  // ver roles.repo.js#listMembersWithRoles); "simple": só Online/Offline.
  // Offline é SEMPRE uma seção à parte, nos dois modos.
  // Recalculado a cada render (não é useMemo/hook de propósito: este trecho
  // já está DEPOIS dos `if (...) return` acima - um hook aqui violaria as
  // Regras dos Hooks, chamado só condicionalmente). Lista de membros é
  // pequena, o custo é desprezível.
  const memberGroups = (() => {
    const withStatus = members.map((m) => ({
      ...m,
      status: userStatuses[m.id] ?? "offline",
    }));
    const online = withStatus.filter((m) => m.status !== "offline");
    const offline = withStatus.filter((m) => m.status === "offline");

    const groups = [];
    if (settings.memberListMode === "simple") {
      groups.push({
        key: "online",
        label: "Online",
        color: null,
        members: online,
      });
    } else {
      const roleGroups = new Map();
      const noRole = [];
      for (const m of online) {
        const top = (m.roles ?? [])[0];
        if (!top) {
          noRole.push(m);
          continue;
        }
        if (!roleGroups.has(top.id))
          roleGroups.set(top.id, { role: top, members: [] });
        roleGroups.get(top.id).members.push(m);
      }
      for (const { role, members: roleMembers } of [
        ...roleGroups.values(),
      ].sort((a, b) => b.role.position - a.role.position)) {
        groups.push({
          key: role.id,
          label: role.name,
          color: role.color,
          members: roleMembers,
        });
      }
      if (noRole.length > 0)
        groups.push({
          key: "__none",
          label: "Membros",
          color: null,
          members: noRole,
        });
    }
    groups.push({
      key: "__offline",
      label: "Offline",
      color: null,
      members: offline,
    });
    return groups.filter((g) => g.members.length > 0);
  })();

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 lg:overflow-hidden">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-8xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/rooms"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              &larr;
            </Link>

            <div className="flex min-w-0 items-center gap-3">
              <Avatar
                avatarPath={room.icon_path}
                username={room.name}
                size="md"
              />
              <div className="min-w-0">
                <h1 className="flex gap-3 truncate text-xl font-bold text-slate-900 dark:text-white">
                  {room.name}
                  {canOpenSettings && (
                    <button
                      onClick={() => setSettingsOpen(true)}
                      title="Configurações do servidor"
                      aria-label="Configurações do servidor"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Settings />
                    </button>
                  )}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeChannel.type === "voice"
                    ? "Canal de voz"
                    : "Canal de texto"}
                  {activeChannel.name ? ` · ${activeChannel.name}` : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <DownloadAppLink />

            <span
              title="Código de convite"
              className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {room.invite_code}
            </span>
            <button
              onClick={toggleMembersSidebar}
              title={
                membersSidebarVisible ? "Ocultar membros" : "Mostrar membros"
              }
              aria-label={
                membersSidebarVisible ? "Ocultar membros" : "Mostrar membros"
              }
              aria-pressed={membersSidebarVisible}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {membersSidebarVisible ? <PanelRightClose /> : <PanelRightOpen />}
            </button>
            {canOpenSettings && (
              <button
                onClick={() => setSettingsOpen(true)}
                title="Configurações do servidor"
                aria-label="Configurações do servidor"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Settings />
              </button>
            )}
          </div>
        </div>
      </header>

      {settingsOpen && (
        <ServerSettingsModal
          room={room}
          roles={roles}
          channels={channels}
          members={members}
          settings={settings}
          myPermissions={myPermissions}
          isOwner={isOwner}
          onClose={() => setSettingsOpen(false)}
          onRefresh={refresh}
        />
      )}
      {createChannelOpen && (
        <CreateChannelModal
          roomId={roomId}
          onClose={() => setCreateChannelOpen(false)}
          onCreated={async (channel) => {
            setCreateChannelOpen(false);
            await refresh();
            if (channel.type === "text") selectTextChannel(channel.id);
            else setActiveChannelId(channel.id);
          }}
        />
      )}
      {/*   <main className="mx-auto grid max-w-8xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:px-8">  */}
      {/* Colunas do grid: sem a barra de membros, a coluna de 320px some e o
          painel do meio (chat/voice, minmax(0,1fr)) toma o espaço todo. */}
      <main
        className={`grid max-w-10xl flex-1 gap-6 px-4 py-6 sm:px-6 ${
          membersSidebarVisible
            ? "lg:grid-cols-[260px_minmax(0,1fr)_320px]"
            : "lg:grid-cols-[260px_minmax(0,1fr)]"
        } lg:px-8 lg:min-h-0 lg:overflow-hidden`}
      >
        {/* <aside className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"> */}
        <section className="lg:flex lg:min-h-0 lg:flex-col">
          <aside className="flex min-h-0 flex-1 flex-col rounded-t-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex shrink-0 justify-between  ">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Canais
              </h2>
              {canManageChannels && (
                <button
                  onClick={() => setCreateChannelOpen(true)}
                  title="Criar canal"
                  aria-label="Criar canal"
                  className="cursor-pointer inline-flex h-5 w-5 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Plus />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 ">
              <div className="mb-4">
                <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Texto
                </p>
                <ul className="space-y-1">
                  {textChannels.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => selectTextChannel(c.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                          c.id === activeChannelId
                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span className="truncate"># {c.name}</span>
                        {c.unreadCount > 0 && (
                          <span className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white dark:bg-blue-500">
                            {c.unreadCount > 99 ? "99+" : c.unreadCount}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                  {textChannels.length === 0 && (
                    <li className="px-1 text-sm text-slate-500 dark:text-slate-400">
                      Nenhum canal de texto.
                    </li>
                  )}
                </ul>
              </div>

              <div>
                <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Voz
                </p>
                <ul className="space-y-1">
                  {voiceChannels.map((c) => (
                    <div>
                      <li key={c.id}>
                        <button
                          onClick={() => openVoiceChannel(c.id)}
                          className={`w-full truncate rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                            c.id === activeChannelId
                              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                              : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          }`}
                        >
                          🔊 {c.name}
                        </button>
                      </li>
                      <ul className="flex flex-col gap-2 ml-2">
                        {(voiceRosters[c.id] ?? []).map((p) => {
                          const isSelf = p.userId === user?.id;

                          // Só há stream de mic pra analisar quando ESTE usuário
                          // está conectado a ESTE canal (remoteStreams só existe
                          // pra chamada ativa, ver MediaSessionContext.jsx) - em
                          // outro canal/sem estar na call, micStream fica null e
                          // o anel simplesmente não acende (nunca falso-positivo).
                          // Pro PRÓPRIO usuário, `remoteStreams` nunca serve (é
                          // só o que os OUTROS mandam, ninguém consome de volta o
                          // próprio producer) - usa `media.localMicStream` (a
                          // stream crua capturada em joinVoice) em vez disso.
                          // `null` enquanto não transmitindo (mutado, travado
                          // por moderador, ou push-to-talk com a tecla solta -
                          // ver media.micTransmitting em MediaSessionContext.jsx):
                          // esses casos só pausam o producer (a track crua local
                          // continua captando áudio), sem isso o anel acenderia
                          // falando com ninguém ouvindo - outro participante
                          // mutado já vem sem áudio no consumer pausado, nunca
                          // precisou desse cuidado extra.
                          const micStream =
                            media.voiceChannelId !== c.id
                              ? null
                              : isSelf
                                ? media.micTransmitting
                                  ? media.localMicStream
                                  : null
                                : (media.remoteStreams.find(
                                    (s) =>
                                      s.userId === p.userId &&
                                      s.appData?.source === "mic",
                                  )?.stream ?? null);

                          // Estado de mic/câmera/tela/ensurdecido é por
                          // participante, não global - antes VoiceRosterEntry
                          // lia direto de useMediaSession() (o estado do
                          // PRÓPRIO usuário logado) e mostrava o mesmo ícone
                          // em toda linha do roster. Pra si mesmo, o estado
                          // local optimista já é a fonte de verdade (atualiza
                          // no clique, sem esperar round-trip). Pros demais,
                          // vem pronto do servidor em
                          // `p.micMuted`/`cameraOn`/`sharingScreen`/`deafened`
                          // (voice:update, ver voicePresence.js) - por isso
                          // aparece pra QUALQUER usuário do servidor, mesmo
                          // sem estar conectado a este canal de voz, e já
                          // chega correto pra quem entra depois de alguém já
                          // mutado (não depende mais de remoteStreams, que só
                          // existe pra quem está na chamada).
                          const micMuted = isSelf
                            ? !media.micTransmitting
                            : Boolean(p.micMuted);
                          const cameraOn = isSelf
                            ? media.cameraOn
                            : Boolean(p.cameraOn);
                          const sharingScreen = isSelf
                            ? media.sharingScreen
                            : Boolean(p.sharingScreen);
                          const deafened = isSelf
                            ? media.deafened
                            : Boolean(p.deafened);

                          return (
                            <VoiceRosterEntry
                              key={p.userId}
                              username={p.username}
                              avatarPath={p.avatarPath}
                              micStream={micStream}
                              micMuted={micMuted}
                              deafened={deafened}
                              cameraOn={cameraOn}
                              sharingScreen={sharingScreen}
                              volumeControl={
                                isSelf
                                  ? null
                                  : {
                                      value: getUserVolume(p.userId),
                                      onChange: (v) =>
                                        setUserVolume(p.userId, v),
                                    }
                              }
                              moderation={
                                anyVoiceModeration
                                  ? {
                                      ...voicePerms,
                                      voiceChannels: voiceChannels.filter(
                                        (vc) => vc.id !== c.id,
                                      ),
                                      onMute: (muted, mode) =>
                                        media.moderateMute(
                                          c.id,
                                          p.userId,
                                          muted,
                                          mode,
                                        ),
                                      onDisableMedia: (disabled, mode) =>
                                        media.moderateMedia(
                                          c.id,
                                          p.userId,
                                          disabled,
                                          mode,
                                        ),
                                      onDisconnect: () =>
                                        media.moderateDisconnect(
                                          c.id,
                                          p.userId,
                                        ),
                                      onMove: (toChannelId) =>
                                        media.moderateMove(
                                          c.id,
                                          p.userId,
                                          toChannelId,
                                        ),
                                    }
                                  : null
                              }
                            />
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  {voiceChannels.length === 0 && (
                    <li className="px-1 text-sm text-slate-500 dark:text-slate-400">
                      Nenhum canal de voz.
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </aside>
          {/* overflow-hidden removido de propósito: essa barra não tem
              cantos arredondados (não precisa clipar nada) e estava
              cortando o popover do ConnectionStatusButton, que abre pra
              CIMA (bottom-full) e precisa extrapolar essa caixa. */}
          {media.connected ? (
            <div className="flex p-2    shadow-sm ring-1  border-slate-700 bg-slate-300 dark:bg-slate-800 dark:ring-slate-800 ">
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
                      <Video className="size-4 text-white" />
                    ) : (
                      <VideoOff className="size-4 text-white" />
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
                </div>
              </div>
            </div>
          ) : (
            ""
          )}
          <div className="flex justify-between p-1 border-t-1 rounded-b-2xl shadow-sm ring-1 border-slate-700 overflow-hidden bg-slate-300 dark:bg-slate-800 dark:ring-slate-800 ">
            <div className="hidden items-center gap-2 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition sm:flex dark:bg-slate-800 dark:text-slate-200 ">
              <span className="relative inline-flex shrink-0">
                <Avatar
                  avatarPath={user?.avatarPath}
                  username={user?.username}
                  size="md"
                />
                <StatusDot
                  status={user?.status ?? "offline"}
                  className="absolute -right-0.5 -bottom-0.5 ring-2 ring-slate-50 dark:ring-slate-800/60"
                />
              </span>
              <PreferencesModal />
            </div>

            <div class="flex flex-1 gap-2 items-center  ">
              <button
                onClick={() => media.toggleMute()}
                title={media.muted ? "Ativar microfone" : "Silenciar microfone"}
                className={`rounded-xl px-2 py-2 cursor-pointer transition ${
                  media.micTransmitting
                    ? "bg-gray-600 hover:bg-gray-500"
                    : "bg-red-600 hover:bg-red-500"
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
                className={`rounded-xl px-2 py-2 cursor-pointer transition ${
                  media.deafened
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-gray-600 hover:bg-gray-500"
                }`}
              >
                {media.deafened ? (
                  <HeadphoneOff className="size-5 text-white" />
                ) : (
                  <Headphones className="size-5 text-white" />
                )}
              </button>
              <button
                onClick={() => media.leaveVoice()}
                className="cursor-pointer rounded-xl bg-red-600 px-3 py-3 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                <PhoneOff></PhoneOff>
              </button>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 lg:flex lg:min-h-0 lg:flex-col">
          {isVoice ? (
            // flex flex-col (sem overflow-y-auto aqui) - o painel de voz
            // precisa de uma ALTURA DE VERDADE pra medir (useElementSize em
            // SimpleVideoGrid/VideoLayoutManager), não só "cresce com o
            // conteúdo": sem isso o grid automático nunca sabe quanto
            // espaço vertical tem de verdade e fica preso no min-h de
            // segurança, em vez de ocupar a tela toda como no popout (lá
            // useWindowPopout já dá height:100% pro body). O scroll, se
            // precisar, é o próprio VoicePanel que cuida (min-h-0 flex-1
            // overflow-auto lá dentro).
            <div className="flex min-h-0 flex-1 flex-col p-4">
              {showingVoicePanel ? (
                <>
                  {/* Container vazio: o conteúdo real (grade de
                      participantes, controles) é o VoicePanel global de
                      App.jsx, portado pra cá via media.setPanelAnchor (ver
                      efeito acima) - ele não é renderizado diretamente aqui
                      de propósito, pra sobreviver à saída desta tela sem se
                      desmontar. min-h-[22rem] é só piso pra telas pequenas
                      onde a section não vira flex-col (breakpoint lg); com
                      lg:flex, flex-1 manda e ocupa tudo.
                      Continua MONTADO mesmo com popout aberto (o `ref`
                      precisa continuar válido pra voltar a ser o alvo do
                      portal se a popout fechar) - só escondido via CSS,
                      nunca desmontado, e sem filhos próprios: VoicePanel é
                      quem decide se porta conteúdo aqui ou na popout, dar
                      filhos JSX próprios a esse nó entraria em conflito com
                      o portal (duas partes da árvore reconciliando o mesmo
                      DOM). O aviso abaixo é um elemento IRMÃO, nunca filho
                      dele. */}
                  <div
                    ref={voicePanelAnchorRef}
                    className={`min-h-[22rem] flex-1 ${media.popout ? "hidden" : ""}`}
                  />
                  {media.popout && (
                    <div className="flex min-h-[22rem] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
                      <PictureInPicture2 className="size-8 text-slate-400 dark:text-slate-500" />
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        A chamada está aberta em uma janela separada.
                      </p>
                      <button
                        onClick={() => media.closePopout()}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
                      >
                        Trazer de volta pra esta janela
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => openVoiceChannel(activeChannel.id)}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
                >
                  Entrar na voz
                </button>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <h2 className="shrink-0 border-b border-slate-200 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {activeChannel.name ? `  ${activeChannel.name}` : ""}
              </h2>
              <div className="min-h-0 flex-1">
                <ChatPanel
                  channelId={activeChannel.id}
                  members={members}
                  channel={activeChannel}
                  room={room}
                  roles={roles}
                />
              </div>
            </div>
          )}
        </section>

        {membersSidebarVisible && (
          <aside className="lg:flex lg:min-h-0 lg:flex-col">
            <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <div className="mb-4 flex shrink-0 items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Membros
                </h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {members.length}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {members.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Nenhum membro encontrado.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {memberGroups.map((group) => (
                      <div key={group.key}>
                        <p className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          {group.color && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: group.color }}
                            />
                          )}
                          {group.label} — {group.members.length}
                        </p>
                        <ul className="space-y-2">
                          {group.members.map((m) => {
                            const status = m.status;
                            const isOnline = status !== "offline";

                            return (
                              <li
                                key={m.id}
                                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/60"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="relative inline-flex shrink-0">
                                    <Avatar
                                      avatarPath={m.avatarPath}
                                      username={m.username}
                                      size="sm"
                                    />
                                    <StatusDot
                                      status={status}
                                      className="absolute -right-0.5 -bottom-0.5 ring-2 ring-slate-50 dark:ring-slate-800/60"
                                    />
                                  </span>
                                  <span
                                    className="truncate text-sm font-medium text-slate-800 dark:text-slate-100"
                                    style={
                                      group.color
                                        ? { color: group.color }
                                        : undefined
                                    }
                                  >
                                    {m.username}
                                  </span>
                                </div>

                                <span
                                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                                    isOnline
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                      : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  {statusLabel(status)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </main>
      {/* A barra "Na voz" (mic/câmera/tela/sair) agora é global - ver
          <VoiceStatusBar /> montada em App.jsx - para continuar visível
          mesmo quando o usuário sai desta tela sem sair da chamada. */}
    </div>
  );
}
