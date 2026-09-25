import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Square, Mic } from "lucide-react";
import {
  NOISE_SUPPRESSION_OPTIONS,
  usePreferences,
} from "../context/PreferencesContext.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import {
  listMediaDevices,
  supportsAudioOutputSelection,
} from "../api/media.js";

const POPUP_WIDTH = 288; // w-72
const labelClass =
  "mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300";
const selectClass =
  "w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white";

function destroyChain(chain) {
  chain.rawStream.getTracks().forEach((t) => t.stop());
  chain.denoiser?.destroy();
  chain.gate?.destroy();
  chain.gain?.destroy();
}

// Slider com estado local: só grava na preferência ao SOLTAR - cada passo do
// arrasto gravando em PreferencesContext re-renderizaria todo consumidor do
// contexto (VoicePanel, tiles...) e escreveria no localStorage dezenas de
// vezes por segundo. `onLive` recebe cada passo pra quem precisa de
// feedback imediato barato (ex.: GainNode do teste de mic).
function VolumeSlider({ id, label, value, onCommit, onLive }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => {
    if (local !== value) onCommit(local);
  };
  return (
    <div>
      <label htmlFor={id} className={`${labelClass} flex justify-between`}>
        {label}
        <span className="font-normal text-slate-400 dark:text-slate-500">
          {local}%
        </span>
      </label>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        step="1"
        value={local}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          onLive?.(v);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-full cursor-pointer accent-purple-600"
      />
    </div>
  );
}

function MicSettings() {
  const media = useMediaSession();
  const {
    micDeviceId,
    setMicDeviceId,
    noiseSuppressionMode,
    setNoiseSuppressionMode,
    micVolume,
    setMicVolume,
    outputDeviceId,
  } = usePreferences();
  const [mics, setMics] = useState([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState(null);
  const audioRef = useRef(null);
  const chainRef = useRef(null);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  // true = o TESTE ensurdeceu o usuário (estava na call) - só desfaz o que
  // ele mesmo fez; se o usuário já estava ensurdecido, ou desensurdeceu na
  // mão durante o teste, não mexe.
  const autoDeafenedRef = useRef(false);

  useEffect(() => {
    listMediaDevices()
      .then((list) => setMics(list.mics))
      .catch(() => {});
  }, []);

  // Captura SEPARADA da chamada (funciona fora da call também), com a mesma
  // cadeia que a call usaria (dispositivo, supressor, gate, volume) - o que
  // se ouve é o que os outros ouviriam. Refaz ao trocar dispositivo/
  // supressor (buildMicChain muda de identidade junto).
  useEffect(() => {
    if (!testing) return;
    let cancelled = false;
    let chain = null;
    (async () => {
      try {
        chain = await media.buildMicChain(micDeviceId);
        if (cancelled) return destroyChain(chain);
        chainRef.current = chain;
        const el = audioRef.current;
        el.srcObject = new MediaStream([chain.audioTrack]);
        if (outputDeviceId && typeof el.setSinkId === "function") {
          await el.setSinkId(outputDeviceId).catch(() => {});
        }
        await el.play();
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setTestError(err.message ?? "Não foi possível testar o microfone.");
        setTesting(false);
      }
    })();
    return () => {
      cancelled = true;
      chainRef.current = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      if (chain) destroyChain(chain);
    };
  }, [testing, micDeviceId, media.buildMicChain, outputDeviceId]);

  function startTest() {
    setTestError(null);
    const m = mediaRef.current;
    // Na call: ensurdece (e com isso muta o mic) pra ouvir SÓ o próprio
    // teste - sem isso o teste vazaria pros outros e a voz deles se
    // misturaria com a sua.
    if (m.connected && !m.deafened) {
      autoDeafenedRef.current = true;
      m.toggleDeafen();
    }
    setTesting(true);
  }

  function stopTest() {
    setTesting(false);
    const m = mediaRef.current;
    if (autoDeafenedRef.current && m.connected && m.deafened) m.toggleDeafen();
    autoDeafenedRef.current = false;
  }

  // Fechar o popover no meio do teste desfaz o ensurdecer automático.
  const stopTestRef = useRef(stopTest);
  stopTestRef.current = stopTest;
  useEffect(() => () => stopTestRef.current(), []);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="qs-mic-device" className={labelClass}>
          Microfone
        </label>
        <select
          id="qs-mic-device"
          value={micDeviceId ?? ""}
          onChange={(e) => setMicDeviceId(e.target.value || null)}
          className={selectClass}
        >
          <option value="">Padrão do sistema</option>
          {mics.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microfone ${i + 1}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="qs-noise" className={labelClass}>
          Supressor de ruído
        </label>
        <select
          id="qs-noise"
          value={noiseSuppressionMode}
          onChange={(e) => setNoiseSuppressionMode(e.target.value)}
          className={selectClass}
        >
          {NOISE_SUPPRESSION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {noiseSuppressionMode === "deepfilternet" && (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Mais pesado: baixa ~24MB na primeira vez e usa mais CPU.
          </p>
        )}
      </div>

      <VolumeSlider
        id="qs-mic-volume"
        label="Volume do microfone"
        value={micVolume}
        onCommit={setMicVolume}
        onLive={(v) => chainRef.current?.gain?.setVolume(v)}
      />

      <div>
        <button
          type="button"
          onClick={testing ? stopTest : startTest}
          aria-pressed={testing}
          className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            testing
              ? "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400"
              : "bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-400"
          }`}
        >
          {testing ? (
            <>
              <Square className="size-4" /> Parar teste
            </>
          ) : (
            <>
              <Mic className="size-4" /> Testar microfone
            </>
          )}
        </button>
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          Use fone para evitar microfonia.
          {media.connected && " Durante o teste você fica ensurdecido na chamada."}
        </p>
        {testError && (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">
            {testError}
          </p>
        )}
        <audio ref={audioRef} hidden />
      </div>
    </div>
  );
}

function OutputSettings() {
  const { outputDeviceId, setOutputDeviceId, callVolume, setCallVolume } =
    usePreferences();
  const [speakers, setSpeakers] = useState([]);

  useEffect(() => {
    if (!supportsAudioOutputSelection) return;
    listMediaDevices()
      .then((list) => setSpeakers(list.speakers))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="qs-output-device" className={labelClass}>
          Dispositivo de saída
        </label>
        {supportsAudioOutputSelection ? (
          <select
            id="qs-output-device"
            value={outputDeviceId ?? ""}
            onChange={(e) => setOutputDeviceId(e.target.value || null)}
            className={selectClass}
          >
            <option value="">Padrão do sistema</option>
            {speakers
              .filter((d) => d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Saída ${i + 1}`}
                </option>
              ))}
          </select>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Seu navegador não permite escolher a saída de áudio.
          </p>
        )}
      </div>
      <VolumeSlider
        id="qs-call-volume"
        label="Volume da chamada"
        value={callVolume}
        onCommit={setCallVolume}
      />
    </div>
  );
}

// Seta ao lado do mic/fone na VoiceControlBar: ajustes rápidos num popover
// que abre pra cima (como o de ConnectionStatusButton). Via portal com
// posição fixa porque a barra tem overflow-hidden, que cortaria o popover.
export default function AudioQuickSettings({ kind }) {
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const label =
    kind === "mic" ? "Ajustes do microfone" : "Ajustes de áudio da chamada";

  function toggle() {
    if (pos) return setPos(null);
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      left: Math.max(
        8,
        Math.min(rect.left - 40, window.innerWidth - POPUP_WIDTH - 8),
      ),
      bottom: window.innerHeight - rect.top + 8,
    });
  }

  useEffect(() => {
    if (!pos) return;
    function handleMouseDown(e) {
      if (
        !popoverRef.current?.contains(e.target) &&
        !buttonRef.current?.contains(e.target)
      )
        setPos(null);
    }
    function handleKey(e) {
      if (e.key === "Escape") setPos(null);
    }
    // Posição é calculada uma vez ao abrir - redimensionar fecha em vez de
    // deixar o popover solto longe do botão.
    const close = () => setPos(null);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={Boolean(pos)}
        className="cursor-pointer rounded-lg text-slate-600 transition hover:bg-slate-200 dark:text-white dark:hover:bg-gray-500"
      >
        <ChevronDown
          className={`size-4 transition ${pos ? "rotate-180" : ""}`}
        />
      </button>
      {pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={label}
            style={{ position: "fixed", left: pos.left, bottom: pos.bottom }}
            className="z-50 w-72 max-w-[calc(100vw-1rem)] rounded-xl bg-white p-4 text-sm shadow-lg ring-1 ring-slate-200 dark:bg-[#181a20] dark:ring-slate-800"
          >
            {kind === "mic" ? <MicSettings /> : <OutputSettings />}
          </div>,
          document.body,
        )}
    </>
  );
}
