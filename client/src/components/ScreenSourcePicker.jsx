import { useState } from "react";
import { AppWindow, Lock, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  allowedScreenPresets,
  clampScreenQuality,
  suggestScreenBitrateKbps,
} from "../api/media.js";
import { useTurboLimits } from "../context/AuthContext.jsx";
import { useOpenTurbo } from "../hooks/useOpenTurbo.js";
import NavespeakLogoV1 from "./NavespeakLogoV1.jsx";

// Modal pra escolher o que compartilhar + qualidade.
//
// `sources`: no Electron, lista de tela/janela pra escolher (getDisplayMedia
// não funciona lá - ver api/media.js). No navegador comum vem como array
// vazio: o seletor de JANELA é o nativo do próprio getDisplayMedia (mostra
// depois, ao confirmar), então aqui só sobra escolher a qualidade.
//
// `sources === "loading"`: o modal abre na hora do clique (listar as fontes
// no Electron leva ~0,5-2s) e mostra o foguete "decolando" até a lista chegar.
//
// Abas "Telas" / "Janelas" (só com `sources`): separadas pelo prefixo do id
// do desktopCapturer ('screen:' = tela inteira, o resto = janela). A grade da
// aba tem scroll PRÓPRIO (.source-grid), então com muitas janelas as opções de
// qualidade abaixo continuam sempre visíveis. Trocar de aba limpa a seleção.
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
  const [tab, setTab] = useState("screen");
  const [withAudio, setWithAudio] = useState(defaultWithAudio);
  const { t } = useTranslation();
  const limits = useTurboLimits();
  const openTurbo = useOpenTurbo();
  // Teto vindo do servidor (nada de recalcular modo A/B aqui). Opções acima
  // dele ficam com cadeado e levam ao TurboPanel; o padrão já nasce dentro do teto.
  const presets = allowedScreenPresets(limits);
  const initial = clampScreenQuality({}, limits);
  const [resolution, setResolution] = useState(initial.resolution);
  const [frameRate, setFrameRate] = useState(initial.frameRate);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customBitrate, setCustomBitrate] = useState("");

  const loading = sources === "loading";
  const list = loading ? [] : sources;
  const hasSources = list.length > 0;
  const screens = list.filter((s) => s.id.startsWith("screen:"));
  const windows = list.filter((s) => !s.id.startsWith("screen:"));
  const tabs = [
    { value: "screen", label: "Telas", items: screens, empty: "Nenhuma tela encontrada." },
    { value: "window", label: "Janelas", items: windows, empty: "Nenhuma janela aberta encontrada." },
  ];
  const activeTab = tabs.find((t) => t.value === tab);
  const canConfirm = !loading && (!hasSources || Boolean(selected));
  const suggestedBitrate = Math.min(suggestScreenBitrateKbps(resolution, frameRate), presets.maxBitrateKbps);

  function confirm(sourceId) {
    const bitrateKbps = advancedOpen && customBitrate ? Number(customBitrate) : undefined;
    onSelect(sourceId, withAudio, { resolution, frameRate, bitrateKbps });
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3>{title}</h3>

        {loading && (
          <div className="mb-4 flex flex-col items-center gap-2 py-6" role="status">
            <NavespeakLogoV1
              title="Carregando"
              className="nvs-logo-launching h-14 w-14 text-slate-700 dark:text-slate-100"
            />
            <p className="text-sm text-slate-500 dark:text-slate-400">Carregando telas e janelas...</p>
          </div>
        )}

        {hasSources && (
          <>
            <div className="source-tabs" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  className="source-tab"
                  aria-selected={tab === t.value}
                  onClick={() => {
                    setTab(t.value);
                    setSelected(null);
                  }}
                >
                  {t.label} ({t.items.length})
                </button>
              ))}
            </div>
            <div className="source-grid" role="tabpanel">
              {activeTab.items.length === 0 && (
                <p className="source-empty">{activeTab.empty}</p>
              )}
              {activeTab.items.map((source) => (
                <button
                  key={source.id}
                  className="source-option"
                  aria-pressed={selected === source.id}
                  onClick={() => setSelected(source.id)}
                  onDoubleClick={() => confirm(source.id)}
                >
                  {source.thumbnail ? (
                    <img src={source.thumbnail} alt="" />
                  ) : (
                    // Sem miniatura: monitor que o Chromium não enxerga ou
                    // janela minimizada (ver electron/winSources.js).
                    <span className="flex aspect-[5/3] w-full items-center justify-center rounded bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                      {source.id.startsWith("screen:") ? <Monitor className="size-6" /> : <AppWindow className="size-6" />}
                    </span>
                  )}
                  <span>{source.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <span>Resolução</span>
            <div className="quality-pill-group">
              {presets.resolutions.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className="quality-pill"
                  aria-pressed={resolution === r.value}
                  title={r.allowed ? undefined : t("turbo.locked.cta")}
                  onClick={() => (r.allowed ? setResolution(r.value) : openTurbo())}
                >
                  {r.label}
                  {!r.allowed && <Lock className="ml-1 inline size-3" />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span>Taxa de quadros</span>
            <div className="quality-pill-group">
              {presets.framerates.map(({ fps, allowed }) => (
                <button
                  key={fps}
                  type="button"
                  className="quality-pill"
                  aria-pressed={frameRate === fps}
                  title={allowed ? undefined : t("turbo.locked.cta")}
                  onClick={() => (allowed ? setFrameRate(fps) : openTurbo())}
                >
                  {fps} FPS
                  {!allowed && <Lock className="ml-1 inline size-3" />}
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
                  max={presets.maxBitrateKbps}
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
