import { Rocket, Sparkles } from "lucide-react";

// Placeholder até o usuário decidir os benefícios reais do plano TURBO -
// só troca este array quando a lista final existir, o layout já suporta
// qualquer quantidade de cards.
const PLACEHOLDER_BENEFITS = [1, 2, 3, 4];

export default function TurboPanel() {
  return (
    <div className="turbo-page relative h-full overflow-y-auto bg-[#05030c] text-slate-100">
      <div className="turbo-page-stars absolute inset-0" aria-hidden="true" />
      <div className="turbo-page-flame absolute inset-x-0 bottom-0 h-2/3" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-full w-full max-w-4xl flex-col px-6 py-10 sm:px-10">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="turbo-page-badge mb-6 inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-200">
            <Sparkles className="size-3.5" /> Em breve
          </span>

          <div className="turbo-page-icon mb-4 flex size-20 items-center justify-center rounded-3xl border border-purple-400/30 bg-purple-500/10">
            <Rocket className="size-10 text-fuchsia-200" />
          </div>

          <h1 className="turbo-page-title text-5xl font-black tracking-tight sm:text-6xl">
            TURBO
          </h1>
          <p className="mt-4 max-w-xl text-balance text-base text-slate-400 sm:text-lg">
            O plano por assinatura que vai turbinar sua experiência no
            NaveSpeak. Estamos preparando os benefícios - fique de olho.
          </p>
        </div>

        {/* Área de benefícios - conteúdo real ainda por definir, cards
        placeholder só marcam o espaço reservado no layout. */}
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PLACEHOLDER_BENEFITS.map((n) => (
            <div
              key={n}
              className="flex items-center gap-4 rounded-2xl border border-dashed border-purple-400/25 bg-purple-500/5 px-5 py-4"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-300">
                <Sparkles className="size-5" />
              </span>
              <span className="text-sm text-slate-500">
                Benefício em definição
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
