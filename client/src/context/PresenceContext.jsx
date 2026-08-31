import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext.jsx";
import { getSocket } from "../api/socket.js";
import { updateStatus as updateStatusRequest } from "../api/profile.js";
import { isElectron } from "../api/media.js";

const PresenceContext = createContext(null);

// 15min de inatividade -> status "Ausente" automático (regra pedida: só
// afeta quem está com preferência 'online' - ver onlineStore.getOwnStatus
// no servidor, que é a fonte de verdade real).
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];

// Preferência própria de presença (online/busy/away/invisible) + detecção de
// inatividade. Montado ACIMA de <Routes> em App.jsx (mesmo padrão de
// MediaSessionProvider/NotificationProvider) - a detecção de inatividade
// precisa rodar não importa qual tela está aberta, e o status de amigos/
// membros exibido em qualquer tela depende do broadcast que ela dispara.
export function PresenceProvider({ children }) {
  const { user, updateUser } = useAuth();
  const [isIdle, setIsIdle] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const isIdleRef = useRef(false);
  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  // No Electron, usa powerMonitor.getSystemIdleTime() (inatividade REAL do
  // sistema operacional - mouse/teclado em QUALQUER janela, não só a do
  // app - ver electron/main.js). Fora dele (navegador comum), cai pro
  // fallback de escutar atividade dentro da própria página.
  useEffect(() => {
    if (isElectron() && window.naveSpeak?.getSystemIdleTime) {
      const interval = setInterval(async () => {
        try {
          const idleSeconds = await window.naveSpeak.getSystemIdleTime();
          setIsIdle(idleSeconds * 1000 >= IDLE_THRESHOLD_MS);
        } catch {
          // Best-effort - falha no IPC não deve travar nada, só mantém o
          // último valor conhecido.
        }
      }, POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }

    function markActive() {
      lastActivityRef.current = Date.now();
      if (isIdleRef.current) setIsIdle(false);
    }
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, markActive, { passive: true }),
    );
    const interval = setInterval(() => {
      setIsIdle(Date.now() - lastActivityRef.current >= IDLE_THRESHOLD_MS);
    }, POLL_INTERVAL_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
      clearInterval(interval);
    };
  }, []);

  // Reporta a inatividade pro servidor (ver 'presence:idle' em
  // online.handler.js) - ele decide se isso vira 'away' de verdade (só
  // quando a preferência escolhida é 'online') e reemite pra amigos/
  // servidores.
  useEffect(() => {
    if (!user) return;
    getSocket().emit("presence:idle", { idle: isIdle });
  }, [isIdle, user]);

  // Troca manual pelo seletor (StatusSelector.jsx) - persiste no servidor e
  // já atualiza o `user` local (AuthContext) pra UI refletir na hora, sem
  // esperar o próprio broadcast voltar.
  const setStatus = useCallback(
    async (status) => {
      await updateStatusRequest(status);
      updateUser({ status });
    },
    [updateUser],
  );

  const preference = user?.status ?? "online";
  // Mesma regra do servidor (onlineStore.getOwnStatus) espelhada aqui: a
  // preferência escolhida continua sendo o que o SELETOR mostra
  // (StatusSelector.jsx usa `status`), mas o "status de verdade" (ex.: pra
  // um dot ao lado do próprio nome) já reflete o "Ausente" automático sem
  // esperar o round-trip do socket.
  const effectiveStatus = preference === "online" && isIdle ? "away" : preference;

  const value = useMemo(
    () => ({ status: preference, effectiveStatus, isIdle, setStatus }),
    [preference, effectiveStatus, isIdle, setStatus],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence precisa estar dentro de <PresenceProvider>.");
  return ctx;
}
