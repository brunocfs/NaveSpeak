import { Ghost } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Stage from './Stage.jsx';
import { useCycle } from './useCycle.js';

export function HdScreenDemo() {
  const hd = useCycle(2, 2200) === 0;
  return (
    <Stage>
      <div className="w-60">
        <div className="relative h-32 overflow-hidden rounded-xl bg-linear-to-br from-indigo-900 to-purple-900 ring-1 ring-purple-400/30">
          <div className="tl-drift absolute left-4 top-6 size-6 rounded-full bg-fuchsia-400" />
          <div className="tl-drift absolute bottom-5 right-8 size-4 rounded-md bg-cyan-300 [animation-delay:-1s]" />
          <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-fuchsia-200">
            {hd ? '1440p · 60 fps' : '1080p · 30 fps'}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700">
          <div className={`h-full rounded-full bg-fuchsia-400 transition-all duration-1000 ${hd ? 'w-full' : 'w-2/3'}`} />
        </div>
        <p className="mt-1 text-right font-mono text-[11px] text-slate-400">{hd ? '6000 kbps' : '4000 kbps'}</p>
      </div>
    </Stage>
  );
}

export function MediaPopoutDemo() {
  const popped = useCycle(2, 2000) === 0;
  return (
    <Stage>
      <div className="relative h-36 w-64 rounded-xl border border-slate-700 bg-[#181a20]">
        <div className="absolute left-3 top-3 h-20 w-28 rounded-lg border border-dashed border-slate-600" />
        <div
          className={`absolute left-3 top-3 h-20 w-28 rounded-lg bg-linear-to-br from-purple-500 to-fuchsia-500 transition-all duration-700 ${
            popped ? 'translate-x-24 -translate-y-1 scale-110 rotate-3 shadow-2xl ring-2 ring-fuchsia-300' : ''
          }`}
        />
      </div>
    </Stage>
  );
}

const BACKGROUNDS = [
  'from-indigo-500 to-purple-700',
  'from-emerald-400 to-teal-700',
  'from-amber-300 to-rose-500',
  'from-sky-400 to-fuchsia-600',
];

export function ExtraBackgroundsDemo() {
  const i = useCycle(BACKGROUNDS.length, 1500);
  return (
    <Stage>
      <div className="relative h-36 w-56 overflow-hidden rounded-xl ring-1 ring-purple-400/30">
        {BACKGROUNDS.map((bg, n) => (
          <div key={bg} className={`absolute inset-0 bg-linear-to-br ${bg} transition-opacity duration-700 ${n === i ? 'opacity-100' : 'opacity-0'}`} />
        ))}
        <div className="absolute bottom-0 left-1/2 h-14 w-24 -translate-x-1/2 rounded-t-full bg-slate-900/85" />
        <div className="absolute bottom-10 left-1/2 size-12 -translate-x-1/2 rounded-full bg-slate-900/85" />
      </div>
    </Stage>
  );
}

export function GhostVoiceDemo() {
  const { t } = useTranslation();
  const inside = useCycle(2, 2400) === 0;
  const row = 'flex items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-1.5 text-sm text-slate-200';
  return (
    <Stage>
      <div className="w-56 space-y-1.5">
        <div className={row}><span className="size-5 rounded-full bg-emerald-500" />Ana</div>
        <div className={row}><span className="size-5 rounded-full bg-sky-500" />Bruno</div>
        <div className={`overflow-hidden transition-all duration-700 ${inside ? 'max-h-10 opacity-60' : 'max-h-0 opacity-0'}`}>
          <div className={row}>
            <span className="size-5 rounded-full bg-fuchsia-500" />
            {t('turbo.landing.demo.you')}
            <Ghost className="ml-auto size-4 text-fuchsia-300" />
          </div>
        </div>
        <p className="pt-1 text-center text-[11px] text-slate-400">
          {inside ? t('turbo.landing.demo.ghostInside') : t('turbo.landing.demo.ghostOutside')}
        </p>
      </div>
    </Stage>
  );
}
