import { useState } from "react";
import {
  SCREEN_RESOLUTIONS,
  SCREEN_FRAMERATES,
  DEFAULT_SCREEN_QUALITY,
  suggestScreenBitrateKbps,
} from "../api/media.js";

// Modal pra escolher o que compartilhar + qualidade.
//
// `sources`: no Electron, lista de tela/janela pra escolher (getDisplayMedia
// não funciona lá - ver api/media.js). No navegador comum vem como array
// vazio: o seletor de JANELA é o nativo do próprio getDisplayMedia (mostra
// depois, ao confirmar), então aqui só sobra escolher a qualidade.
//
// Checkbox de áudio: só faz sentido pro Electron (navegador comum já mostra
// "Compartilhar áudio" no seletor NATIVO dele - ver requestScreenStream em
// api/media.js).
//
// Qualidade: resolução + fps sempre visíveis; bitrate fica atrás de
// "Configurações avançadas" (a maioria não precisa mexer - ver
// suggestScreenBitrateKbps pro valor automático usado quando não abrir isso).
export default function ScreenSourcePicker({
  sources,
  onSelect,
  onCancel,
  title = "Escolha o que compartilhar",
  defaultWithAudio = false,
}) {
  const [selected, setSelected] = useState(null);
  const [withAudio, setWithAudio] = useState(defaultWithAudio);
  const [resolution, setResolution] = useState(DEFAULT_SCREEN_QUALITY.resolution);
  const [frameRate, setFrameRate] = useState(DEFAULT_SCREEN_QUALITY.frameRate);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customBitrate, setCustomBitrate] = useState("");

  const hasSources = sources.length > 0;
  const canConfirm = !hasSources || Boolean(selected);
  const suggestedBitrate = suggestScreenBitrateKbps(resolution, frameRate);

  function confirm(sourceId) {
    const bitrateKbps = advancedOpen && customBitrate ? Number(customBitrate) : undefined;
    onSelect(sourceId, withAudio, { resolution, frameRate, bitrateKbps });
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3>{title}</h3>

        {hasSources && (
          <div className="source-grid">
            {sources.map((source) => (
              <button
                key={source.id}
                className="source-option"
                aria-pressed={selected === source.id}
                onClick={() => setSelected(source.id)}
                onDoubleClick={() => confirm(source.id)}
              >
                {source.thumbnail && <img src={source.thumbnail} alt="" />}
                <span>{source.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <span>Resolução</span>
            <div className="quality-pill-group">
              {SCREEN_RESOLUTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className="quality-pill"
                  aria-pressed={resolution === r.value}
                  onClick={() => setResolution(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span>Taxa de quadros</span>
            <div className="quality-pill-group">
              {SCREEN_FRAMERATES.map((fps) => (
                <button
                  key={fps}
                  type="button"
                  className="quality-pill"
                  aria-pressed={frameRate === fps}
                  onClick={() => setFrameRate(fps)}
                >
                  {fps} FPS
                </button>
              ))}
            </div>
          </div>

          <div>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? "Ocultar" : "Mostrar"} configurações avançadas
            </button>
            {advancedOpen && (
              <label className="flex flex-col gap-1 pt-2 text-sm">
                Taxa de bits (kbps) - vazio usa o automático ({suggestedBitrate} kbps)
                <input
                  type="number"
                  min={500}
                  max={8000}
                  step={100}
                  placeholder={String(suggestedBitrate)}
                  value={customBitrate}
                  onChange={(e) => setCustomBitrate(e.target.value)}
                />
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withAudio}
              onChange={(e) => setWithAudio(e.target.checked)}
            />
            Compartilhar áudio do sistema (quando suportado)
          </label>
          <div className="flex gap-2">
            <button className="modal-cancel" onClick={onCancel}>Cancelar</button>
            <button
              className="modal-confirm"
              disabled={!canConfirm}
              onClick={() => confirm(selected)}
            >
              Compartilhar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
