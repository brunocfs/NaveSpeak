import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES, usePreferences } from "../context/PreferencesContext.jsx";
import { listMediaDevices, unlockDeviceLabels } from "../api/media.js";

// Sentinela usado no <select> para "padrão do sistema" - o valor salvo de
// verdade é `null` (ver PreferencesContext DEFAULT_PREFERENCES), mas <select>
// não aceita null/undefined como value de <option> de forma confiável.
const SYSTEM_DEFAULT = "";

// Botão de engrenagem + modal de preferências, no cabeçalho de RoomsPage.jsx
// ao lado do "Sair" (pedido do escopo). Modal usa o mesmo padrão visual
// (overlay + card) do ScreenSourcePicker.jsx, só que em Tailwind, já que o
// resto do app migrou pra lá.
//
// O overlay (fixed inset-0) é renderizado via portal em document.body, e
// não como filho normal aqui - o <header> de RoomsPage.jsx usa
// `backdrop-blur`, e `backdrop-filter`/`filter`/`transform` no ancestral
// criam um "containing block" novo pra `position: fixed`, prendendo o
// modal dentro dos limites do header em vez de cobrir a tela toda (era o
// bug relatado). O portal escapa desse ancestral.
//
// Alterações ficam num rascunho local (`draft`) e só viram preferência de
// verdade (PreferencesContext, aplicada + persistida) ao clicar "Salvar" -
// "Cancelar"/fechar/Esc descarta o rascunho sem tocar no que já estava
// salvo.
export default function PreferencesModal() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const preferences = usePreferences();
  const {
    theme,
    language,
    notificationsEnabled,
    micDeviceId,
    cameraDeviceId,
    noiseSuppressionMode,
    noiseSuppressionLevel,
  } = preferences;

  // Dispositivos de mídia (aba "Dispositivos") - lista separada do `draft`
  // porque não é uma preferência em si, só o catálogo pra popular os
  // <select> de microfone/webcam. `labelsUnlocked` reflete se o navegador já
  // liberou os `label` reais (getUserMedia concedido em algum momento) -
  // sem isso enumerateDevices devolve os deviceId mas com nome vazio.
  const [devices, setDevices] = useState({ mics: [], cameras: [] });
  const [labelsUnlocked, setLabelsUnlocked] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [devicesError, setDevicesError] = useState(null);

  async function refreshDevices() {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const list = await listMediaDevices();
      setDevices(list);
      setLabelsUnlocked(list.mics.some((d) => d.label) || list.cameras.some((d) => d.label));
    } catch (err) {
      setDevicesError(err.message ?? "Não foi possível listar os dispositivos.");
    } finally {
      setDevicesLoading(false);
    }
  }

  async function handleUnlockLabels() {
    setUnlocking(true);
    try {
      await unlockDeviceLabels();
    } finally {
      setUnlocking(false);
      await refreshDevices();
    }
  }

  // Enquanto o modal está aberto, refaz a lista se um dispositivo for
  // plugado/removido (headset USB, webcam externa etc.) - sem isso o
  // usuário teria que fechar e reabrir o modal pra ver a mudança.
  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, [open]);

  function handleOpen() {
    setDraft({
      theme,
      language,
      notificationsEnabled,
      micDeviceId,
      cameraDeviceId,
      noiseSuppressionMode,
      noiseSuppressionLevel,
    });
    setOpen(true);
    refreshDevices();
  }

  function handleClose() {
    setOpen(false);
    setDraft(null);
  }

  function handleSave() {
    preferences.setTheme(draft.theme);
    preferences.setLanguage(draft.language);
    preferences.setNotificationsEnabled(draft.notificationsEnabled);
    preferences.setMicDeviceId(draft.micDeviceId || null);
    preferences.setCameraDeviceId(draft.cameraDeviceId || null);
    preferences.setNoiseSuppressionMode(draft.noiseSuppressionMode);
    preferences.setNoiseSuppressionLevel(draft.noiseSuppressionLevel);
    handleClose();
  }

  // Garante que o dispositivo salvo apareça no <select> mesmo se não estiver
  // mais conectado (ex.: headset Bluetooth desligado no momento) - marcado
  // como indisponível em vez de simplesmente sumir, para o usuário entender
  // por que a chamada vai cair no padrão do sistema (fallback em
  // requestMicStream/requestCameraStream, api/media.js) sem precisar
  // reconfigurar do zero.
  function withSavedFallback(list, savedId) {
    if (!savedId || list.some((d) => d.deviceId === savedId)) return list;
    return [...list, { deviceId: savedId, label: "", missing: true }];
  }

  function deviceLabel(device, index, kind) {
    if (device.missing) return "Dispositivo salvo não encontrado";
    if (device.label) return device.label;
    return `${kind} ${index + 1}${labelsUnlocked ? "" : " (permita o acesso para ver o nome)"}`;
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Preferências"
        title="Preferências"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open &&
        draft &&
        createPortal(
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-label="Preferências"
          onClick={handleClose}
        >
          {/* Sem flex items-center aqui de propósito: centralizar com flex
              num container com overflow-y-auto corta o topo do card quando
              ele é mais alto que a viewport e não deixa rolar até lá (era o
              bug relatado). Um bloco simples com margem automática nasce
              sempre visível desde o topo e rola junto com o overlay. */}
          <div className="mx-auto w-full max-w-md">
            <div
              className="w-full rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Preferências</h2>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Fechar"
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                {/* Tema */}
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Tema</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, theme: "light" }))}
                      aria-pressed={draft.theme === "light"}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                        draft.theme === "light"
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      ☀️ Claro
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, theme: "dark" }))}
                      aria-pressed={draft.theme === "dark"}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                        draft.theme === "dark"
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      🌙 Escuro
                    </button>
                  </div>
                </div>

                {/* Idioma - lista fechada por enquanto, sem i18n de verdade
                    ainda (ver LANGUAGES em PreferencesContext.jsx) */}
                <div>
                  <label
                    htmlFor="preferences-language"
                    className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Idioma
                  </label>
                  <select
                    id="preferences-language"
                    value={draft.language}
                    onChange={(e) => setDraft((prev) => ({ ...prev, language: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                    A tradução da interface ainda não está disponível - a preferência já fica salva para quando estiver.
                  </p>
                </div>

                {/* Notificações desktop */}
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Notificações desktop
                    </span>
                    <span className="block text-xs text-slate-400 dark:text-slate-500">
                      Avisos de mensagens novas quando o app não está em foco
                    </span>
                  </span>
                  <span className="relative inline-flex shrink-0">
                    <input
                      type="checkbox"
                      checked={draft.notificationsEnabled}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, notificationsEnabled: e.target.checked }))
                      }
                      className="peer sr-only"
                    />
                    <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 dark:bg-slate-700" />
                    <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
                  </span>
                </label>

                {/* Dispositivos - microfone/webcam usados ao entrar na voz
                    (joinVoice) e ao ligar a câmera (shareCamera), ver
                    MediaSessionContext.jsx. Sem permissão concedida ainda o
                    navegador só devolve o deviceId, sem nome - por isso o
                    botão "Permitir acesso" abaixo. */}
                <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Dispositivos</p>
                    {!labelsUnlocked && (
                      <button
                        type="button"
                        onClick={handleUnlockLabels}
                        disabled={unlocking}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {unlocking ? "Solicitando..." : "Permitir acesso"}
                      </button>
                    )}
                  </div>

                  {devicesError && (
                    <p className="text-xs text-red-500 dark:text-red-400">{devicesError}</p>
                  )}

                  <div>
                    <label
                      htmlFor="preferences-mic"
                      className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400"
                    >
                      Microfone
                    </label>
                    <select
                      id="preferences-mic"
                      value={draft.micDeviceId ?? SYSTEM_DEFAULT}
                      disabled={devicesLoading}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, micDeviceId: e.target.value || null }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                    >
                      <option value={SYSTEM_DEFAULT}>Padrão do sistema</option>
                      {withSavedFallback(devices.mics, draft.micDeviceId).map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId} disabled={device.missing}>
                          {deviceLabel(device, index, "Microfone")}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="preferences-camera"
                      className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400"
                    >
                      Webcam
                    </label>
                    <select
                      id="preferences-camera"
                      value={draft.cameraDeviceId ?? SYSTEM_DEFAULT}
                      disabled={devicesLoading}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, cameraDeviceId: e.target.value || null }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                    >
                      <option value={SYSTEM_DEFAULT}>Padrão do sistema</option>
                      {withSavedFallback(devices.cameras, draft.cameraDeviceId).map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId} disabled={device.missing}>
                          {deviceLabel(device, index, "Webcam")}
                        </option>
                      ))}
                    </select>
                  </div>

                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Se o dispositivo escolhido não estiver mais disponível na hora da chamada, o padrão do
                    sistema é usado automaticamente.
                  </p>
                </div>

                {/* Supressor de ruído do próprio microfone - 'native' é o
                    noiseSuppression padrão do WebRTC (só liga/desliga);
                    'rnnoise' processa via RNNoise (WASM, open source) com
                    nível ajustável; ver api/media.js e audio/rnnoise.js. */}
                <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Supressor de ruído
                  </p>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "off", label: "Desligado" },
                      { value: "native", label: "Nativo" },
                      { value: "rnnoise", label: "RNNoise" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, noiseSuppressionMode: opt.value }))
                        }
                        aria-pressed={draft.noiseSuppressionMode === opt.value}
                        className={`rounded-xl border px-2 py-2 text-xs font-medium transition ${
                          draft.noiseSuppressionMode === opt.value
                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300"
                            : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {draft.noiseSuppressionMode === "rnnoise" && (
                    <label className="block">
                      <span className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                        Nível
                        <span>{draft.noiseSuppressionLevel}%</span>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={draft.noiseSuppressionLevel}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            noiseSuppressionLevel: Number(e.target.value),
                          }))
                        }
                        className="mt-1 w-full accent-blue-600"
                      />
                    </label>
                  )}

                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Só reduz ruído no SEU microfone - não afeta o que você ouve dos outros. Trocar de
                    modo vale a partir da próxima vez que você entrar num canal de voz.
                    {draft.noiseSuppressionMode === "rnnoise" &&
                      " RNNoise (open source, xiph/rnnoise) roda no seu navegador via WASM - segura melhor ruído de fundo (teclado, conversa, ventilador) do que o supressor nativo; nível baixo mantém mais do áudio original, alto prioriza o corte de ruído."}
                  </p>
                </div>
              </div>

              <div className="mt-7 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
