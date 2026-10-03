import { useCallback, useEffect, useRef, useState } from "react";

import {
  Settings,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
  UserRoundPlus,
  Bookmark,
  Volume2,
  ArrowLeft,
  Pencil,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import { markChannelRead } from "../api/messages.js";
import ChatPanel from "../components/ChatPanel.jsx";
import StatusDot, { statusLabel } from "../components/StatusDot.jsx";
import Avatar from "../components/Avatar.jsx";
import VoiceRosterEntry from "../components/VoiceRosterEntry.jsx";
import UserProfilePreview, {
  previewPosFromEvent,
} from "../components/UserProfilePreview.jsx";
import VoiceControlBar from "../components/VoiceControlBar.jsx";
import ServerSettingsModal from "../components/ServerSettingsModal.jsx";
import CreateChannelModal from "../components/CreateChannelModal.jsx";
import ServerUserInvite from "../components/ServerUserInvite.jsx";
import NicknameModal from "../components/NicknameModal.jsx";
import {
  useDisplayName,
  useNicknames,
} from "../context/NicknamesContext.jsx";
import { hasPermission } from "../api/roles.js";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useNotifications } from "../context/NotificationContext.jsx";
import { useAuth, useBenefit } from "../context/AuthContext.jsx";
import { speakingRingColor } from "../utils/turboBenefits.js";
import { usePreferences } from "../context/PreferencesContext.jsx";
import DownloadAppLink from "../components/DownloadAppLink.jsx";
import ScreenSourcePicker from "../components/ScreenSourcePicker.jsx";
import StyledUsername from "../components/StyledUsername.jsx";
import TurboBadge from "../components/TurboBadge.jsx";
import { isElectron, listScreenSources } from "../api/media.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
export default function RoomPage(serverId) {
  const { roomId } = serverId;
  const navigate = useNavigate();
  const { user } = useAuth();
  const ownSpeakingRing = useBenefit("speakingRing").has;
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { setActiveChannel } = useNotifications();
  const {
    theme,
    membersSidebarVisible,
    toggleMembersSidebar,
    getUserVolume,
    setUserVolume,
    isLocallyMuted,
    toggleLocalMute,
    isMediaHidden,
    toggleMediaHidden,
  } = usePreferences();
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  // Preview de perfil aberto a partir da lista de membros: { member, pos }.
  const [memberPreview, setMemberPreview] = useState(null);
  const closeMemberPreview = useCallback(() => setMemberPreview(null), []);
  // Apelidos deste servidor (NicknamesContext) - todo nome exibido aqui
  // passa por displayName(userId, username).
  const { setServerNicknames } = useNicknames();
  const displayName = useDisplayName(roomId);
  // Menu de clique direito da lista de membros ({ target, x, y }) e alvo do
  // NicknameModal ({ userId, username }).
  const [memberMenu, setMemberMenu] = useState(null);
  const [nicknameTarget, setNicknameTarget] = useState(null);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [settings, setSettings] = useState({ memberListMode: "grouped" });
  const [myPermissions, setMyPermissions] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [idServerVoiceActive, setIdServerVoiceActive] = useState(null);
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
  // Lista de servidores do cabeçalho (mesmo estilo/dado de RoomsPage.jsx) -
  // carregada à parte de `room` (que é só o servidor ABERTO agora), pra
  // permitir navegar livremente entre servidores puxando essa faixa.
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [screenPickerSources, setScreenPickerSources] = useState(null);
  // 'share' = começar um compartilhamento novo; 'switch' = trocar a fonte de
  // um já ativo - mesmo modal, ver comentário equivalente em
  // VoiceStatusBar.jsx (a barra global tem a mesma UI de compartilhamento,
  // duplicada de propósito - RoomPage e VoiceStatusBar já divergiam nisso
  // antes desta feature).
  const [screenPickerMode, setScreenPickerMode] = useState("share");
  const [screenPickerError, setScreenPickerError] = useState(null);
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
  const serverMenuRef = useRef(null);
  const scrollRef = useRef(null);
  const [dragOverChannelId, setDragOverChannelId] = useState(null);
  // Celular/tablet (abaixo de `lg`): lista de canais e conteúdo (chat/voz)
  // viram telas separadas, e a lista de membros vira gaveta - estado próprio
  // pra não mexer na preferência membersSidebarVisible do desktop.
  const isMobile = useMediaQuery("(max-width: 1023.98px)");
  const [mobileContentOpen, setMobileContentOpen] = useState(false);
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false);
  const showMembers = isMobile ? mobileMembersOpen : membersSidebarVisible;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("roomSidebarWidth"));
    return saved >= 260 && saved <= 480 ? saved : 260;
  });

  function startSidebarResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    let w = startW;
    const onMove = (ev) => {
      w = Math.min(480, Math.max(260, startW + ev.clientX - startX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("roomSidebarWidth", String(w));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const handleWheel = (e) => {
    const el = scrollRef.current;
    if (!el || e.deltaY === 0) return;

    const isAtStart = el.scrollLeft <= 0;
    const isAtEnd = Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth;

    if ((isAtStart && e.deltaY < 0) || (isAtEnd && e.deltaY > 0)) {
      return;
    }

    e.preventDefault();
    e.preventDefault();
    el.scrollBy({
      left: e.deltaY,
      behavior: "smooth",
    });
  };
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
    setMobileContentOpen(true);
    const previousUnread =
      channels.find((c) => c.id === channelId)?.unreadCount ?? 0;
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
    );
    // Zera o canal e desconta do total do servidor na faixa (rail) - sem
    // isso o badge da faixa só sobe (ver handleChatMessage acima), nunca
    // reflete o que já foi lido.
    if (previousUnread > 0) {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === roomId
            ? {
                ...r,
                unreadCount: Math.max(0, (r.unreadCount ?? 0) - previousUnread),
              }
            : r,
        ),
      );
    }
    markChannelRead(channelId).catch(() => {});
  }

  function openVoiceChannel(channelId) {
    setIdServerVoiceActive(roomId);
    setActiveChannelId(channelId);
    setMobileContentOpen(true);
    if (media.voiceChannelId !== channelId) {
      media.joinVoice(channelId, {
        roomId,
        roomName: room?.name,
        channelName: channels.find((c) => c.id === channelId)?.name,
      });
    }
  }
  async function openSourcePicker(mode) {
    // `screenPickerSources` era setado aqui mas o <ScreenSourcePicker> nunca
    // era renderizado nesta tela (só existia em VoiceStatusBar.jsx) - clicar
    // em "Compartilhar tela" listava as fontes e ficava preso num estado sem
    // UI nenhuma pra mostrar, sem erro nenhum (a promise resolvia normal).
    // Ver <ScreenSourcePicker> montado abaixo.
    //
    // Fora do Electron não existe lista de fontes pra buscar (o seletor de
    // janela é o NATIVO do getDisplayMedia, só aparece ao confirmar) - o
    // picker abre mesmo assim, só pra escolher qualidade (resolução/fps).
    setScreenPickerMode(mode);
    if (!isElectron()) {
      setScreenPickerSources([]);
      return;
    }
    // Abre o modal já (com o foguete de carregando) em vez de esperar a
    // lista - ver `sources === "loading"` em ScreenSourcePicker.jsx. O
    // updater funcional ignora a resposta se o usuário cancelou no meio.
    setScreenPickerSources("loading");
    try {
      const sources = await listScreenSources();
      setScreenPickerSources((cur) => (cur === "loading" ? (sources ?? []) : cur));
    } catch (err) {
      setScreenPickerSources(null);
      // NÃO usa `setError` daqui - esse `error` (acima) troca a tela
      // INTEIRA da sala por uma página de erro (ver `if (error) return`
      // logo abaixo), reservado pra falha de carregar a sala em si. Um
      // estado próprio, só pra não deixar o clique morrer em silêncio de
      // novo como antes.
      //console.error("[screen-share] Falha ao listar fontes de tela:", err);
      setScreenPickerError(
        err.message ?? "Não foi possível listar as telas/janelas disponíveis.",
      );
    }
  }
  function toggleScreenShare() {
    if (media.sharingScreen) {
      media.stopScreenShare();
      return;
    }
    openSourcePicker("share");
  }
  function switchScreenSource() {
    openSourcePicker("switch");
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
    setServerNicknames(roomId, roomData.members);
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
          const previousUnread = initialChannel.unreadCount;
          setRooms((prev) =>
            prev.map((r) =>
              r.id === roomId
                ? {
                    ...r,
                    unreadCount: Math.max(
                      0,
                      (r.unreadCount ?? 0) - previousUnread,
                    ),
                  }
                : r,
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

  // Mesmo servidor já aberto: ?channel=<id> novo (notificação, duplo clique
  // no PiP) não passa pelo efeito acima (só roda quando roomId muda) - troca
  // de canal aqui. Canais ainda não carregados = efeito acima já cuida.
  useEffect(() => {
    const channel = channels.find((c) => c.id === searchParams.get("channel"));
    if (!channel) return;
    if (channel.type === "text") selectTextChannel(channel.id);
    else {
      setActiveChannelId(channel.id);
      setMobileContentOpen(true);
    }
  }, [location.key]);

  // Lista de servidores do cabeçalho (ServerRail inline abaixo) - carregada
  // uma vez, independente de `roomId` (trocar de servidor pela própria
  // faixa não precisa recarregar a lista, só qual item fica marcado ativo).
  useEffect(() => {
    let cancelled = false;
    apiRequest("/rooms")
      .then((data) => {
        if (!cancelled) setRooms(data.rooms ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRoomsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mesmo contador por servidor de RoomsPage.jsx (soma de mensagens novas em
  // qualquer canal de texto) - mantém o badge do cabeçalho em dia mesmo
  // navegando dentro de outro servidor.
  useEffect(() => {
    const socket = getSocket();
    function handleChatMessage(message) {
      if (message.user_id === user?.id) return;
      // Canal já aberto agora mesmo: o ChatPanel marca como lida na hora, não
      // conta pro badge do servidor (mesma exceção do handler de `channels`
      // acima - sem isso o contador da faixa sobe mesmo lendo tudo ao vivo).
      if (message.channel_id === activeChannelId) return;
      setRooms((prev) =>
        prev.map((r) =>
          r.id === message.serverId
            ? { ...r, unreadCount: (r.unreadCount ?? 0) + 1 }
            : r,
        ),
      );
    }
    socket.on("chat:message", handleChatMessage);
    return () => socket.off("chat:message", handleChatMessage);
  }, [user?.id, activeChannelId]);

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

  // Estilo TURBO de um membro mudou (PATCH /users/me, ver users.routes.js) -
  // atualiza a lista na hora; roster e chat leem o estilo daqui.
  useEffect(() => {
    const socket = getSocket();
    function handleNameStyle({ userId, nameStyle }) {
      setMembers((prev) =>
        prev.some((m) => m.id === userId)
          ? prev.map((m) => (m.id === userId ? { ...m, nameStyle } : m))
          : prev,
      );
    }
    socket.on("member:nameStyle", handleNameStyle);
    return () => socket.off("member:nameStyle", handleNameStyle);
  }, []);

  // Reporta o canal de TEXTO ativo pro NotificationContext - é o que decide
  // se uma mensagem nova nesse canal deve virar notificação desktop ou não
  // (conversa já aberta = suprime, se a janela também estiver em foco).
  // Canal de voz não tem chat, então nunca é "ativo" pra esse efeito.
  useEffect(() => {
    setActiveChannel(activeChannel?.type === "text" ? activeChannel.id : null);
    return () => setActiveChannel(null);
  }, [activeChannel, setActiveChannel]);

  // Fecha o dropdown do servidor ao clicar fora dele.
  useEffect(() => {
    if (!serverMenuOpen) return;
    function handleClickOutside(event) {
      if (
        serverMenuRef.current &&
        !serverMenuRef.current.contains(event.target)
      ) {
        setServerMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [serverMenuOpen]);

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
    [
      "MANAGE_SERVER",
      "ADMINISTRATOR",
      "MANAGE_CHANNELS",
      "BAN_MEMBERS",
      "CREATE_INVITE",
    ].some((p) => hasPermission(myPermissions, p));
  // Botão (+) da lista de canais (atalho pra CreateChannelModal) - mesma
  // permissão que a aba "Canais" de ServerSettingsModal exige no servidor
  // (POST /rooms/:roomId/channels -> requirePermission(MANAGE_CHANNELS)).
  const canManageChannels =
    isOwner || hasPermission(myPermissions, "MANAGE_CHANNELS");
  // Regra de permissão do convite: só quem tem CREATE_INVITE (ou é dono) vê
  // a opção "Convidar para o servidor" - o servidor reforça de novo em POST
  // /rooms/:roomId/invite/regenerate (requirePermission(CREATE_INVITE)).
  const canInvite = isOwner || hasPermission(myPermissions, "CREATE_INVITE");

  const voicePerms = {
    canMute: hasPermission(myPermissions, "MUTE_MEMBERS"),
    canDisableMedia: hasPermission(myPermissions, "DISABLE_MEDIA"),
    canDisconnect: hasPermission(myPermissions, "DISCONNECT_MEMBERS"),
    canMove: hasPermission(myPermissions, "MOVE_MEMBERS"),
  };
  // Apelido: o próprio sempre; o de outros só com MANAGE_NICKNAMES (dono/
  // ADMINISTRATOR incluídos via hasPermission). Servidor reforça no PATCH.
  const canManageNicknames = hasPermission(myPermissions, "MANAGE_NICKNAMES");
  const nicknameEditor = (userId, username) =>
    userId === user?.id || canManageNicknames
      ? () => setNicknameTarget({ userId, username })
      : undefined;

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
    <div className="flex w-full h-screen  overflow-y-auto max-lg:overflow-hidden bg-slate-100 text-slate-900 transition-colors dark:bg-[#0f1117] dark:text-slate-100 lg:overflow-hidden">
      {settingsOpen && (
        <ServerSettingsModal
          room={room}
          roles={roles}
          channels={channels}
          members={members}
          settings={settings}
          myPermissions={myPermissions}
          isOwner={isOwner}
          initialTab={settingsInitialTab}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsInitialTab(null);
          }}
          onRefresh={refresh}
        />
      )}
      {inviteOpen && (
        <ServerUserInvite
          room={room}
          onClose={() => setInviteOpen(false)}
          onManageInvites={() => {
            setInviteOpen(false);
            setSettingsInitialTab("invites");
            setSettingsOpen(true);
          }}
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
        style={{ "--sw": `${sidebarWidth}px` }}
        className={`grid  flex-1  ${
          membersSidebarVisible
            ? "lg:grid-cols-[var(--sw)_minmax(0,1fr)_320px]"
            : "lg:grid-cols-[var(--sw)_minmax(0,1fr)]"
        } lg:min-h-0 lg:overflow-hidden`}
      >
        {/* <aside className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"> */}
        <section className="relative lg:flex lg:min-h-0 lg:flex-col max-lg:flex max-lg:min-h-0 max-lg:flex-col">
          <div className="relative flex items-center  max-h-10 bg-white p-4 0 dark:bg-[#0f1117] ">
            <button
              onClick={() => setServerMenuOpen((prev) => !prev)}
              title="Menu do servidor"
              aria-label="Menu do servidor"
              aria-haspopup="menu"
              aria-expanded={serverMenuOpen}
              className="cursor-pointer rounded-xs dark:hover:bg-gray-600/30 p-1 w-full"
            >
              <span className="font-medium">{room.name}</span>
            </button>
            {serverMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full z-20 mt-2 w-100 max-lg:w-72 border overflow-hidden rounded-xl  border-slate-200 bg-white shadow-lg dark:border-gray-700/40 dark:bg-[#181a20]"
              >
                <div className="p-1">
                  {canOpenSettings ? (
                    <button
                      onClick={() => {
                        setServerMenuOpen(false);
                        setSettingsOpen(true);
                      }}
                      role="menuitem"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Settings className="size-4" />
                      Configurações do servidor
                    </button>
                  ) : (
                    <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
                      Nenhuma opção disponível.
                    </p>
                  )}
                  {canInvite && (
                    <button
                      onClick={() => {
                        setServerMenuOpen(false);
                        setInviteOpen(true);
                      }}
                      role="menuitem"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <UserRoundPlus className="size-4" />
                      Convidar para o servidor
                    </button>
                  )}
                  {canManageChannels && (
                    <button
                      onClick={() => {
                        setServerMenuOpen(false);
                        setCreateChannelOpen(true);
                      }}
                      role="menuitem"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Plus className="size-4" />
                      Criar Canal
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setServerMenuOpen(false);
                      //setSettingsOpen(true);
                    }}
                    role="menuitem"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Bookmark className="size-4" />
                    Criar Categoria
                  </button>
                </div>
              </div>
            )}
          </div>
          <aside className="flex min-h-0 flex-1 flex-col  bg-white p-4  dark:bg-[#0f1117] ">
            <div className="flex shrink-0 justify-between  ">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Canais
              </h2>
              {canManageChannels && (
                <button
                  onClick={() => setCreateChannelOpen(true)}
                  title="Criar canal"
                  aria-label="Criar canal"
                  className="cursor-pointer inline-flex h-5 w-5 items-center justify-center rounded-md  border-slate-300  text-slate-700 transition hover:bg-slate-50 dark:border-slate-700  dark:text-slate-200 dark:hover:bg-slate-700"
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
                          <span className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-purple-600 px-1.5 text-[11px] font-semibold text-white dark:bg-purple-500">
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
                    <div
                      key={c.id}
                      onDragOver={(e) => {
                        if (!voicePerms.canMove) return;
                        e.preventDefault();
                        setDragOverChannelId(c.id);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget))
                          setDragOverChannelId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverChannelId(null);
                        let data;
                        try {
                          data = JSON.parse(
                            e.dataTransfer.getData(
                              "application/x-voice-member",
                            ),
                          );
                        } catch {
                          return;
                        }
                        if (!data?.userId || data.fromChannelId === c.id)
                          return;
                        media
                          .moderateMove(data.fromChannelId, data.userId, c.id)
                          .catch(() => {});
                      }}
                      className={`rounded-xl ${
                        dragOverChannelId === c.id
                          ? "bg-purple-500/10 ring-1 ring-purple-500"
                          : ""
                      }`}
                    >
                      <li>
                        <button
                          onClick={() => openVoiceChannel(c.id)}
                          className={`w-full truncate rounded-xl px-3 py-2 mb-2 text-left text-sm font-medium transition ${
                            c.id === activeChannelId
                              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                              : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          }`}
                        >
                          🔊 {c.name}
                        </button>
                      </li>
                      <ul className="flex flex-col gap-2">
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
                          // Ensurdecido não vê o anel de ninguém (nem roxo do
                          // soundboard, ver soundboardSpeakers).
                          const inThisCall =
                            media.voiceChannelId === c.id && !media.deafened;
                          const micStream =
                            !inThisCall
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
                              userId={p.userId}
                              ghost={Boolean(p.ghost)}
                              ringColor={
                                (isSelf ? ownSpeakingRing : p.speakingRing)
                                  ? speakingRingColor(members.find((m) => m.id === p.userId)?.nameStyle ?? p.nameStyle)
                                  : null
                              }
                              isSelf={isSelf}
                              username={p.username}
                              displayName={displayName(p.userId, p.username)}
                              onEditNickname={nicknameEditor(
                                p.userId,
                                p.username,
                              )}
                              discriminator={p.discriminator}
                              avatarPath={p.avatarPath}
                              micStream={micStream}
                              soundboardActive={
                                inThisCall &&
                                media.soundboardSpeakers.has(p.userId)
                              }
                              micMuted={micMuted}
                              deafened={deafened}
                              cameraOn={cameraOn}
                              member={members.find((m) => m.id === p.userId)}
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
                              localControls={
                                isSelf
                                  ? null
                                  : {
                                      locallyMuted: isLocallyMuted(p.userId),
                                      onToggleLocalMute: () =>
                                        toggleLocalMute(p.userId),
                                      cameraHidden: isMediaHidden(
                                        p.userId,
                                        "camera",
                                      ),
                                      onToggleCameraHidden: () =>
                                        toggleMediaHidden(p.userId, "camera"),
                                      screenHidden: isMediaHidden(
                                        p.userId,
                                        "screen",
                                      ),
                                      onToggleScreenHidden: () =>
                                        toggleMediaHidden(p.userId, "screen"),
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
                                      onDragStart: (e) =>
                                        e.dataTransfer.setData(
                                          "application/x-voice-member",
                                          JSON.stringify({
                                            userId: p.userId,
                                            fromChannelId: c.id,
                                          }),
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
          <VoiceControlBar
            toggleScreenShare={toggleScreenShare}
            switchScreenSource={switchScreenSource}
          />
          <div
            onPointerDown={startSidebarResize}
            className="absolute right-0 top-0 z-30 hidden h-full w-1  cursor-col-resize touch-none transition-colors hover:bg-purple-500/60 active:bg-purple-500 lg:block"
          />
        </section>

        <section
          className={`min-w-0  bg-white dark:bg-[#161820] dark:ring-slate-800 lg:flex lg:min-h-0 lg:flex-col ${
            mobileContentOpen
              ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-(--titlebar-h) max-lg:z-40 max-lg:flex max-lg:flex-col"
              : "max-lg:hidden"
          }`}
        >
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
            <div className="flex min-h-0 flex-1 flex-col p-4 max-lg:p-2">
              <div className="mb-2 flex items-center gap-2 lg:hidden">
                <button
                  onClick={() => setMobileContentOpen(false)}
                  title="Voltar para os canais"
                  aria-label="Voltar para os canais"
                  className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <ArrowLeft className="size-5" />
                </button>
                <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {activeChannel.name}
                </h2>
              </div>
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
                        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-400"
                      >
                        Trazer de volta pra esta janela
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => openVoiceChannel(activeChannel.id)}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-purple-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:bg-purple-500 dark:hover:bg-purple-400 dark:focus:ring-purple-400 dark:focus:ring-offset-slate-900"
                >
                  Entrar na voz
                </button>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex justify-between border-b border-slate-200 dark:border-slate-800 items-center pr-3 max-lg:pl-2">
                <div className="flex min-w-0 items-center">
                  <button
                    onClick={() => setMobileContentOpen(false)}
                    title="Voltar para os canais"
                    aria-label="Voltar para os canais"
                    className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <ArrowLeft className="size-5" />
                  </button>
                  <h2 className="truncate  px-4 py-3 max-lg:px-2 text-sm font-semibold uppercase tracking-wide text-slate-500  dark:text-slate-400">
                    {activeChannel.name ? `  ${activeChannel.name}` : ""}
                  </h2>
                </div>
                <button
                  onClick={
                    isMobile
                      ? () => setMobileMembersOpen((v) => !v)
                      : toggleMembersSidebar
                  }
                  title={showMembers ? "Ocultar membros" : "Mostrar membros"}
                  aria-label={
                    showMembers ? "Ocultar membros" : "Mostrar membros"
                  }
                  aria-pressed={showMembers}
                  className="cursor-pointer inline-flex h-8 w-8 p-1.5 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {showMembers ? <PanelRightClose /> : <PanelRightOpen />}
                </button>
              </div>
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

        {showMembers && isMobile && (
          <div
            className="fixed inset-x-0 bottom-0 top-(--titlebar-h) z-50 bg-black/60 lg:hidden"
            onClick={() => setMobileMembersOpen(false)}
          />
        )}
        {showMembers && (
          <aside className="lg:flex lg:min-h-0 lg:flex-col max-lg:fixed max-lg:top-(--titlebar-h) max-lg:bottom-0 max-lg:right-0 max-lg:z-50 max-lg:flex max-lg:w-72 max-lg:max-w-[85vw] max-lg:flex-col">
            <div className="flex min-h-0 flex-1 flex-col  bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-[#0f1117] dark:ring-slate-800">
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
                            const editNickname = nicknameEditor(
                              m.id,
                              m.username,
                            );

                            return (
                              <li
                                key={m.id}
                                onClick={(e) =>
                                  setMemberPreview({
                                    member: m,
                                    pos: previewPosFromEvent(e),
                                  })
                                }
                                onContextMenu={(e) => {
                                  if (!editNickname) return;
                                  e.preventDefault();
                                  setMemberMenu({
                                    onEdit: editNickname,
                                    x: Math.max(
                                      8,
                                      Math.min(
                                        e.clientX,
                                        window.innerWidth - 200 - 8,
                                      ),
                                    ),
                                    y: Math.min(
                                      e.clientY,
                                      window.innerHeight - 48,
                                    ),
                                  });
                                }}
                                className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="relative inline-flex shrink-0">
                                    <Avatar
                                      avatarPath={m.avatarPath}
                                      username={displayName(m.id, m.username)}
                                      size="sm"
                                    />
                                    <StatusDot
                                      status={status}
                                      className="absolute -right-0.5 -bottom-0.5 ring-2 ring-slate-50 dark:ring-slate-800/60"
                                    />
                                  </span>
                                  {/* Cor da role no span externo; estilo TURBO
                                      (se tiver cor própria) sobrescreve no interno. */}
                                  <span
                                    className="truncate text-sm font-medium text-slate-800 dark:text-slate-100"
                                    style={
                                      group.color
                                        ? { color: group.color }
                                        : undefined
                                    }
                                  >
                                    <StyledUsername
                                      username={displayName(m.id, m.username)}
                                      style={m.nameStyle}
                                    />
                                  </span>
                                  {m.isTurbo && <TurboBadge />}
                                </div>

                                {/* <span
                                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                                    isOnline
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                      : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  {statusLabel(status)}
                                </span> */}
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
        {memberMenu && (
          <div
            className="fixed inset-0 z-[9999]"
            onClick={() => setMemberMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMemberMenu(null);
            }}
          >
            <div
              role="menu"
              style={{ position: "fixed", left: memberMenu.x, top: memberMenu.y }}
              className="w-[200px] rounded-lg bg-white p-3 text-sm shadow-sm dark:bg-[#181a20]"
            >
              <button
                role="menuitem"
                className="cursor-pointer flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={memberMenu.onEdit}
              >
                <Pencil className="size-3.5 shrink-0" />
                Alterar apelido
              </button>
            </div>
          </div>
        )}
        {nicknameTarget && (
          <NicknameModal
            roomId={roomId}
            userId={nicknameTarget.userId}
            username={nicknameTarget.username}
            nickname={displayName(nicknameTarget.userId, null)}
            isSelf={nicknameTarget.userId === user?.id}
            onClose={() => setNicknameTarget(null)}
          />
        )}
        {memberPreview && (
          <UserProfilePreview
            pos={memberPreview.pos}
            onClose={closeMemberPreview}
            isSelf={memberPreview.member.id === user?.id}
            userId={memberPreview.member.id}
            username={memberPreview.member.username}
            avatarPath={memberPreview.member.avatarPath}
            member={memberPreview.member}
          />
        )}
      </main>
      {/* A barra "Na voz" (mic/câmera/tela/sair) agora é global - ver
          <VoiceStatusBar /> montada em App.jsx - para continuar visível
          mesmo quando o usuário sai desta tela sem sair da chamada. */}

      {screenPickerSources && (
        <ScreenSourcePicker
          sources={screenPickerSources}
          title={
            screenPickerMode === "switch"
              ? "Trocar para qual fonte?"
              : "Escolha o que compartilhar"
          }
          defaultWithAudio={
            screenPickerMode === "switch" ? media.screenAudioEnabled : false
          }
          onSelect={(sourceId, withAudio, quality) => {
            setScreenPickerSources(null);
            if (screenPickerMode === "switch")
              media.switchScreenSource(sourceId, { withAudio, quality });
            else media.shareScreen(sourceId, { withAudio, quality });
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
