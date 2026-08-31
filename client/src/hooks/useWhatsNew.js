import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { version as APP_VERSION } from "../../package.json";

function storageKey(userId) {
  return `navespeak:whatsNew:${userId}`;
}

function loadState(userId) {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState(userId, state) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Persistência é "nice to have" - se falhar, o modal só deixa de
    // lembrar a escolha entre sessões, não quebra a UI.
  }
}

// Decide quando o WelcomeModal.jsx (notas de versão) deve abrir sozinho -
// chave de storage é POR USUÁRIO (inclui o id), pra não misturar contas no
// mesmo navegador. Duas formas de fechar, com efeito diferente:
//   - fechar sem marcar "não mostrar novamente": dispensa só NESTA sessão
//     (não persiste) - primeiro login de outra sessão volta a mostrar.
//   - fechar com a marcação: persiste lastSeenVersion + dontShowAgain, e só
//     para de valer quando APP_VERSION mudar (nova versão sempre reabre,
//     mesmo tendo marcado antes).
export function useWhatsNew() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);

  useEffect(() => {
    if (!userId || sessionDismissed) return;
    const stored = loadState(userId);
    const alreadyAcknowledged =
      stored?.dontShowAgain && stored?.lastSeenVersion === APP_VERSION;
    if (!alreadyAcknowledged) setOpen(true);
  }, [userId, sessionDismissed]);

  const close = useCallback(
    (dontShowAgain) => {
      setOpen(false);
      if (dontShowAgain) {
        saveState(userId, { lastSeenVersion: APP_VERSION, dontShowAgain: true });
      } else {
        setSessionDismissed(true);
      }
    },
    [userId],
  );

  const openManually = useCallback(() => {
    setSessionDismissed(false);
    setOpen(true);
  }, []);

  return { open, close, openManually, version: APP_VERSION };
}
