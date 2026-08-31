import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { usePresence } from './PresenceContext.jsx';
import { usePreferences } from './PreferencesContext.jsx';
import { getSocket } from '../api/socket.js';
import { isElectron } from '../api/media.js';
import { avatarSrc } from '../components/Avatar.jsx';

const NotificationContext = createContext(null);

function truncate(text, max = 120) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Notificação desktop de mensagem nova (canal de servidor ou DM), no estilo
// Discord/Teams - "camada" fina em cima da Web Notification API: dentro do
// Electron ela já sai como notificação nativa do Windows/mac/Linux sem
// nenhum código extra do lado nativo (é assim que o Chromium do Electron se
// comporta), só o clique precisando de um empurrão do processo main pra
// desminimizar a janela (ver electron/main.js, "window:focus").
//
// Montado uma única vez em App.jsx, ACIMA de <Routes> (mas dentro do
// Router, usa useNavigate) - mesmo raciocínio de VoiceStatusBar/CallContext:
// mensagem nova pode chegar não importa qual tela está montada.
//
// REGRA DE DISPARO: suprime só quando as DUAS coisas são verdade ao mesmo
// tempo - a janela está em foco E a conversa da mensagem é a que está aberta
// agora (reportado por quem monta essa UI: RoomPage chama setActiveChannel,
// RoomsPage chama setActiveDmPeer). Sem foco (minimizado, outra aba, outro
// app) sempre notifica, mesmo que a conversa "certa" esteja tecnicamente
// aberta - é exatamente o comportamento do Discord/Teams.
export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const { status } = usePresence();
  const { notificationsEnabled } = usePreferences();
  const navigate = useNavigate();
  const socket = getSocket();

  // Ref (não lida direto no closure) porque fireNotification é chamado de
  // dentro do listener de socket registrado uma vez só (mesmo padrão de
  // ownStatusRef/activeChannelRef abaixo) - sem isso, a troca da preferência
  // na tela de Preferências.jsx não seria vista até o listener re-registrar.
  const notificationsEnabledRef = useRef(notificationsEnabled);
  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  const ownUserIdRef = useRef(user?.id);
  useEffect(() => {
    ownUserIdRef.current = user?.id;
  }, [user?.id]);

  // "Ocupado" não recebe notificações (regra pedida do status de presença -
  // ver StatusSelector.jsx). Ref porque só é lido dentro do listener de
  // socket registrado uma vez logo abaixo, mesmo padrão de
  // activeChannelRef/activeDmPeerRef/hasFocusRef.
  const ownStatusRef = useRef(status);
  useEffect(() => {
    ownStatusRef.current = status;
  }, [status]);

  // Refs (não state): só lidos dentro do listener de socket abaixo, que é
  // registrado uma única vez - não há por que causar re-render a cada troca
  // de canal/conversa só para atualizar um valor que ninguém renderiza.
  const activeChannelRef = useRef(null);
  const activeDmPeerRef = useRef(null);
  const hasFocusRef = useRef(typeof document !== 'undefined' ? document.hasFocus() : true);

  useEffect(() => {
    function handleFocus() {
      hasFocusRef.current = true;
    }
    function handleBlur() {
      hasFocusRef.current = false;
    }
    function handleVisibility() {
      hasFocusRef.current = document.hasFocus() && document.visibilityState === 'visible';
    }
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const setActiveChannel = useCallback((channelId) => {
    activeChannelRef.current = channelId ?? null;
  }, []);
  const setActiveDmPeer = useCallback((peerId) => {
    activeDmPeerRef.current = peerId ?? null;
  }, []);

  // IDs de mensagem já notificados nesta sessão - segunda linha de defesa
  // contra notificação duplicada (o dedup "de verdade" é o `tag` da própria
  // Notification API, que substitui em vez de empilhar; isto aqui evita
  // sequer CRIAR uma segunda Notification pro mesmo evento). Podado quando
  // cresce demais para não virar vazamento numa sessão longa.
  const notifiedRef = useRef(new Set());

  // Log de "bloqueado por permissão" só uma vez por sessão - senão cada
  // mensagem que chega sem permissão concedida spammaria o console.
  const warnedNoPermissionRef = useRef(false);

  const fireNotification = useCallback((key, { title, body, icon, tag, onClick }) => {
    if (!notificationsEnabledRef.current) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
      if (!warnedNoPermissionRef.current) {
        warnedNoPermissionRef.current = true;
        console.warn(
          `[notifications] Mensagem chegou mas notificação foi suprimida - permissão está "${Notification.permission}", não "granted".`
        );
      }
      return;
    }
    if (notifiedRef.current.has(key)) return;
    notifiedRef.current.add(key);
    if (notifiedRef.current.size > 500) {
      notifiedRef.current.delete(notifiedRef.current.values().next().value);
    }

    console.log(`[notifications] Disparando: "${title}" - ${body}`);
    const notification = new Notification(title, { body, icon, tag, renotify: true });
    notification.onerror = (err) => console.error('[notifications] Notification.onerror:', err);
    notification.onshow = () => console.log('[notifications] onshow disparado (SO confirmou exibição).');
    notification.onclick = () => {
      window.focus();
      // window.focus() do renderer não desminimiza uma janela nativa do
      // Electron - só o processo main consegue (ver electron/main.js).
      // Fora do Electron, window.naveSpeak simplesmente não existe.
      if (isElectron()) window.naveSpeak.focusWindow?.();
      onClick?.();
      notification.close();
    };
  }, []);

  useEffect(() => {
    function handleChatMessage(message) {
      if (message.user_id === ownUserIdRef.current) return; // nunca notifica a própria mensagem
      if (ownStatusRef.current === 'busy') return; // "Ocupado" não recebe notificações
      const viewingThisChannel = message.channel_id === activeChannelRef.current;
      if (hasFocusRef.current && viewingThisChannel) {
        console.log('[notifications] chat:message suprimido - janela em foco e canal já aberto.');
        return;
      }

      fireNotification(`chat:${message.id}`, {
        title: message.username,
        body: truncate(message.content),
        icon: avatarSrc(message.avatarPath) ?? undefined,
        tag: `chat:${message.channel_id}`,
        onClick: () => navigate(`/rooms/${message.serverId}?channel=${message.channel_id}`),
      });
    }

    function handleDmMessage(message) {
      if (message.sender_id === ownUserIdRef.current) return;
      if (ownStatusRef.current === 'busy') return; // "Ocupado" não recebe notificações
      const viewingThisDm = message.sender_id === activeDmPeerRef.current;
      if (hasFocusRef.current && viewingThisDm) {
        console.log('[notifications] dm:message suprimido - janela em foco e DM já aberta.');
        return;
      }

      fireNotification(`dm:${message.id}`, {
        title: message.sender_username,
        body: truncate(message.content),
        icon: avatarSrc(message.senderAvatarPath) ?? undefined,
        tag: `dm:${message.sender_id}`,
        onClick: () =>
          navigate('/rooms', {
            state: { openDmWith: { id: message.sender_id, username: message.sender_username } },
          }),
      });
    }

    socket.on('chat:message', handleChatMessage);
    socket.on('dm:message', handleDmMessage);
    return () => {
      socket.off('chat:message', handleChatMessage);
      socket.off('dm:message', handleDmMessage);
    };
  }, [socket, navigate, fireNotification]);

  // Pede permissão uma única vez, só quando ainda não foi decidida
  // ('default') - nunca reabre o prompt depois de negado/concedido; o
  // próprio navegador já lembra a decisão entre sessões (Notification.permission
  // persiste sozinho, sem precisar de bookkeeping nosso).
  //
  // Os avisos abaixo são só console.warn (nunca quebram a UI) - sem eles, um
  // bloqueio silencioso (permissão negada, contexto não-seguro) não deixa
  // rastro nenhum e parece "notificação simplesmente não funciona".
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.warn('[notifications] Notification API indisponível neste ambiente.');
      return;
    }
    // Notification (como getUserMedia) exige contexto seguro (https ou
    // localhost) - acesso por IP puro em HTTP (comum numa VPN sem TLS) cai
    // aqui. Fora do Electron não tem como contornar isso pelo app - só
    // servindo via HTTPS ou localhost.
    if (window.isSecureContext === false) {
      console.warn(
        '[notifications] Contexto não-seguro (nem HTTPS nem localhost) - o navegador bloqueia a Notification API aqui.'
      );
      return;
    }
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') {
      console.warn(
        '[notifications] Permissão de notificação já foi negada anteriormente - reative manualmente nas configurações do site/app.'
      );
      return;
    }
    Notification.requestPermission()
      .then((result) => {
        if (result !== 'granted') {
          console.warn(`[notifications] Permissão de notificação: "${result}".`);
        }
      })
      .catch((err) => console.warn('[notifications] Falha ao pedir permissão:', err));
  }, []);

  const value = useMemo(() => ({ setActiveChannel, setActiveDmPeer }), [setActiveChannel, setActiveDmPeer]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications precisa estar dentro de <NotificationProvider>.');
  return ctx;
}
