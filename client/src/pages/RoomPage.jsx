import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api/http.js';
import { getSocket } from '../api/socket.js';
import ChatPanel from '../components/ChatPanel.jsx';
import VoicePanel from '../components/VoicePanel.jsx';
import ScreenShareView from '../components/ScreenShareView.jsx';
import { useMediasoup } from '../hooks/useMediasoup.js';

export default function RoomPage() {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [online, setOnline] = useState([]);
  const [error, setError] = useState(null);

  // Uma única instância do hook para a sala, compartilhada entre VoicePanel
  // (voz/câmera) e ScreenShareView (tela) - evita abrir transports mediasoup
  // duplicados para o mesmo usuário na mesma sala.
  const media = useMediasoup(roomId);

  // Detalhes da sala vêm da API HTTP, que já checa membership no servidor -
  // se o usuário não for membro, a resposta é 404 e mostramos o erro abaixo
  // em vez de qualquer dado da sala.
  useEffect(() => {
    let cancelled = false;
    apiRequest(`/rooms/${roomId}`)
      .then((data) => {
        if (!cancelled) {
          setRoom(data.room);
          setMembers(data.members);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    const socket = getSocket();

    function join() {
      socket.emit('room:join', roomId, (response) => {
        if (response?.error) setError(response.error);
        else if (response?.members) setOnline(response.members);
      });
    }

    function handlePresence(update) {
      if (update.roomId === roomId) setOnline(update.members);
    }

    if (socket.connected) join();
    socket.on('connect', join);
    socket.on('presence:update', handlePresence);

    return () => {
      socket.emit('room:leave', roomId);
      socket.off('connect', join);
      socket.off('presence:update', handlePresence);
    };
  }, [roomId]);

  if (error) {
    return (
      <div className="room-page">
        <p className="error-text">{error}</p>
        <Link to="/rooms">Voltar para as salas</Link>
      </div>
    );
  }

  return (
    <div className="room-page">
      <header className="room-header">
        <Link to="/rooms">&larr;</Link>
        <h1>{room?.name ?? 'Carregando...'}</h1>
        <span className="invite-code" title="Código de convite">{room?.invite_code}</span>
      </header>

      <ScreenShareView media={media} />

      <div className="room-body">
        <ChatPanel roomId={roomId} />

        <aside className="room-sidebar">
          <VoicePanel media={media} />
          <h3>Membros ({members.length})</h3>
          <ul>
            {members.map((m) => (
              <li key={m.id} className={online.some((o) => o.userId === m.id) ? 'online' : 'offline'}>
                {m.username}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
