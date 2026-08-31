import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { setAccessToken } from "../api/http.js";
import { API_URL } from "../api/config.js";
import {
  getProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
  removeAvatar,
} from "../api/profile.js";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIO_MAX = 280;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

// Só a validação de FORMATO fica aqui (feedback imediato, sem round-trip) -
// a regra que realmente vale é sempre a do servidor (users.routes.js:
// magic bytes, tamanho decodificado, etc.), nunca só isto.
function validateAvatarFile(file) {
  if (!AVATAR_TYPES.includes(file.type)) {
    return "Formato não suportado. Use PNG, JPEG, WEBP ou GIF.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "Imagem maior que 2MB.";
  }
  return null;
}

export default function ProfilePage() {
  const { updateUser } = useAuth();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(null);
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({ username: "", email: "", bio: "" });
  const [profileErrors, setProfileErrors] = useState({});
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProfile()
      .then((data) => {
        if (cancelled) return;
        setProfile(data.user);
        setForm({
          username: data.user.username,
          email: data.user.email,
          bio: data.user.bio ?? "",
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cache-busting: o caminho do avatar é determinístico por usuário (mesmo
  // formato reenviado sobrescreve o mesmo arquivo no servidor), então o
  // navegador cacheia a URL antiga se não mudar - anexa updatedAt como query
  // string pra forçar recarregar depois de trocar/remover a foto.
  function avatarSrc(p) {
    if (!p?.avatarUrl) return null;
    const version = p.updatedAt ? new Date(p.updatedAt).getTime() : Date.now();
    return `${API_URL}${p.avatarUrl}?v=${version}`;
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;

    const formatError = validateAvatarFile(file);
    setAvatarError(formatError);
    if (formatError) return;

    setAvatarBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setAvatarPreview(dataUrl); // feedback visual imediato, antes da resposta do servidor
      const data = await uploadAvatar(dataUrl);
      setProfile(data.user);
      setAvatarPreview(null);
      // Topbar (RoomsPage.jsx) e qualquer outro lugar que exiba o PRÓPRIO
      // avatar leem de AuthContext, não desta tela - sem isso só refletiriam
      // a troca depois de um F5 (novo /auth/refresh).
      updateUser({ avatarPath: data.user.avatarPath });
    } catch (err) {
      setAvatarError(err.message);
      setAvatarPreview(null);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    const confirmed = window.confirm("Remover a foto de perfil?");
    if (!confirmed) return;

    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const data = await removeAvatar();
      setProfile(data.user);
      updateUser({ avatarPath: data.user.avatarPath });
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  function validateProfileForm() {
    const errors = {};
    const username = form.username.trim();
    const email = form.email.trim();
    const bio = form.bio.trim();

    if (!USERNAME_RE.test(username)) {
      errors.username = "3-32 caracteres: letras, números e _.";
    }
    if (!EMAIL_RE.test(email)) {
      errors.email = "Email inválido.";
    }
    if (bio.length > BIO_MAX) {
      errors.bio = `Máximo de ${BIO_MAX} caracteres.`;
    }
    return errors;
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileSuccess(null);
    setProfileError(null);

    const errors = validateProfileForm();
    setProfileErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // PATCH parcial: só manda o que de fato mudou (ver profileUpdateSchema
    // no servidor, que também aceita subconjuntos).
    const patch = {};
    const username = form.username.trim();
    const email = form.email.trim().toLowerCase();
    const bio = form.bio.trim();
    if (username !== profile.username) patch.username = username;
    if (email !== profile.email) patch.email = email;
    if (bio !== (profile.bio ?? "")) patch.bio = bio;

    if (Object.keys(patch).length === 0) {
      setProfileSuccess("Nada para salvar.");
      return;
    }

    setProfileBusy(true);
    try {
      const data = await updateProfile(patch);
      setProfile(data.user);
      setForm({ username: data.user.username, email: data.user.email, bio: data.user.bio ?? "" });
      if (patch.username) updateUser({ username: data.user.username });
      setProfileSuccess("Perfil atualizado.");
    } catch (err) {
      setProfileError(err.message);
      if (err.details) {
        const fieldErrors = {};
        for (const d of err.details) fieldErrors[d.field] = d.message;
        setProfileErrors(fieldErrors);
      }
    } finally {
      setProfileBusy(false);
    }
  }

  function validatePasswordForm() {
    const errors = {};
    if (!passwordForm.currentPassword) {
      errors.currentPassword = "Informe a senha atual.";
    }
    if (passwordForm.newPassword.length < 10) {
      errors.newPassword = "Mínimo de 10 caracteres.";
    } else if (!/[A-Za-z]/.test(passwordForm.newPassword) || !/[0-9]/.test(passwordForm.newPassword)) {
      errors.newPassword = "Precisa de ao menos uma letra e um número.";
    } else if (passwordForm.newPassword === passwordForm.currentPassword) {
      errors.newPassword = "A nova senha deve ser diferente da atual.";
    }
    if (passwordForm.confirmPassword !== passwordForm.newPassword) {
      errors.confirmPassword = "As senhas não coincidem.";
    }
    return errors;
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordSuccess(null);
    setPasswordError(null);

    const errors = validatePasswordForm();
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPasswordBusy(true);
    try {
      const data = await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setAccessToken(data.accessToken);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordSuccess("Senha atualizada. Outras sessões abertas foram desconectadas.");
    } catch (err) {
      setPasswordError(err.message);
      if (err.details) {
        const fieldErrors = {};
        for (const d of err.details) fieldErrors[d.field] = d.message;
        setPasswordErrors(fieldErrors);
      }
    } finally {
      setPasswordBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";
  const labelClass = "mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200";
  const fieldErrorClass = "mt-1 text-xs text-red-600 dark:text-red-400";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando perfil...</p>
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900/50 dark:bg-slate-900">
          <p className="text-sm font-medium text-red-600 dark:text-red-300">
            {loadError ?? "Não foi possível carregar o perfil."}
          </p>
          <Link
            to="/rooms"
            className="mt-4 inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Voltar
          </Link>
        </div>
      </div>
    );
  }

  const displayedAvatar = avatarPreview ?? avatarSrc(profile);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <Link
            to="/rooms"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            &larr;
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Editar perfil</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Foto de perfil */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Foto de perfil
          </h2>
          <div className="flex items-center gap-5">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-2xl font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {displayedAvatar ? (
                <img src={displayedAvatar} alt="Sua foto de perfil" className="h-full w-full object-cover" />
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
              <p className="text-xs text-slate-500 dark:text-slate-400">
                PNG, JPEG, WEBP ou GIF - até 2MB.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
          </div>
          {avatarError && <p className="mt-3 error-text">{avatarError}</p>}
        </section>

        {/* Informações do perfil */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Informações do perfil
          </h2>
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>Username</label>
              <input
                type="text"
                maxLength={32}
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                disabled={profileBusy}
                className={inputClass}
              />
              {profileErrors.username && <p className={fieldErrorClass}>{profileErrors.username}</p>}
            </div>

            {/* Identificador público único - username sozinho pode se
                repetir entre contas, então é ISTO que amigos usam pra te
                adicionar (FriendsPanel.jsx). Só leitura: o discriminador não
                muda ao trocar de username (server/src/routes/users.routes.js). */}
            <div>
              <label className={labelClass}>Identificador (para amigos te adicionarem)</label>
              <div className="flex items-center gap-2">
                <input type="text" readOnly value={profile.tag} className={inputClass + " font-mono"} />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(profile.tag).catch(() => {})}
                  className="shrink-0 rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Copiar
                </button>
              </div>
            </div>

            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                maxLength={255}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                disabled={profileBusy}
                className={inputClass}
              />
              {profileErrors.email && <p className={fieldErrorClass}>{profileErrors.email}</p>}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Bio</label>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {form.bio.length}/{BIO_MAX}
                </span>
              </div>
              <textarea
                rows={3}
                maxLength={BIO_MAX}
                placeholder="Conte um pouco sobre você"
                value={form.bio}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                disabled={profileBusy}
                className={inputClass + " resize-none"}
              />
              {profileErrors.bio && <p className={fieldErrorClass}>{profileErrors.bio}</p>}
            </div>

            {profileError && <p className="error-text">{profileError}</p>}
            {profileSuccess && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                {profileSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={profileBusy}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              {profileBusy ? "Salvando..." : "Salvar alterações"}
            </button>
          </form>
        </section>

        {/* Alterar senha */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Alterar senha
          </h2>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>Senha atual</label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
                disabled={passwordBusy}
                className={inputClass}
              />
              {passwordErrors.currentPassword && (
                <p className={fieldErrorClass}>{passwordErrors.currentPassword}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Nova senha</label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                disabled={passwordBusy}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Mínimo de 10 caracteres, com ao menos uma letra e um número.
              </p>
              {passwordErrors.newPassword && <p className={fieldErrorClass}>{passwordErrors.newPassword}</p>}
            </div>

            <div>
              <label className={labelClass}>Confirmar nova senha</label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                disabled={passwordBusy}
                className={inputClass}
              />
              {passwordErrors.confirmPassword && (
                <p className={fieldErrorClass}>{passwordErrors.confirmPassword}</p>
              )}
            </div>

            {passwordError && <p className="error-text">{passwordError}</p>}
            {passwordSuccess && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                {passwordSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={passwordBusy}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              {passwordBusy ? "Atualizando..." : "Atualizar senha"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
