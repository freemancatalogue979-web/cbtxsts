/**
 * The arena mascot — a cute lavender slime that reacts to what you do.
 *
 * One drawn character in four moods (idle, cheer, sad, celebrate) rather than a
 * pile of unrelated art, so the world has a consistent companion: it breathes
 * while you read a question, cheers when you get one right, droops a little when
 * you don't, and puts on a crown when something big lands.
 *
 * Presentation only. It never knows whether an answer was correct — the screen
 * that owns the server verdict tells it which mood to wear. Under
 * prefers-reduced-motion (or the low-effects profile) the idle bob is dropped so
 * the character is perfectly still.
 */
import idle from '../assets/character/slime-idle.webp';
import idleSmall from '../assets/character/slime-idle@256.webp';
import cheer from '../assets/character/slime-cheer.webp';
import cheerSmall from '../assets/character/slime-cheer@256.webp';
import sad from '../assets/character/slime-sad.webp';
import sadSmall from '../assets/character/slime-sad@256.webp';
import celebrate from '../assets/character/slime-celebrate.webp';
import celebrateSmall from '../assets/character/slime-celebrate@256.webp';

export type CharacterMood = 'idle' | 'cheer' | 'sad' | 'celebrate' | 'think';
export type CharacterTone = 'normal' | 'day' | 'night';

const SPRITES: Record<CharacterMood, {large: string; small: string}> = {
  idle: {large: idle, small: idleSmall},
  think: {large: idle, small: idleSmall},
  cheer: {large: cheer, small: cheerSmall},
  sad: {large: sad, small: sadSmall},
  celebrate: {large: celebrate, small: celebrateSmall},
};

const MOOD_ANIMATION: Record<CharacterMood, string> = {
  idle: 'hero-breathe 3.6s ease-in-out infinite',
  think: 'hero-breathe 4.4s ease-in-out infinite',
  cheer: 'game-bounce 0.75s ease both',
  sad: 'game-shake 0.5s ease both',
  celebrate: 'game-levelup 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both',
};

export default function Character({
  mood = 'idle',
  size = 112,
  className = '',
  /** 'day' adds a soft cream keyline so the sprite reads on bright surfaces. */
  tone = 'normal',
  label,
}: {
  mood?: CharacterMood;
  size?: number;
  className?: string;
  tone?: CharacterTone;
  label?: string;
}) {
  const sprite = SPRITES[mood] ?? SPRITES.idle;
  return (
    <span
      className={`hero-sprite pointer-events-none inline-block shrink-0 select-none ${className}`}
      style={{width: size, height: size * 1.12}}
      data-mood={mood}
      data-tone={tone}
      role="img"
      aria-label={label ?? `Genesis slime, ${mood}`}
    >
      <img
        src={sprite.large}
        srcSet={`${sprite.small} 256w, ${sprite.large} 512w`}
        sizes={`${size}px`}
        alt=""
        draggable={false}
        className="size-full object-contain object-bottom"
        style={{animation: MOOD_ANIMATION[mood] ?? MOOD_ANIMATION.idle, transformOrigin: '50% 90%'}}
      />
    </span>
  );
}
