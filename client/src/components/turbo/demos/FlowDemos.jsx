import { Crown, Sparkles, Volume2, Zap } from 'lucide-react';
import Stage from './Stage.jsx';
import { useCycle } from './useCycle.js';

export function BigUploadsDemo() {
  const turbo = useCycle(2, 2600) === 0;
  return (
    <Stage>
      <div className="w-60">
        <p className="mb-2 font-mono text-xs text-slate-300">clip.mp4 · 48 MB</p>
        <div className="relative h-2.5 rounded-full bg-slate-700">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${turbo ? 'w-[96%] bg-fuchsia-400' : 'w-[40%] bg-red-400'}`}
          />
          <div
            className="absolute -top-1 h-4.5 w-0.5 bg-white transition-all duration-1000"
            style={{ left: turbo ? '100%' : '40%' }}
          />
        </div>
        <p className="mt-2 text-right font-mono text-[11px] text-slate-400">max {turbo ? '50 MB' : '20 MB'}</p>
      </div>
    </Stage>
  );
}

const COUNTS = [
  { n: 3200, max: 4000 },
  { n: 2000, max: 2000 },
];

export function LongMessagesDemo() {
  const { n, max } = COUNTS[useCycle(2, 2600)];
  const full = max === 2000;
  return (
    <Stage>
      <div className="w-60 rounded-xl border border-slate-700 bg-[#181a20] p-3">
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-slate-600" />
          <div className="h-2 w-5/6 rounded-full bg-slate-600" />
          <div className="h-2 w-2/3 rounded-full bg-slate-600" />
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-700">
          <div className={`h-full rounded-full transition-all duration-1000 ${full ? 'bg-red-400' : 'bg-fuchsia-400'}`} style={{ width: `${(n / max) * 100}%` }} />
        </div>
        <p className={`mt-1 text-right font-mono text-[11px] ${full ? 'text-red-300' : 'text-fuchsia-200'}`}>{n} / {max}</p>
      </div>
    </Stage>
  );
}

const SOUNDS = ['GG', 'Boom', 'Wow'];

export function PersonalSoundsDemo() {
  const active = useCycle(SOUNDS.length, 1400);
  return (
    <Stage>
      <div className="flex gap-3">
        {SOUNDS.map((name, i) => (
          <div
            key={name}
            className={`flex w-16 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-xs transition ${
              i === active ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100' : 'border-slate-700 bg-slate-800/60 text-slate-300'
            }`}
          >
            <span className="flex h-6 items-end gap-0.5">
              {[0, 1, 2, 3].map((b) => (
                <span key={b} className={`w-1 rounded-full bg-current ${i === active ? 'tl-eq' : 'h-1.5'}`} style={{ animationDelay: `${b * 0.12}s` }} />
              ))}
            </span>
            {name}
          </div>
        ))}
      </div>
    </Stage>
  );
}

export function JoinSoundDemo() {
  const joined = useCycle(2, 2200) === 0;
  return (
    <Stage>
      <div className="relative flex w-56 items-center justify-center">
        <div className="relative">
          {joined && <span className="tl-ripple absolute inset-0 rounded-full border-2 border-fuchsia-400" />}
          {joined && <span className="tl-ripple absolute inset-0 rounded-full border-2 border-fuchsia-400 [animation-delay:-1s]" />}
          <div
            className={`relative size-16 rounded-full bg-linear-to-br from-purple-400 to-fuchsia-500 transition-all duration-700 ${
              joined ? 'translate-x-0 opacity-100' : '-translate-x-24 opacity-0'
            }`}
          />
        </div>
        <Volume2 className="absolute right-2 size-6 text-fuchsia-300" />
      </div>
    </Stage>
  );
}

const PERK_ICONS = [Sparkles, Zap, Crown];

export function ServerPerksDemo() {
  return (
    <Stage>
      <div className="relative flex size-28 items-center justify-center">
        <div className="size-16 rounded-2xl bg-linear-to-br from-purple-500 to-fuchsia-500 shadow-[0_0_30px_rgba(217,70,239,0.45)]" />
        {PERK_ICONS.map((Icon, i) => (
          <Icon
            key={i}
            className="tl-float absolute size-5 text-fuchsia-200"
            style={{ left: `${[2, 78, 40][i]}%`, top: `${[8, 20, 82][i]}%`, animationDelay: `${i * -0.8}s` }}
          />
        ))}
      </div>
    </Stage>
  );
}
