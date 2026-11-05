/** Offline, original scenery for equipped profile themes. No remote animation dependency. */
import {useEffect, useId, useState, type CSSProperties} from 'react';
import {THEMES} from '../lib/cosmetics';
import {tokenStore} from '../lib/api';
import type {Tier} from '../lib/types';

export function prestigeFor(level: number) {
  // The current progression is capped at 60; never invent a level-100 account.
  if (level >= 60) return {name: 'Transcendent', color: '#67e8f9'};
  if (level >= 50) return {name: 'Mythic', color: '#f0abfc'};
  if (level >= 35) return {name: 'Legendary', color: '#fbbf24'};
  if (level >= 20) return {name: 'Epic', color: '#c4b5fd'};
  if (level >= 10) return {name: 'Rare', color: '#7dd3fc'};
  return {name: 'Rookie', color: '#6ee7b7'};
}

export function OverallRankPlate({tier, level}: {tier: Tier; level: number}) {
  return (
    <div className="profile-rank-plate" data-tier={tier}>
      <span className="profile-rank-gem" aria-hidden="true">◆</span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] opacity-70">Overall rank</p>
        <p className="text-sm font-black capitalize">{tier}</p>
      </div>
      <span className="shrink-0 text-xs font-black">LV {level}</span>
    </div>
  );
}

export const PROFILE_BANNERS = [
  {id: 'auto', name: 'Equipped theme'}, {id: 'space', name: 'Starlit space'},
  {id: 'volcano', name: 'Volcanic dusk'}, {id: 'forest', name: 'Living forest'},
  {id: 'ocean', name: 'Ocean depths'}, {id: 'academy', name: 'Royal academy'},
  {id: 'city', name: 'Neon city'},
];

export default function ProfileScenery({theme, level = 1, banner, motion = true, playerId, hasImage, version = ''}: {
  theme?: string | null; level?: number; banner?: string; motion?: boolean;
  playerId?: number; hasImage?: boolean; version?: string;
}) {
  const id = useId().replace(/:/g, '');
  const imageKey = `${playerId}:${version}`;
  const [image, setImage] = useState<{key: string; url: string} | null>(null);
  useEffect(() => {
    if (!playerId || !hasImage) return;
    const abort = new AbortController();
    let url: string | undefined;
    void fetch(`/api/players/${playerId}/banner`, {headers: {Authorization: `Bearer ${tokenStore.get() || ''}`}, signal: abort.signal})
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({key: imageKey, url});
      }).catch(() => undefined);
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [playerId, hasImage, imageKey]);
  const imageUrl = hasImage && image?.key === imageKey ? image.url : null;
  const name = (banner && banner !== 'auto' ? banner : theme) || (level >= 35 ? 'theme_space' : 'classic');
  const volcano = name.includes('volcano');
  const forest = /jungle|forest|nature/.test(name);
  const ocean = name.includes('ocean');
  const city = /city|futuristic/.test(name);
  const academy = /academy|royal|golden|castle|library|haunted/.test(name);
  const color = (theme && THEMES[theme]?.swatch) || prestigeFor(level).color;
  return (
    <div className="profile-scenery" data-motion={motion ? undefined : 'off'} data-scene={volcano ? 'volcano' : forest ? 'forest' : ocean ? 'ocean' : academy ? 'academy' : city ? 'city' : 'space'} style={{'--scene-accent': color} as CSSProperties} aria-hidden="true">
      {imageUrl && <img className="profile-backdrop-image" src={imageUrl} alt="" />}
      <svg style={imageUrl ? {visibility: 'hidden'} : undefined} viewBox="0 0 640 320" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id={`${id}-sky`} x2="0" y2="1">
            <stop stopColor={volcano ? '#230d25' : forest ? '#062d2a' : '#0b133b'} />
            <stop offset="1" stopColor={color} stopOpacity="0.85" />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop stopColor={volcano ? '#ffab38' : '#d7f5ff'} stopOpacity="0.8" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d="M0 0H640V320H0Z" fill={`url(#${id}-sky)`} />
        <circle cx="485" cy="90" r="150" fill={`url(#${id}-glow)`} />
        {!volcano && !forest && <circle cx="490" cy="74" r="33" fill="#e0f2fe" opacity="0.65" />}
        {Array.from({length: 22}, (_, i) => (
          <circle className="profile-scene-star" key={i} cx={(i * 113 + 17) % 640} cy={(i * 59 + 12) % 220} r={i % 3 === 0 ? 2 : 1} fill={volcano ? '#ffcf85' : '#e0f2fe'} style={{animationDelay: `${i * -0.31}s`}} />
        ))}
        {volcano ? (
          <>
            <path d="M150 320 330 86 390 94 585 320Z" fill="#351a32" />
            <path d="m300 127 30-41 60 8 36 49-44-22-20 68-24-73Z" fill="#ff9740" />
            <path className="profile-scene-lava" d="m362 104-18 79 43 41-14 96" fill="none" stroke="#fb7135" strokeWidth="13" />
            <ellipse cx="355" cy="89" rx="35" ry="9" fill="#ffe2a3" />
          </>
        ) : forest ? (
          <>
            <path d="M0 270Q180 190 350 256T640 220V320H0Z" fill="#043c35" />
            {[25, 98, 172, 410, 505, 590].map((x, i) => <path key={x} d={`M${x} 70 l-55 150 h35 v100 h40 V220 h35Z`} fill={i % 2 ? '#0c6450' : '#082e32'} opacity="0.9" />)}
            <path d="M240 320Q320 200 370 320" fill="#9cae71" opacity="0.3" />
          </>
        ) : ocean ? (
          <>
            <path className="profile-scene-wave" d="M-40 190Q40 140 120 190T280 190T440 190T600 190T760 190V330H-40Z" fill="#2ba9c2" opacity="0.5" />
            <path d="M0 235Q90 185 180 235T360 235T540 235T720 235V320H0Z" fill="#0a405e" />
            <path d="M0 273Q90 232 180 273T360 273T540 273T720 273" fill="none" stroke="#89e2e9" strokeWidth="3" opacity="0.35" />
          </>
        ) : academy || city ? (
          <>
            {[30, 90, 150, 420, 485, 560].map((x, i) => (
              <g key={x}>
                <path d={`M${x} 320V${150 + i % 3 * 25}h45V320Z`} fill={city ? '#133553' : '#251d4f'} />
                <path d={`m${x - 5} ${150 + i % 3 * 25} 27-45 28 45Z`} fill={city ? '#2493ae' : '#6953a7'} />
                <path d={`M${x + 20} ${175 + i % 3 * 25}v45`} stroke="#ffe5a1" strokeWidth="6" opacity="0.6" />
              </g>
            ))}
            <path d="M220 320V210h40V160l60-50 60 50v50h40v110Z" fill="#191e42" />
            <path d="M292 320v-65a28 28 0 0 1 56 0v65" fill={color} opacity="0.55" />
          </>
        ) : (
          <>
            <ellipse className="profile-scene-orbit" cx="460" cy="155" rx="142" ry="34" fill="none" stroke="#b5a1ed" strokeWidth="3" transform="rotate(-20 460 155)" opacity="0.5" />
            <circle cx="460" cy="155" r="57" fill="#8471ca" />
            <path d="M403 155Q460 185 516 155" fill="none" stroke="#b4a2ec" strokeWidth="12" opacity="0.5" />
            <path d="M0 320 95 252 155 284 235 225 350 320Z" fill="#171937" />
          </>
        )}
        <path d="M0 308Q180 280 320 308T640 308V320H0Z" fill="#0c152a" opacity="0.65" />
      </svg>
      <span className="profile-scene-sheen" />
    </div>
  );
}
