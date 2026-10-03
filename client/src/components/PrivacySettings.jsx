import { useEffect, useState } from "react";
import { getProfile, updateProfile } from "../api/profile.js";
import { useToast } from "../context/ToastContext.jsx";
import GhostVoiceToggle from "./GhostVoiceToggle.jsx";
import { Toggle } from "./Toggle.jsx";

// Aba "Privacidade" das preferências. Diferente das outras abas, salva direto
// no servidor ao alternar (não entra no rascunho Cancelar/Salvar do modal):
// é o servidor que aplica a regra ao montar o preview de perfil dos outros.
export default function PrivacySettings() {
  const { showToast } = useToast();
  const [showCommonServers, setShowCommonServers] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProfile()
      .then((data) => {
        if (!cancelled) setShowCommonServers(data.user.showCommonServers !== false);
      })
      .catch((err) => {
        if (!cancelled)
          showToast(err.message || "Não foi possível carregar a privacidade.", {
            type: "error",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  async function handleChange(value) {
    setBusy(true);
    try {
      const data = await updateProfile({ showCommonServers: value });
      setShowCommonServers(data.user.showCommonServers);
    } catch (err) {
      showToast(err.message || "Não foi possível salvar.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
        <Toggle
          checked={Boolean(showCommonServers)}
          disabled={busy || showCommonServers === null}
          label="Mostrar servidores em comum"
          onChange={handleChange}
        />
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Outros usuários veem quantos servidores vocês têm em comum no seu
          perfil. Se desativar, você também deixa de ver essa informação no
          perfil dos outros.
        </p>
      </div>

      <GhostVoiceToggle />
    </div>
  );
}
