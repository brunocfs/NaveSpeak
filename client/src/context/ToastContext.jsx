import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, Loader2, TriangleAlert, Info, X } from "lucide-react";

const ToastContext = createContext(null);

// Popup de status genérico (loading/confirmação/erro) pra qualquer tela do
// app avisar "aguarde o servidor" sem cada tela reinventar seu próprio
// spinner - ver useToast() no fim do arquivo pra API de uso. Fica ACIMA de
// <Routes> em App.jsx (mesmo raciocínio de VoicePanel/NotificationProvider):
// uma ação (ex: entrar numa call, enviar convite) pode disparar um toast não
// importa qual tela está montada.
const ICONS = {
  loading: Loader2,
  success: CheckCircle2,
  error: TriangleAlert,
  info: Info,
};

const ICON_CLASSES = {
  loading: "animate-spin text-blue-500",
  success: "text-green-500",
  error: "text-red-500",
  info: "text-blue-500",
};

let nextToastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, closing: true } : t)),
    );
    // Espera a transição de saída (ver duration-200 no <Toast>) antes de
    // tirar do array - removendo na hora, o CSS não tem tempo de animar.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  // duration=0 desativa o timeout automático (só pra loading que precisa
  // ficar até alguém chamar dismissToast manualmente) - todo resto (info/
  // success/error) fecha sozinho em 5s por padrão, como pedido.
  const showToast = useCallback(
    (message, { type = "info", duration = 5000 } = {}) => {
      const id = ++nextToastId;
      setToasts((prev) => [...prev, { id, message, type, closing: false }]);
      if (duration > 0) {
        timersRef.current.set(
          id,
          setTimeout(() => dismissToast(id), duration),
        );
      }
      return id;
    },
    [dismissToast],
  );

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const value = useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            toast={toast}
            onDismiss={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }) {
  // Monta invisível/deslocado e sobe pra opacity-100/translate-x-0 um frame
  // depois - é isso que faz o transition-all abaixo animar a ENTRADA (sem
  // esse truque, o elemento já nasceria no estado final e não haveria nada
  // pra transicionar). A saída usa o mesmo par de classes, só que disparada
  // por toast.closing (setado em dismissToast).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const Icon = ICONS[toast.type] ?? Info;
  const visible = mounted && !toast.closing;

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg transition-all duration-200 ease-out dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${
        visible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      }`}
    >
      <Icon
        className={`size-4 shrink-0 ${ICON_CLASSES[toast.type] ?? ICON_CLASSES.info}`}
      />
      <span className="flex-1">{toast.message}</span>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fechar"
        className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx)
    throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  return ctx;
}
