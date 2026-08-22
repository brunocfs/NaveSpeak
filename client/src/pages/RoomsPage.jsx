import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiRequest } from '../api/http.js';

export default function RoomsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newRoomName, setNewRoomName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadRooms() {
    setLoading(true);
    try {
      const data = await apiRequest('/rooms');
      setRooms(data.rooms);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRooms();
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  async function handleCreateRoom(e) {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest('/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: newRoomName.trim() }),
      });
      setNewRoomName('');
      await loadRooms();
      navigate(`/rooms/${data.room.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinRoom(e) {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest('/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode: inviteCode.trim() }),
      });
      setInviteCode('');
      await loadRooms();
      navigate(`/rooms/${data.room.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rooms-page">
      <header className="rooms-header">
        <h1>NaveSpeak</h1>
        <div>
          <span className="username">{user?.username}</span>
          <button onClick={handleLogout}>Sair</button>
        </div>
      </header>

      <main className="rooms-main">
        <section className="rooms-forms">
          <form onSubmit={handleCreateRoom} className="inline-form">
            <input
              type="text"
              placeholder="Nome da nova sala"
              maxLength={64}
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
            />
            <button type="submit" disabled={busy}>Criar sala</button>
          </form>

          <form onSubmit={handleJoinRoom} className="inline-form">
            <input
              type="text"
              placeholder="Código de convite"
              maxLength={12}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
            <button type="submit" disabled={busy}>Entrar por convite</button>
          </form>
        </section>

        {error && <p className="error-text">{error}</p>}

        <section className="room-list">
          <h2>Suas salas</h2>
          {loading && <p>Carregando...</p>}
          {!loading && rooms.length === 0 && <p className="hint">Você ainda não está em nenhuma sala.</p>}
          <ul>
            {rooms.map((room) => (
              <li key={room.id}>
                <Link to={`/rooms/${room.id}`}>{room.name}</Link>
                <span className="invite-code" title="Código de convite">{room.invite_code}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
