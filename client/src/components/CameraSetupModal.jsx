import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Droplets, Plus, X } from "lucide-react";
import { usePreferences } from "../context/PreferencesContext.jsx";
import { listMediaDevices, requestCameraStream } from "../api/media.js";
import {
  listBackgrounds,
  uploadMyBackground,
  deleteMyBackground,
  backgroundSrc,
} from "../api/backgrounds.js";
import {
  listLocalBackgrounds,
  addLocalBackground,
  deleteLocalBackground,
  MAX_LOCAL_BACKGROUNDS,
} from "../utils/localBackgrounds.js";
import {
  createBackgroundProcessor,
  resolveBackground,
} from "../utils/backgroundProcessor.js";

const MAX_LOCAL_BYTES = 8 * 1024 * 1024;
const MAX_SERVER_BYTES = 2 * 1024 * 1024; // mesmo teto de backgrounds.routes.js
const selectClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white";

const sameImage = (a, b) =>
  Boolean(a && b) &&
  a.source === b.source &&
  (a.source === "local" ? a.id === b.id : a.filePath === b.filePath);

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// Modal aberto pelo botão de câmera (MediaSessionContext#shareCamera): escolhe
// webcam + fundo (nenhum / desfoque / imagem) com PREVIEW ao vivo antes de
// mostrar o rosto pra todo mundo. "Lembrar" desliga esse modal nas próximas
// vezes (religável em Preferências > Dispositivos). Fundos: padrões do sistema
// (servidor, todos veem), pessoais LOCAIS (IndexedDB) e, se o admin liberar
// (recurso futuro pago), pessoais no servidor.
export default function CameraSetupModal({ onConfirm, onCancel }) {
  const preferences = usePreferences();
  const [deviceId, setDeviceId] = useState(preferences.cameraDeviceId);
  const [mode, setMode] = useState(preferences.cameraBackground.mode);
  const [image, setImage] = useState(preferences.cameraBackground.image);
  const [remember, setRemember] = useState(false);

  const [cameras, setCameras] = useState([]);
  const [raw, setRaw] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState(null);

  const [remote, setRemote] = useState({ defaults: [], mine: [], serverUpload: false });
  const [local, setLocal] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  // Webcam crua (sem fundo) - dona dela é este efeito, o preview só lê.
  useEffect(() => {
    let cancelled = false;
    let opened = null;
    setRaw(null);
    setError(null);
    requestCameraStream(deviceId)
      .then(async ({ stream, fellBack }) => {
        if (cancelled || fellBack) {
          stream.getTracks().forEach((t) => t.stop());
          if (fellBack && !cancelled) setDeviceId(null); // salva sumiu: reabre no padrão
          return;
        }
        opened = stream;
        setRaw(stream);
        // Só agora (permissão dada) os rótulos das webcams vêm preenchidos.
        const devices = await listMediaDevices();
        if (!cancelled) setCameras(devices.cameras);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err.name === "NotAllowedError"
              ? "Permissão de câmera negada."
              : err.message ?? "Não foi possível abrir a câmera.",
          );
        }
      });
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  // Preview: câmera crua com fundo 'none', senão passa pelo processador.
  useEffect(() => {
    if (!raw) return undefined;
    if (mode === "none") {
      setPreview(raw);
      return undefined;
    }
    let cancelled = false;
    let processor = null;
    setPreviewLoading(true);
    (async () => {
      try {
        const background = await resolveBackground({ mode, image });
        processor = await createBackgroundProcessor(raw, background);
        if (cancelled) return processor.stop();
        setError(null);
        setPreview(processor.stream);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Não foi possível aplicar este fundo.");
          setPreview(raw);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      processor?.stop();
    };
  }, [raw, mode, image]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = preview;
  }, [preview]);

  useEffect(() => {
    listBackgrounds()
      .then((data) =>
        setRemote({ defaults: data.defaults, mine: data.mine, serverUpload: data.userServerUploadEnabled }),
      )
      .catch(() => {}); // sem lista do servidor ainda dá pra usar blur e fundos locais
    listLocalBackgrounds().then(setLocal).catch(() => {});
  }, []);

  const localUrls = useMemo(() => local.map((r) => URL.createObjectURL(r.blob)), [local]);
  useEffect(() => () => localUrls.forEach((u) => URL.revokeObjectURL(u)), [localUrls]);

  // Um formato só pra galeria: { key, label, thumb, ref, onDelete? }.
  const tiles = [
    ...remote.defaults.map((b) => ({
      key: b.id,
      label: b.name,
      thumb: backgroundSrc(b.filePath),
      ref: { source: "remote", filePath: b.filePath },
    })),
    ...remote.mine.map((b) => ({
      key: b.id,
      label: b.name,
      thumb: backgroundSrc(b.filePath),
      ref: { source: "remote", filePath: b.filePath },
      onDelete: () =>
        deleteMyBackground(b.id).then(() =>
          setRemote((prev) => ({ ...prev, mine: prev.mine.filter((x) => x.id !== b.id) })),
        ),
    })),
    ...local.map((r, i) => ({
      key: r.id,
      label: r.name,
      thumb: localUrls[i],
      ref: { source: "local", id: r.id },
      onDelete: () =>
        deleteLocalBackground(r.id).then(() => setLocal((prev) => prev.filter((x) => x.id !== r.id))),
    })),
  ];

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 48) || "Fundo";
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use PNG, JPG ou WebP.");
      if (remote.serverUpload) {
        if (file.size > MAX_SERVER_BYTES) throw new Error("Imagem maior que 2MB.");
        const { background } = await uploadMyBackground({ name, image: await readAsDataUrl(file) });
        setRemote((prev) => ({ ...prev, mine: [...prev.mine, background] }));
        setMode("image");
        setImage({ source: "remote", filePath: background.filePath });
      } else {
        if (file.size > MAX_LOCAL_BYTES) throw new Error("Imagem maior que 8MB.");
        if (local.length >= MAX_LOCAL_BACKGROUNDS) {
          throw new Error(`Limite de ${MAX_LOCAL_BACKGROUNDS} fundos atingido - remova algum.`);
        }
        const record = await addLocalBackground({ name, blob: file });
        setLocal((prev) => [...prev, record]);
        setMode("image");
        setImage({ source: "local", id: record.id });
      }
    } catch (err) {
      setUploadError(err.message);
    }
  }

  function confirm() {
    const background = { mode, image: mode === "image" ? image : null };
    preferences.setCameraDeviceId(deviceId);
    preferences.setCameraBackground(background);
    preferences.setCameraAskEveryTime(!remember);
    onConfirm({ deviceId, background });
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3>Configurar câmera</h3>

        <div className="relative mb-3 aspect-video overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          {(!preview || previewLoading) && !error && (
            <span className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
              {previewLoading ? "Aplicando fundo..." : "Abrindo câmera..."}
            </span>
          )}
        </div>
        {error && <p className="mb-2 text-sm text-red-500">{error}</p>}

        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Câmera
            <select
              className={selectClass}
              value={deviceId ?? ""}
              onChange={(e) => setDeviceId(e.target.value || null)}
            >
              <option value="">Padrão do sistema</option>
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Webcam ${i + 1}`}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span>Plano de fundo</span>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <button
                type="button"
                className="source-option"
                aria-pressed={mode === "none"}
                onClick={() => setMode("none")}
              >
                <Ban className="size-5" />
                <span>Nenhum</span>
              </button>
              <button
                type="button"
                className="source-option"
                aria-pressed={mode === "blur"}
                onClick={() => setMode("blur")}
              >
                <Droplets className="size-5" />
                <span>Desfocar</span>
              </button>
              {tiles.map((t) => (
                <div key={t.key} className="relative">
                  <button
                    type="button"
                    className="source-option w-full"
                    aria-pressed={mode === "image" && sameImage(image, t.ref)}
                    onClick={() => {
                      setMode("image");
                      setImage(t.ref);
                    }}
                  >
                    <img src={t.thumb} alt="" className="aspect-video object-cover" />
                    <span className="max-w-full truncate">{t.label}</span>
                  </button>
                  {t.onDelete && (
                    <button
                      type="button"
                      title="Remover"
                      aria-label={`Remover ${t.label}`}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                      onClick={() => {
                        if (mode === "image" && sameImage(image, t.ref)) setMode("none");
                        t.onDelete().catch((err) => setUploadError(err.message));
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="source-option"
                onClick={() => fileInputRef.current.click()}
              >
                <Plus className="size-5" />
                <span>Enviar imagem</span>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFile}
            />
            {uploadError && <p className="text-red-500">{uploadError}</p>}
          </div>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Lembrar essas escolhas e não mostrar esta janela ao ligar a câmera
          </label>

          <div className="flex gap-2">
            <button className="modal-cancel" onClick={onCancel}>
              Cancelar
            </button>
            <button className="modal-confirm" disabled={!raw} onClick={confirm}>
              Ligar câmera
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
