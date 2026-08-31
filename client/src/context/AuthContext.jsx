import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest, setAccessToken } from '../api/http.js';
import { connectSocket, disconnectSocket } from '../api/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Ao carregar o app, tenta renovar a sessão via cookie httpOnly (sem exigir
  // login de novo se o usuário já tinha uma sessão válida).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest('/auth/refresh', { method: 'POST' });
        if (!cancelled) {
          setAccessToken(data.accessToken);
          setUser(data.user);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (identifier, password) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const register = useCallback(async (username, email, password, inviteCode) => {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      // inviteCode fica de fora do corpo quando vazio (undefined não vira
      // chave no JSON) - o servidor só exige o campo se INVITE_ONLY=true
      // (ver registerSchema em auth.routes.js).
      body: JSON.stringify({ username, email, password, inviteCode: inviteCode || undefined }),
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  // Mescla campos no `user` em memória sem bater no backend - usado depois
  // de um PATCH bem-sucedido em /api/users/me (ProfilePage.jsx) para o
  // username exibido no resto do app (ex.: cabeçalho de RoomsPage.jsx)
  // acompanhar a mudança sem precisar de F5 nem de um novo /auth/refresh.
  const updateUser = useCallback((patch) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  // Conecta o socket (chat/presença) só depois de termos um usuário
  // autenticado, e derruba a conexão ao deslogar.
  useEffect(() => {
    if (user) {
      connectSocket();
    } else {
      disconnectSocket();
    }
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, updateUser }),
    [user, loading, login, register, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
