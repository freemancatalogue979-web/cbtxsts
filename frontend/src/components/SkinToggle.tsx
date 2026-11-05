/**
 * The day/night switch — one animated toggle, everywhere.
 *
 * A pill with a knob that slides between the sun and the moon: the knob
 * springs across, the emblem turns as it travels, and the page colours
 * crossfade behind it. It sits in the app header and on the public pages, so
 * the skin is never buried in a menu.
 */
import {Moon, Sun} from 'lucide-react';
import {motion} from 'motion/react';
import {useState} from 'react';
import {applySkin, currentSkin, type SkinName} from '../lib/prefs';
import {useIsMobile} from '../lib/responsive';
import {sfx} from '../lib/sfx';

/* A 28px knob inside a 60px track with 4px of padding: 24px of travel.
   Phones get a smaller switch so the top bar keeps its room. */
const FULL = {box: 'h-9 w-[3.75rem]', knob: 'size-7', travel: 24};
const COMPACT = {box: 'h-8 w-12', knob: 'size-6', travel: 16};

export default function SkinToggle({className = ''}: {className?: string}) {
  const [skin, setSkin] = useState<SkinName>(() => currentSkin());
  const compact = useIsMobile();
  const dims = compact ? COMPACT : FULL;
  const day = skin === 'day';
  const label = day ? 'Switch to night mode' : 'Switch to daylight mode';

  const change = () => {
    const next: SkinName = day ? 'night' : 'day';
    applySkin(next);
    setSkin(next);
    sfx.play('tap');
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!day}
      aria-label={label}
      title={label}
      onClick={change}
      data-skin-toggle
      data-mode={day ? 'day' : 'night'}
      className={`skin-toggle relative inline-flex shrink-0 touch-manipulation items-center rounded-full border px-1 ${dims.box} ${className}`}
    >
      {/* the track: a hairline of the other skin bleeding through the edge */}
      <span aria-hidden className="skin-toggle__track absolute inset-0 rounded-full" />
      <motion.span
        aria-hidden
        initial={false}
        animate={{x: day ? 0 : dims.travel}}
        transition={{type: 'spring', stiffness: 520, damping: 34, mass: 0.7}}
        className={`skin-toggle__knob relative z-1 grid place-items-center rounded-full ${dims.knob}`}
      >
        <motion.span
          className="absolute grid place-items-center"
          animate={{rotate: day ? 0 : -180, opacity: day ? 1 : 0, scale: day ? 1 : 0.55}}
          transition={{duration: 0.32, ease: [0.22, 1, 0.36, 1]}}
        >
          <Sun className={compact ? 'size-3.5' : 'size-4'} />
        </motion.span>
        <motion.span
          className="absolute grid place-items-center"
          animate={{rotate: day ? 180 : 0, opacity: day ? 0 : 1, scale: day ? 0.55 : 1}}
          transition={{duration: 0.32, ease: [0.22, 1, 0.36, 1]}}
        >
          <Moon className={compact ? 'size-3.5' : 'size-4'} />
        </motion.span>
      </motion.span>
    </button>
  );
}
