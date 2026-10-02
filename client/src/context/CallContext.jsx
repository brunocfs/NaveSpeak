import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../api/socket.js';
import { useMediaSession } from './MediaSessionContext.jsx';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { playSound, stopSound } from '../utils/sounds.js';

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
  const { user } = useAuth();
  const { showToast } = useToast();
  const socket = getSocket();

  // Com quem é a chamada ativa ({ id, username, avatarPath? }) - quem ligou
  // (startCall) ou quem convidou (acceptCall). É a DM desse amigo que embute
  // o painel da chamada (DmPanel.jsx); num grupo continua sendo a mesma DM.
  const [callPeer, setCallPeer] = useState(null);
  // callId que ESTE usuário criou - só quem liga ouve o "chamando" (ringback).
  const [outgoingCallId, setOutgoingCallId] = useState(null);
  // Painel da chamada ocupando a conversa inteira (chat escondido) - ver
  // DmPanel.jsx/PrivateCallPanel.jsx.
  const [callExpanded, setCallExpanded] = useState(false);

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
    if (!media.voiceChannelId?.startsWith('call:')) {
      setCallPeer(null);
      setOutgoingCallId(null);
      setCallExpanded(false);
    }
  }, [media.voiceChannelId]);

  // Lidos dentro do listener de call:ended (registrado uma vez).
  const leaveVoiceRef = useRef(media.leaveVoice);
  const callPeerRef = useRef(callPeer);
  useEffect(() => {
    leaveVoiceRef.current = media.leaveVoice;
    callPeerRef.current = callPeer;
  });

  // "Chamando..." de quem ligou: toca enquanto ninguém além de si mesmo
  // respondeu (aceitou, recusou, expirou ou saiu). Roster vazio conta como
  // tocando - o servidor só manda o primeiro call:participantUpdate quando
  // alguém responde.
  const ringing =
    Boolean(outgoingCallId) &&
    media.voiceChannelId === outgoingCallId &&
    !activeRoster.some((p) => p.userId !== user?.id && p.status !== 'invited');
  useEffect(() => {
    if (!ringing) return;
    playSound('ringback', { loop: true });
    return () => stopSound('ringback');
  }, [ringing]);

  // Toca "calling" em loop enquanto há pelo menos um convite tocando (ver
  // CallInviteBanner.jsx) e para sozinho assim que a lista esvazia -
  // aceito (acceptCall), recusado (declineCall) ou encerrado pelo outro lado
  // (handleEnded abaixo) removem da lista, e o efeito reage a isso sozinho.
  useEffect(() => {
    if (incomingCalls.length === 0) {
      stopSound('calling');
      return;
    }
    playSound('calling', { loop: true });
    return () => stopSound('calling');
  }, [incomingCalls.length]);

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
    //
    // `reason` ('declined' | 'missed') = o servidor encerrou uma 1:1 porque
    // ninguém atendeu (ver endIfAlone em calls.handler.js) - quem ligou sai
    // da voz sozinho e vê o motivo.
    function handleEnded({ callId, reason }) {
      setIncomingCalls((prev) => prev.filter((c) => c.callId !== callId));
      if (callId !== voiceChannelIdRef.current) return;
      setActiveRoster([]);
      if (!reason) return;
      leaveVoiceRef.current();
      const name = callPeerRef.current?.username ?? 'O usuário';
      showToast(reason === 'declined' ? `${name} recusou a chamada.` : `${name} não atendeu.`, { type: 'info' });
    }

    socket.on('call:invite', handleInvite);
    socket.on('call:participantUpdate', handleParticipantUpdate);
    socket.on('call:ended', handleEnded);
    return () => {
      socket.off('call:invite', handleInvite);
      socket.off('call:participantUpdate', handleParticipantUpdate);
      socket.off('call:ended', handleEnded);
    };
  }, [socket, showToast]);

  // Cria a chamada, convida `peer` e já entra na voz (auto-atendimento de
  // quem liga, como uma ligação de telefone) - dois passos no servidor
  // (call:create + media:join), uma única chamada aqui.
  const startCall = useCallback(
    async (peer) => {
      const res = await emitAsync(socket, 'call:create', { peerId: peer.id });
      if (res.error) return res;
      await media.joinVoice(res.callId, { channelName: `Chamada com ${peer.username}` });
      setCallPeer({ id: peer.id, username: peer.username, avatarPath: peer.avatarPath });
      setOutgoingCallId(res.callId);
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
      // Aceito ou recusado pelo servidor (ex.: convite já expirou), o convite
      // sai da lista - senão ficaria tocando pra sempre.
      setIncomingCalls((prev) => prev.filter((c) => c.callId !== invite.callId));
      if (res.error) return res;
      await media.joinVoice(invite.callId, { channelName: `Chamada com ${invite.from.username}` });
      setCallPeer({ id: invite.from.id, username: invite.from.username });
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
      callPeer,
      ringing,
      callExpanded,
      setCallExpanded,
    }),
    [
      incomingCalls,
      activeRoster,
      isCall,
      startCall,
      inviteToCall,
      acceptCall,
      declineCall,
      media.leaveVoice,
      callPeer,
      ringing,
      callExpanded,
    ]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall precisa estar dentro de <CallProvider>.');
  return ctx;
}
