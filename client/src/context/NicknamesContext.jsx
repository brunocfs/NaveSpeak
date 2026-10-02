import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getSocket } from "../api/socket.js";
import { useAuth } from "./AuthContext.jsx";

// Apelidos por servidor: { [serverId]: { [userId]: nickname } }. Global (não
// estado do RoomPage) porque o VoicePanel e as notificações vivem fora da
// página do servidor e continuam ativos navegando pras DMs. RoomPage semeia o
// mapa a cada GET /rooms/:roomId; mudanças chegam ao vivo via
// 'member:nickname', emitido só pra room socket.io do servidor (ver
// rooms.routes.js) - quem não é membro nunca recebe.
const NicknamesContext = createContext(null);

export function NicknamesProvider({ children }) {
  const { user } = useAuth();
  const [byServer, setByServer] = useState({});

  // Troca de conta na mesma janela: não carregar apelidos de servidores da
  // sessão anterior.
  useEffect(() => {
    setByServer({});
  }, [user?.id]);

  useEffect(() => {
    const socket = getSocket();
    function handleNickname({ roomId, userId, nickname }) {
      setByServer((prev) => {
        // Servidor nunca aberto nesta sessão: o GET /rooms/:roomId já vai
        // trazer o valor atual quando abrir.
        if (!prev[roomId]) return prev;
        return { ...prev, [roomId]: { ...prev[roomId], [userId]: nickname } };
      });
    }
    socket.on("member:nickname", handleNickname);
    return () => socket.off("member:nickname", handleNickname);
  }, []);

  const setServerNicknames = useCallback((serverId, members) => {
    setByServer((prev) => ({
      ...prev,
      [serverId]: Object.fromEntries(
        members.filter((m) => m.nickname).map((m) => [m.id, m.nickname]),
      ),
    }));
  }, []);

  const value = useMemo(
    () => ({ byServer, setServerNicknames }),
    [byServer, setServerNicknames],
  );

  return (
    <NicknamesContext.Provider value={value}>
      {children}
    </NicknamesContext.Provider>
  );
}

export function useNicknames() {
  const ctx = useContext(NicknamesContext);
  if (!ctx)
    throw new Error("useNicknames precisa estar dentro de NicknamesProvider");
  return ctx;
}

// Nome exibido de um usuário DENTRO de `serverId`: apelido daquele servidor,
// senão o username. Fora de servidor (DM/chamada privada, serverId nulo)
// sempre o username.
export function useDisplayName(serverId) {
  const map = useNicknames().byServer[serverId];
  return useCallback(
    (userId, username) => map?.[userId] || username,
    [map],
  );
}
