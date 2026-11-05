/** Original bevelled vector rank art. Colours and tier stay server-owned. */
import {useId} from 'react';
import {Crown, Gem, Shield, Star} from 'lucide-react';
import type {Tier} from '../lib/types';

const METALS = {
  bronze: {light:'#ffe1b0', metal:'#ce8b55', deep:'#563322', core:'#472c29', Icon:Shield, stars:1},
  silver: {light:'#f2f8ff', metal:'#b6cce3', deep:'#455974', core:'#24334c', Icon:Star, stars:2},
  gold: {light:'#fff4ba', metal:'#efbf54', deep:'#81531b', core:'#4c351b', Icon:Crown, stars:3},
  platinum: {light:'#e4ffff', metal:'#80e2ef', deep:'#34768a', core:'#162f4e', Icon:Gem, stars:3},
} as const;

export default function RankCrest({tier, className = ''}: {tier: Tier; className?: string}) {
  const id = `crest-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  const metal = METALS[tier] || METALS.bronze;
  const Icon = metal.Icon;
  return (
    <svg className={`rank-crest ${className}`} viewBox="0 0 144 152" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2=".9" y2="1">
          <stop stopColor={metal.light}/><stop offset=".25" stopColor={metal.metal}/><stop offset=".47" stopColor={metal.light}/><stop offset=".52" stopColor={metal.metal}/><stop offset="1" stopColor={metal.deep}/>
        </linearGradient>
        <linearGradient id={`${id}-core`} x2="0" y2="1"><stop stopColor={metal.core}/><stop offset="1" stopColor="#0b1024"/></linearGradient>
        <radialGradient id={`${id}-glow`}><stop stopColor={metal.light} stopOpacity=".32"/><stop offset="1" stopColor={metal.metal} stopOpacity="0"/></radialGradient>
      </defs>
      <circle cx="72" cy="74" r="65" fill={`url(#${id}-glow)`}/>
      <g fill={`url(#${id}-metal)`} stroke={metal.deep} strokeWidth="1.2" strokeLinejoin="round">
        <path d="M46 50 9 35l11 27 20 12-26-9 10 22 20 10-23-3 13 19 20 5 11-24Z"/>
        <path d="m98 50 37-15-11 27-20 12 26-9-10 22-20 10 23-3-13 19-20 5-11-24Z"/>
        <path d="m47 29 5-15 13 10 7-18 7 18 13-10 5 15-6 13H53Z"/>
        <path d="m72 28 42 17-6 54q-7 25-36 44-29-19-36-44l-6-54Z"/>
      </g>
      <path d="m72 37 32 13-5 45q-5 21-27 37-22-16-27-37l-5-45Z" fill={`url(#${id}-core)`} stroke={metal.light} strokeWidth="1.2"/>
      <path d="M43 51 72 39l29 12-4 33-25-17-25 17Z" fill={metal.light} opacity=".08"/>
      <path d="m72 44 25 10-4 38q-3 18-21 32-18-14-21-32l-4-38Z" fill="none" stroke={metal.metal} strokeWidth=".8" opacity=".65"/>
      <circle cx="72" cy="77" r="22" fill={metal.deep} stroke={metal.metal} strokeWidth="1.5"/>
      <circle cx="72" cy="76" r="18" fill={`url(#${id}-core)`} stroke={metal.light} strokeWidth=".5"/>
      <Icon x="59" y="62" width="26" height="26" color={metal.light} strokeWidth="1.65"/>
      <path d="m42 111 30 14 30-14-5 17-25 13-25-13Z" fill={`url(#${id}-metal)`} stroke={metal.deep}/>
      {Array.from({length:metal.stars},(_,i)=>{
        const x=72+(i-(metal.stars-1)/2)*12;
        return <path key={i} d={`m${x} 111 1.5 3.3 3.6.4-2.7 2.4.7 3.5-3.1-1.8-3.1 1.8.7-3.5-2.7-2.4 3.6-.4Z`} fill={metal.light}/>;
      })}
      <path d="m37 47 2 21M46 37l26-10 28 11" fill="none" stroke={metal.light} strokeWidth="1.6" strokeLinecap="round" opacity=".85"/>
      <circle cx="72" cy="27" r="3" fill={metal.light}/>
    </svg>
  );
}
