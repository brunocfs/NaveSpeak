import { useEffect, useRef, useState } from "react";
import { API_URL } from "../api/config.js";
import {
  getSystemProfile,
  updateSystemProfile,
  uploadSystemAvatar,
  removeSystemAvatar,
} from "../api/adminSystemUser.js";
import StyledUsername from "./StyledUsername.jsx";

const BIO_MAX = 280;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const DEFAULT_STYLE = {
  colorMode: "none", // "none" | "solid" | "gradient" - só de controle local, nunca vai pro servidor
  color: "#7c3aed",
  gradient: ["#7c3aed", "#22d3ee"],
  bold: false,
  italic: false,
  underline: false,
  font: "default",
  effect: "none",
};

const FONT_OPTIONS = [
  { value: "default", label: "Padrão" },
  { value: "serif", label: "Serifada" },
  { value: "mono", label: "Monoespaçada" },
  { value: "display", label: "Destaque" },
];

const EFFECT_OPTIONS = [
  { value: "none", label: "Nenhum" },
  { value: "shine", label: "Brilho" },
  { value: "pulse", label: "Pulsante" },
];

// name_style do servidor (color/gradient/bold/italic/underline/font/effect)
// <-> estado local do formulário (mesmos campos + colorMode, que só existe
// aqui pra decidir qual dos dois - color ou gradient - o formulário mostra).
function styleFromServer(nameStyle) {
  const s = nameStyle ?? {};
  return {
    ...DEFAULT_STYLE,
    ...s,
    colorMode: s.gradient ? "gradient" : s.color ? "solid" : "none",
    color: s.color ?? DEFAULT_STYLE.color,
    gradient: s.gradient ?? DEFAULT_STYLE.gradient,
  };
}

function styleToPayload(styleForm) {
  return {
    color: styleForm.colorMode === "solid" ? styleForm.color : null,
    gradient: styleForm.colorMode === "gradient" ? styleForm.gradient : null,
    bold: styleForm.bold,
    italic: styleForm.italic,
    underline: styleForm.underline,
    font: styleForm.font,
    effect: styleForm.effect,
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function validateAvatarFile(file) {
  if (!AVATAR_TYPES.includes(file.type)) {
    return "Formato não suportado. Use PNG, JPEG, WEBP ou GIF.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "Imagem maior que 2MB.";
  }
  return null;
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";

// Controle total do perfil do "Zeno, o Astronauta" (nome de exibição, bio,
// foto) - versão enxuta de AccountProfileSettings.jsx (sem email/senha, que
// não fazem sentido pra uma conta que nunca loga) mirada em
// api/adminSystemUser.js em vez de api/profile.js. Usado só em
// AdminBroadcastsPage.jsx, atrás de requireAdmin no servidor.
export default function SystemUserProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(null);
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({ username: "", bio: "" });
  const [styleForm, setStyleForm] = useState(DEFAULT_STYLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function load() {
    setLoading(true);
    getSystemProfile()
      .then((data) => {
        setProfile(data.user);
        setForm({ username: data.user.username, bio: data.user.bio ?? "" });
        setStyleForm(styleFromServer(data.user.nameStyle));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function avatarSrc(p) {
    if (!p?.avatarUrl) return null;
    return `${API_URL}${p.avatarUrl}?v=${Date.now()}`;
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const formatError = validateAvatarFile(file);
    setAvatarError(formatError);
    if (formatError) return;

    setAvatarBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setAvatarPreview(dataUrl);
      const data = await uploadSystemAvatar(dataUrl);
      setProfile(data.user);
      setAvatarPreview(null);
    } catch (err) {
      setAvatarError(err.message);
      setAvatarPreview(null);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    const confirmed = window.confirm("Remover a foto de perfil do Zeno?");
    if (!confirmed) return;

    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const data = await removeSystemAvatar();
      setProfile(data.user);
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const username = form.username.trim();
    const bio = form.bio.trim();
    const nameStylePayload = styleToPayload(styleForm);
    const patch = {};
    if (username !== profile.username) patch.username = username;
    if (bio !== (profile.bio ?? "")) patch.bio = bio;
    // Estilo é sempre substituído por inteiro (ver updateProfile no
    // servidor) - só manda se algo de fato mudou em relação ao que veio do
    // servidor, pra "Nada para salvar" continuar correto quando só
    // abrir/fechar o formulário sem tocar em nada.
    if (JSON.stringify(nameStylePayload) !== JSON.stringify(styleToPayload(styleFromServer(profile.nameStyle)))) {
      patch.nameStyle = nameStylePayload;
    }

    if (Object.keys(patch).length === 0) {
      setSuccess("Nada para salvar.");
      return;
    }

    setBusy(true);
    try {
      const data = await updateSystemProfile(patch);
      setProfile(data.user);
      setForm({ username: data.user.username, bio: data.user.bio ?? "" });
      setStyleForm(styleFromServer(data.user.nameStyle));
      setSuccess("Perfil do Zeno atualizado.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Carregando perfil...</p>;
  }
  if (loadError || !profile) {
    return (
      <p className="text-sm font-medium text-red-600 dark:text-red-300">
        {loadError ?? "Não foi possível carregar o perfil do Zeno."}
      </p>
    );
  }

  const displayedAvatar = avatarPreview ?? avatarSrc(profile);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-2xl font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {displayedAvatar ? (
            <img src={displayedAvatar} alt="Foto do Zeno" className="h-full w-full object-cover" />
          ) : (
            profile.username?.[0]?.toUpperCase()
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              {avatarBusy ? "Enviando..." : "Alterar foto"}
            </button>
            {profile.avatarUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={avatarBusy}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Remover foto
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">PNG, JPEG, WEBP ou GIF - até 2MB.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleAvatarChange}
            className="hidden"
          />
        </div>
      </div>
      {avatarError && <p className="error-text">{avatarError}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Nome de exibição
          </label>
          <input
            type="text"
            maxLength={32}
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            disabled={busy}
            className={inputClass}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Bio</label>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {form.bio.length}/{BIO_MAX}
            </span>
          </div>
          <textarea
            rows={2}
            maxLength={BIO_MAX}
            placeholder="Ex.: Notícias e novidades do NaveSpeak."
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            disabled={busy}
            className={inputClass + " resize-none"}
          />
        </div>

        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            Estilo do nome
          </p>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Como "{form.username || "Zeno"}" aparece nas mensagens, na lista de conversas e no cabeçalho da DM.
          </p>

          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/60">
            <StyledUsername
              username={form.username || "Zeno"}
              style={styleToPayload(styleForm)}
              className="text-base font-semibold text-slate-900 dark:text-white"
            />
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Cor
              </p>
              <div className="mb-2 grid grid-cols-3 gap-2">
                {[
                  { value: "none", label: "Padrão" },
                  { value: "solid", label: "Sólida" },
                  { value: "gradient", label: "Gradiente" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStyleForm((f) => ({ ...f, colorMode: opt.value }))}
                    aria-pressed={styleForm.colorMode === opt.value}
                    disabled={busy}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      styleForm.colorMode === opt.value
                        ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-300"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {styleForm.colorMode === "solid" && (
                <input
                  type="color"
                  value={styleForm.color}
                  onChange={(e) => setStyleForm((f) => ({ ...f, color: e.target.value }))}
                  disabled={busy}
                  className="h-10 w-20 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                />
              )}
              {styleForm.colorMode === "gradient" && (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={styleForm.gradient[0]}
                    onChange={(e) =>
                      setStyleForm((f) => ({ ...f, gradient: [e.target.value, f.gradient[1]] }))
                    }
                    disabled={busy}
                    className="h-10 w-20 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                  />
                  <span className="text-xs text-slate-400 dark:text-slate-500">até</span>
                  <input
                    type="color"
                    value={styleForm.gradient[1]}
                    onChange={(e) =>
                      setStyleForm((f) => ({ ...f, gradient: [f.gradient[0], e.target.value] }))
                    }
                    disabled={busy}
                    className="h-10 w-20 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { key: "bold", label: "Negrito" },
                { key: "italic", label: "Itálico" },
                { key: "underline", label: "Sublinhado" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStyleForm((f) => ({ ...f, [opt.key]: !f[opt.key] }))}
                  aria-pressed={styleForm[opt.key]}
                  disabled={busy}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    styleForm[opt.key]
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-300"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Fonte
                </label>
                <select
                  value={styleForm.font}
                  onChange={(e) => setStyleForm((f) => ({ ...f, font: e.target.value }))}
                  disabled={busy}
                  className={inputClass}
                >
                  {FONT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Efeito
                </label>
                <select
                  value={styleForm.effect}
                  onChange={(e) => setStyleForm((f) => ({ ...f, effect: e.target.value }))}
                  disabled={busy}
                  className={inputClass}
                >
                  {EFFECT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        {success && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          {busy ? "Salvando..." : "Salvar alterações"}
        </button>
      </form>
    </div>
  );
}
