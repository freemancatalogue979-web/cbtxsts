/** Offline, original scenery for equipped profile themes. No remote animation dependency. */
import {useEffect, useId, useState, type CSSProperties} from 'react';
import {THEMES} from '../lib/cosmetics';
import {tokenStore} from '../lib/api';
import RankCrest from './RankCrest';
import type {Tier} from '../lib/types';
import {TIER_PALETTES, tierLabel} from '../lib/tiers';

export function prestigeFor(level: number) {
  // The current progression is capped at 60; never invent a level-100 account.
  if (level >= 100) return {name: 'Absolute Genesis', color: '#ffd75e'};
  if (level >= 60) return {name: 'Transcendent', color: '#67e8f9'};
  if (level >= 50) return {name: 'Mythic', color: '#f0abfc'};
  if (level >= 35) return {name: 'Legendary', color: '#fbbf24'};
  if (level >= 20) return {name: 'Epic', color: '#c4b5fd'};
  if (level >= 10) return {name: 'Rare', color: '#7dd3fc'};
  return {name: 'Rookie', color: '#6ee7b7'};
}

export function OverallRankPlate({tier, level, playerName, founderNumber}: {
  tier: Tier;
  level: number;
  playerName?: string;
  founderNumber?: number | null;
}) {
  const founder = typeof founderNumber === 'number' && founderNumber >= 1 && founderNumber <= 100;
  return (
    <div className="profile-rank-plate" data-tier={tier} style={{'--rank-metal': TIER_PALETTES[tier]?.bright ?? TIER_PALETTES.bronze.bright} as CSSProperties}>
      <RankCrest tier={tier} playerName={playerName} founderNumber={founderNumber} />
      <div className="profile-rank-copy min-w-0 flex-1">
        <p className="profile-rank-eyebrow">{founder ? `Founder's 100 · #${String(founderNumber).padStart(3, '0')}` : 'Overall rank'}</p>
        <p className="profile-rank-name">{tierLabel(tier)}</p>
        <p className="profile-rank-subtitle">{founder ? 'Your name is carved into the crown forever.' : `Lifetime progression · ${prestigeFor(level).name}`}</p>
      </div>
      <span className="profile-rank-level"><small>LEVEL</small><strong>{level}</strong></span>
    </div>
  );
}

export const PROFILE_BANNERS = [
  {id: 'auto', name: 'Equipped theme'}, {id: 'space', name: 'Starlit space'},
  {id: 'volcano', name: 'Volcanic dusk'}, {id: 'forest', name: 'Living forest'},
  {id: 'ocean', name: 'Ocean depths'}, {id: 'academy', name: 'Royal academy'},
  {id: 'city', name: 'Neon city'},
];

export default function ProfileScenery({theme, level = 1, banner, motion = true, playerId, hasImage, version = '', preview = false}: {
  theme?: string | null; level?: number; banner?: string; motion?: boolean;
  playerId?: number; hasImage?: boolean; version?: string; preview?: boolean;
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
  const scene = volcano ? 'volcano' : forest ? 'forest' : ocean ? 'ocean' : academy ? 'academy' : city ? 'city' : 'space';
  const colors = {space:'#a78bfa', forest:'#34d399', ocean:'#38bdf8', volcano:'#fb923c', academy:'#e8c578', city:'#e879f9'};
  const color = (banner && banner !== 'auto' ? colors[scene] : theme && THEMES[theme]?.swatch) || colors[scene];
  const artSrc = imageUrl || `/profile-scenes/${scene}${preview ? '-thumb' : ''}.webp`;
  const [failedArt, setFailedArt] = useState<string | null>(null);
  const showArt = failedArt !== artSrc;
  return (
    <div className="profile-scenery" data-preview={preview || undefined} data-motion={motion ? undefined : 'off'} data-art={showArt || undefined} data-scene={scene} style={{'--scene-accent': color} as CSSProperties} aria-hidden="true">
      <div className="profile-scene-depth">
        <img key={artSrc} className={imageUrl ? 'profile-scene-art profile-backdrop-image' : 'profile-scene-art'}
          src={artSrc} width="1280" height="640" loading={preview ? 'lazy' : 'eager'} alt="" draggable={false}
          style={showArt ? undefined : {visibility:'hidden'}} onError={() => setFailedArt(artSrc)} />
        {showArt && <>
          <span className="profile-scene-volume" />
          <span className="profile-scene-near" />
          {!imageUrl && <span className="profile-scene-motes">{Array.from({length:8},(_,i)=><i key={i} style={{left:`${8+i*12}%`, top:`${15+(i*19)%67}%`, animationDelay:`${i*-.9}s`}} />)}</span>}
        </>}
      </div>
      <svg style={showArt ? {visibility: 'hidden'} : undefined} viewBox="0 0 640 320" preserveAspectRatio="xMidYMid slice" focusable="false">
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
      {showArt && !preview && <svg className="profile-scene-animation" viewBox="0 0 640 320" preserveAspectRatio="xMidYMid slice" focusable="false">
        <g fill="none" stroke={color} strokeLinecap="round">
          <path className="profile-light-trail" d="M280 270Q600 250 550 40Q450-50 340 150" strokeWidth="1.5" strokeDasharray="35 500" />
          <path className="profile-light-trail profile-light-trail-second" d="M330 310Q650 170 500 80Q390 10 310 170" strokeWidth="1" strokeDasharray="18 420" />
        </g>
        {[0,1,2,3,4,5].map(i=><g className="profile-orb-float" key={i} style={{animationDelay:`${i*-1.2}s`,transformOrigin:`${340+i*43}px ${50+(i*47)%190}px`}}>
          <circle cx={340+i*43} cy={50+(i*47)%190} r={8+i%3*3} fill={color} opacity=".12" />
          <circle cx={340+i*43} cy={50+(i*47)%190} r="2" fill="#fff4db" opacity=".85" />
          <path d={`M${335+i*43} ${50+(i*47)%190}h10m-5-5v10`} stroke="#fff4db" strokeWidth=".6" opacity=".65" />
        </g>)}
      </svg>}
      <span className="profile-scene-sheen" />
    </div>
  );
}
