import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../api/socket.js';
import { useMediaSession } from './MediaSessionContext.jsx';

function emitAsync(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response ?? { error: 'Sem resposta do servidor.' }));
  });
}

const CallContext = createContext(null);

// Camada de CONVITE de chamada privada, em cima do MESMO pipeline de voz das
// salas (useMediaSession/MediaSessionContext.jsx) - "entrar de fato" na
// chamada é sempre media.joinVoice(callId, meta), o idêntico método que
// RoomPage usa para um canal de voz de servidor; aqui só orquestramos o
// convite/aceite/recusa que antecede isso. Montado uma única vez em App.jsx,
// DENTRO de MediaSessionProvider e ACIMA de <Routes> - uma chamada recebida
// precisa aparecer (CallInviteBanner) não importa qual tela está montada,
// mesmo motivo que já levou VoiceStatusBar/VoicePanel a serem globais.
export function CallProvider({ children }) {
  const media = useMediaSession();
  const socket = getSocket();

  // [{ callId, from: { id, username } }] - convites recebidos, ainda sem
  // resposta.
  const [incomingCalls, setIncomingCalls] = useState([]);
  // Roster de CONVITE (status invited/accepted/declined/left) da chamada
  // ATIVA - diferente de media.voiceRoster, que é só quem já está de fato
  // conectado ao mediasoup; este também mostra quem ainda está tocando.
  const [activeRoster, setActiveRoster] = useState([]);

  // Lido dentro dos listeners de socket (registrados uma vez) sem precisar
  // recriar a subscrição a cada troca de chamada ativa.
  const voiceChannelIdRef = useRef(media.voiceChannelId);
  useEffect(() => {
    voiceChannelIdRef.current = media.voiceChannelId;
    if (!media.voiceChannelId) setActiveRoster([]);
  }, [media.voiceChannelId]);

  useEffect(() => {
    function handleInvite(payload) {
      setIncomingCalls((prev) => (prev.some((c) => c.callId === payload.callId) ? prev : [...prev, payload]));
    }
    function handleParticipantUpdate({ callId, participants }) {
      if (callId === voiceChannelIdRef.current) setActiveRoster(participants);
    }
    // Emitido quando ninguém mais está de fato na chamada (ver
    // handleCallLeave no servidor) - encerra o convite de quem ainda estava
    // só tocando, e limpa o roster se por acaso ainda era a chamada ativa
    // localmente (ex.: outra aba do mesmo usuário já tinha saído).
    function handleEnded({ callId }) {
      setIncomingCalls((prev) => prev.filter((c) => c.callId !== callId));
      if (callId === voiceChannelIdRef.current) setActiveRoster([]);
    }

    socket.on('call:invite', handleInvite);
    socket.on('call:participantUpdate', handleParticipantUpdate);
    socket.on('call:ended', handleEnded);
    return () => {
      socket.off('call:invite', handleInvite);
      socket.off('call:participantUpdate', handleParticipantUpdate);
      socket.off('call:ended', handleEnded);
    };
  }, [socket]);

  // Cria a chamada, convida `peer` e já entra na voz (auto-atendimento de
  // quem liga, como uma ligação de telefone) - dois passos no servidor
  // (call:create + media:join), uma única chamada aqui.
  const startCall = useCallback(
    async (peer) => {
      const res = await emitAsync(socket, 'call:create', { peerId: peer.id });
      if (res.error) return res;
      await media.joinVoice(res.callId, { channelName: `Chamada com ${peer.username}` });
      return { ok: true, callId: res.callId };
    },
    [socket, media]
  );

  // Adiciona mais alguém à chamada ATIVA (grupo) - não mexe em nenhum
  // producer/transport dos participantes já conectados.
  const inviteToCall = useCallback(
    (peer) => {
      const callId = voiceChannelIdRef.current;
      if (!callId) return Promise.resolve({ error: 'Nenhuma chamada ativa.' });
      return emitAsync(socket, 'call:invite', { callId, peerId: peer.id });
    },
    [socket]
  );

  const acceptCall = useCallback(
    async (invite) => {
      const res = await emitAsync(socket, 'call:accept', { callId: invite.callId });
      if (res.error) return res;
      setIncomingCalls((prev) => prev.filter((c) => c.callId !== invite.callId));
      await media.joinVoice(invite.callId, { channelName: `Chamada com ${invite.from.username}` });
      return { ok: true };
    },
    [socket, media]
  );

  const declineCall = useCallback(
    (invite) => {
      setIncomingCalls((prev) => prev.filter((c) => c.callId !== invite.callId));
      return emitAsync(socket, 'call:decline', { callId: invite.callId });
    },
    [socket]
  );

  const isCall = Boolean(media.voiceChannelId?.startsWith('call:'));

  const value = useMemo(
    () => ({
      incomingCalls,
      activeRoster,
      isCall,
      startCall,
      inviteToCall,
      acceptCall,
      declineCall,
      leaveCall: media.leaveVoice,
    }),
    [incomingCalls, activeRoster, isCall, startCall, inviteToCall, acceptCall, declineCall, media.leaveVoice]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall precisa estar dentro de <CallProvider>.');
  return ctx;
}
