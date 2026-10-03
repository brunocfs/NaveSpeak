import StyledUsername from '../../StyledUsername.jsx';
import Stage from './Stage.jsx';
import { useCycle } from './useCycle.js';

const NAME_STYLES = [
  { gradient: ['#f0abfc', '#22d3ee'], bold: true, effect: 'shine' },
  { color: '#fbbf24', italic: true, effect: 'pulse' },
  { color: '#34d399', font: 'mono', effect: 'cipher' },
  { gradient: ['#a855f7', '#f43f5e'], bold: true, font: 'display' },
];

export function NameStyleDemo() {
  const i = useCycle(NAME_STYLES.length, 2200);
  return (
    <Stage>
      <StyledUsername username="NaveUser" style={NAME_STYLES[i]} className="text-3xl" />
    </Stage>
  );
}

export function ProfileBannerDemo() {
  const on = useCycle(2, 2200) === 0;
  return (
    <Stage>
      <div className="w-56 overflow-hidden rounded-2xl bg-[#181a20] ring-1 ring-slate-700">
        <div className="relative h-16 bg-slate-700">
          <div
            className={`absolute inset-0 bg-linear-to-r from-fuchsia-500 via-purple-500 to-cyan-400 transition-opacity duration-700 ${on ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
        <div className="relative px-3 pb-3 pt-7">
          <div className="absolute -top-6 left-3 size-12 rounded-full border-2 border-[#181a20] bg-purple-400" />
          <div className="h-2.5 w-24 rounded-full bg-slate-600" />
          <div className="mt-2 h-2 w-32 rounded-full bg-slate-700" />
        </div>
      </div>
    </Stage>
  );
}

export function SpeakingRingDemo() {
  return (
    <Stage>
      <div className="flex flex-col items-center gap-3">
        <div className="tl-ring size-20 rounded-full bg-linear-to-br from-purple-400 to-fuchsia-500" />
        <StyledUsername username="NaveUser" style={{ color: '#e879f9', bold: true }} className="text-sm" />
      </div>
    </Stage>
  );
}

export function AnimatedAvatarDemo() {
  return (
    <Stage>
      <div className="relative">
        <div className="tl-hue size-24 rounded-full bg-[conic-gradient(from_0deg,#f0abfc,#22d3ee,#a855f7,#f0abfc)]" />
        <span className="absolute -bottom-1 -right-2 rounded-md bg-fuchsia-500 px-1.5 py-0.5 text-[11px] font-bold text-white">GIF</span>
      </div>
    </Stage>
  );
}
