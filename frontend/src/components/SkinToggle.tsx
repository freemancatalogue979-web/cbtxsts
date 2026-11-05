/** Compact day/night switch, shared by the public header and account menu. */
import {Moon, Sun} from 'lucide-react';
import {useState} from 'react';
import {applySkin, currentSkin, type SkinName} from '../lib/prefs';
import {IconButton} from './ui';

export default function SkinToggle({className = '', row = false}: {className?: string; row?: boolean}) {
  const [skin, setSkin] = useState<SkinName>(() => currentSkin());
  const next: SkinName = skin === 'day' ? 'night' : 'day';
  const label = `Switch to ${next === 'day' ? 'daylight' : 'night'} mode`;
  const Icon = next === 'day' ? Sun : Moon;
  const change = () => {
    applySkin(next);
    setSkin(next);
  };

  if (row) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={change}
        className={`flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[0.82rem] font-bold text-mist-300 transition-colors hover:bg-white/6 hover:text-mist-50 ${className}`}
      >
        <Icon className="size-4 shrink-0 text-gold-400" />
        <span className="min-w-0 flex-1">{label}</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[0.64rem] font-extrabold text-mist-400">
          {skin === 'day' ? 'Daylight' : 'Night'}
        </span>
      </button>
    );
  }

  return (
    <IconButton label={label} variant="outline" className={className} onClick={change}>
      <Icon className="size-[17px] text-gold-400" />
    </IconButton>
  );
}
