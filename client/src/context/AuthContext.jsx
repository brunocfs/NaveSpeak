import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest, setAccessToken } from '../api/http.js';
import { getProfile } from '../api/profile.js';
import TurboWelcomeModal from '../components/TurboWelcomeModal.jsx';
import { connectSocket, disconnectSocket, getSocket } from '../api/socket.js';

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

  // Admin baniu/bloqueou/desconectou esta conta (adminUsers.routes.js) - a
  // sessão já foi revogada no servidor; só descarta a local e guarda o aviso
  // pra tela de login mostrar.
  const [logoutNotice, setLogoutNotice] = useState(null);
  useEffect(() => {
    const socket = getSocket();
    function handleForceLogout({ message }) {
      setLogoutNotice(message);
      setAccessToken(null);
      setUser(null);
    }
    socket.on('account:forceLogout', handleForceLogout);
    return () => socket.off('account:forceLogout', handleForceLogout);
  }, []);

  // Forja liberou TURBO: vira isTurbo na hora (sem reload) e abre o popup.
  // `turboWelcome` = null (fechado) ou { until }.
  const [turboWelcome, setTurboWelcome] = useState(null);
  useEffect(() => {
    const socket = getSocket();
    function handleGranted({ until = null } = {}) {
      setUser((prev) => (prev ? { ...prev, isTurbo: true, turboUntil: until } : prev));
      setTurboWelcome({ until });
    }
    socket.on('account:turboGranted', handleGranted);
    if (import.meta.env.DEV) window.__turboPreview = (until = null) => handleGranted({ until });
    return () => {
      socket.off('account:turboGranted', handleGranted);
      if (import.meta.env.DEV) delete window.__turboPreview;
    };
  }, []);

  // Catálogo TURBO efetivo do usuário (GET /users/me -> turbo). Benefício é
  // por usuário, então os eventos só disparam refetch (não carregam o valor).
  const [turbo, setTurbo] = useState(null);
  const userId = user?.id;
  const refetchTurbo = useCallback(() => {
    getProfile()
      .then((d) => {
        const tb = d.user?.turbo ?? null;
        setTurbo(tb);
        // Mantém o user em dia (badge some na revogação, ganha na concessão)
        // e a preferência de voz fantasma.
        if (tb) {
          setUser((prev) =>
            prev ? { ...prev, isTurbo: tb.active, turboUntil: tb.until, ghostVoice: d.user.ghostVoice, nameStyle: d.user.nameStyle, joinSound: d.user.joinSound ?? null, bannerPath: d.user.bannerPath ?? null, speakingRing: d.user.speakingRing } : prev
          );
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!userId) {
      setTurbo(null);
      return undefined;
    }
    refetchTurbo();
    const socket = getSocket();
    socket.on('turbo:catalogChanged', refetchTurbo);
    socket.on('account:turboGranted', refetchTurbo);
    socket.on('connect', refetchTurbo); // reconexão: eventos perdidos enquanto offline
    return () => {
      socket.off('connect', refetchTurbo);
      socket.off('turbo:catalogChanged', refetchTurbo);
      socket.off('account:turboGranted', refetchTurbo);
    };
  }, [userId, refetchTurbo]);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, updateUser, logoutNotice, turbo, refetchTurbo }),
    [user, loading, login, register, logout, updateUser, logoutNotice, turbo, refetchTurbo]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <TurboWelcomeModal open={!!turboWelcome} until={turboWelcome?.until} onClose={() => setTurboWelcome(null)} />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}

// Benefício efetivo pra este usuário. `locked` = vale só pra TURBO e ele não
// tem (mostrar cadeado + CTA). Enquanto o catálogo não carrega: sem acesso,
// sem cadeado.
export function useBenefit(key) {
  const { turbo } = useAuth();
  const mode = turbo?.catalog?.[key] ?? 'off';
  const has = !!turbo?.benefits?.[key];
  return { has, mode, locked: !has && mode !== 'off' };
}

// Tetos de tela/upload/mensagem/fundos já resolvidos pelo servidor.
export function useTurboLimits() {
  return useAuth().turbo?.limits ?? null;
}
