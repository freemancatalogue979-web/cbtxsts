/**
 * Arena mascots — original animated companions (no licensed characters).
 *
 * Three hand-drawn SVG characters whose arms, bodies and faces are rigged with
 * CSS keyframes (see the mascot block in index.css). A mood drives the pose:
 * idle bob, cheer bounce with waving arms, sad droop, thinking tilt, or a win
 * dance. They react to answers, duels and celebrations so the arena feels
 * inhabited rather than static.
 */
import type {MascotName} from '../lib/prefs';

export type MascotMood = 'idle' | 'cheer' | 'sad' | 'think' | 'dance';

function Mouth({mood, y, className = ''}: {mood: MascotMood; y: number; className?: string}) {
  const stroke = 'stroke-ink-950';
  if (mood === 'sad') return <path d={`M28 ${y + 3} Q32 ${y - 1} 36 ${y + 3}`} className={`${stroke} ${className}`} strokeWidth="1.8" strokeLinecap="round" fill="none" />;
  if (mood === 'cheer' || mood === 'dance')
    return <path d={`M27 ${y} Q32 ${y + 6} 37 ${y} Z`} className={`fill-ink-950 ${className}`} strokeWidth="0" />;
  if (mood === 'think') return <path d={`M29 ${y + 1} L35 ${y + 1}`} className={`${stroke} ${className}`} strokeWidth="1.8" strokeLinecap="round" />;
  return <path d={`M28 ${y} Q32 ${y + 3.5} 36 ${y}`} className={`${stroke} ${className}`} strokeWidth="1.8" strokeLinecap="round" fill="none" />;
}

function Bolt({mood}: {mood: MascotMood}) {
  return (
    <>
      <g className="m-body">
        {/* headband tails */}
        <path d="M40 15 L47 13 L44 17 L48 18 L41 19 Z" className="fill-gold-400" />
        <circle cx="32" cy="17" r="8.6" className="fill-mist-50" />
        <rect x="23.4" y="12.6" width="17.2" height="3.4" rx="1.7" className="fill-flare-500" />
        <path d="M31.4 13 l-1.6 2.6 h1.5 l-1 2.2 2.6-2.8 h-1.5 l1.2-2 Z" className="fill-gold-300" />
        <circle cx="29" cy="19.4" r="1.15" className="m-eye fill-ink-950" />
        <circle cx="35" cy="19.4" r="1.15" className="m-eye fill-ink-950" />
        <Mouth mood={mood} y={22.4} />
        {/* body */}
        <path d="M32 25.6 V43" className="stroke-mist-50" strokeWidth="3" strokeLinecap="round" />
        <g className="m-arm-l" style={{transformOrigin: '32px 30px'}}>
          <path d="M32 30 L23 38" className="stroke-mist-50" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g className="m-arm-r" style={{transformOrigin: '32px 30px'}}>
          <path d="M32 30 L41 38" className="stroke-mist-50" strokeWidth="3" strokeLinecap="round" />
        </g>
        <path d="M32 43 L26 55 M32 43 L38 55" className="stroke-mist-50" strokeWidth="3" strokeLinecap="round" fill="none" />
      </g>
    </>
  );
}

function Pixel({mood}: {mood: MascotMood}) {
  return (
    <g className="m-body">
      <path d="M32 8 V5" className="stroke-nova-400" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="4" r="1.8" className="fill-nova-400" />
      <rect x="22" y="8" width="20" height="15" rx="4.5" className="fill-pulse-500" />
      <rect x="25" y="12" width="14" height="8" rx="2.5" className="fill-ink-950" />
      <rect x="27.4" y="14.2" width="2.6" height="3.6" rx="1.2" className="m-eye fill-mint-300" />
      <rect x="34" y="14.2" width="2.6" height="3.6" rx="1.2" className="m-eye fill-mint-300" />
      {mood === 'sad' ? (
        <path d="M29 20.6 Q32 18.6 35 20.6" className="stroke-mint-300" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M29 19.4 Q32 21.6 35 19.4" className="stroke-mint-300" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      )}
      <rect x="24.5" y="25" width="15" height="13" rx="3.5" className="fill-pulse-600" />
      <rect x="29" y="28.5" width="6" height="4" rx="1.4" className="fill-gold-400" />
      <g className="m-arm-l" style={{transformOrigin: '24.5px 28px'}}>
        <path d="M24.5 28 L18 35" className="stroke-pulse-400" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="m-arm-r" style={{transformOrigin: '39.5px 28px'}}>
        <path d="M39.5 28 L46 35" className="stroke-pulse-400" strokeWidth="3" strokeLinecap="round" />
      </g>
      <path d="M28 38 V48 M36 38 V48" className="stroke-pulse-400" strokeWidth="3" strokeLinecap="round" />
      <rect x="24.5" y="48" width="7" height="3" rx="1.5" className="fill-pulse-400" />
      <rect x="32.5" y="48" width="7" height="3" rx="1.5" className="fill-pulse-400" />
    </g>
  );
}

function Goober({mood}: {mood: MascotMood}) {
  return (
    <g className="m-body m-squish">
      <path
        d="M32 12c10 0 17 8.4 17 19.4 0 10.6-6.4 18.6-17 18.6S15 42 15 31.4C15 20.4 22 12 32 12Z"
        className="fill-mint-400"
      />
      <path d="M22 16.5c2-2.6 5-4.3 8-4.8" className="stroke-mint-300" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="26.5" cy="27" r="2.1" className="m-eye fill-ink-950" />
      <circle cx="37.5" cy="27" r="2.1" className="m-eye fill-ink-950" />
      <Mouth mood={mood} y={33} />
      <g className="m-arm-l" style={{transformOrigin: '16px 33px'}}>
        <ellipse cx="13.5" cy="35" rx="4" ry="2.6" className="fill-mint-500" transform="rotate(-24 13.5 35)" />
      </g>
      <g className="m-arm-r" style={{transformOrigin: '48px 33px'}}>
        <ellipse cx="50.5" cy="35" rx="4" ry="2.6" className="fill-mint-500" transform="rotate(24 50.5 35)" />
      </g>
    </g>
  );
}

export default function Mascot({
  name,
  mood = 'idle',
  size = 64,
  className = '',
}: {
  name: MascotName;
  mood?: MascotMood;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`mascot mascot-${mood} ${className}`}
      role="img"
      aria-label={`${name} the mascot, feeling ${mood}`}
    >
      {name === 'bolt' && <Bolt mood={mood} />}
      {name === 'pixel' && <Pixel mood={mood} />}
      {name === 'goober' && <Goober mood={mood} />}
    </svg>
  );
}
