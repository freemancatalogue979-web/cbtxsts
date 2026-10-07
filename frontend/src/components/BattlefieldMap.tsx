/** Tactical Land of Dawn battlefield diagram (blue base bottom-left, red top-right).
 *  Square 0..100 coordinate space; pure SVG so boards scale crisply everywhere. */
export function BattlefieldMap({ className = "", translucent = false }: { className?: string; translucent?: boolean }) {
  const lane = { stroke: "#3a3a48", strokeWidth: 1.6, fill: "none", strokeLinecap: "round" as const };
  const jungle = { fill: "#1c2b22", opacity: translucent ? 0.55 : 0.85 };
  const river = { fill: "#122736", opacity: translucent ? 0.55 : 0.85 };
  return (
    <svg viewBox="0 0 100 100" className={`w-full h-full ${className}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <radialGradient id="bf-base-blue" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#1d3c63" />
          <stop offset="100%" stopColor="#10213a" />
        </radialGradient>
        <radialGradient id="bf-base-red" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#5b1f2d" />
          <stop offset="100%" stopColor="#33101c" />
        </radialGradient>
      </defs>

      {/* terrain */}
      <rect x="0" y="0" width="100" height="100" fill="#10131c" opacity={translucent ? 0.6 : 1} />

      {/* jungle quadrants */}
      <ellipse cx="26" cy="26" rx="17" ry="13" {...jungle} />
      <ellipse cx="74" cy="26" rx="15" ry="12" {...jungle} />
      <ellipse cx="26" cy="74" rx="15" ry="12" {...jungle} />
      <ellipse cx="74" cy="74" rx="17" ry="13" {...jungle} />
      <ellipse cx="50" cy="50" rx="12" ry="10" fill="#15202a" />

      {/* river: anti-diagonal band from top-left to bottom-right */}
      <path d="M 8 -4 C 30 14, 30 26, 44 38 C 56 48, 66 52, 80 62 C 92 70, 100 84, 104 96 L 104 104 L 86 104 C 72 84, 60 74, 44 64 C 30 55, 20 42, 12 30 C 6 21, 1 10, -4 4 Z" {...river} />

      {/* lanes */}
      <path d="M 10 90 L 10 10 L 90 10" {...lane} />            {/* EXP (top-left side for red view) */}
      <path d="M 10 90 L 90 90 L 90 10" {...lane} />            {/* GOLD (bottom-right) */}
      <path d="M 12 88 L 88 12" {...lane} strokeDasharray="3 2" /> {/* MID */}

      {/* turrets (3 per lane per side) */}
      {[
        [10, 60], [10, 40], [10, 20],           // our EXP lane
        [90, 40], [90, 20],                     // our EXP wrap (top edge)
        [60, 90], [40, 90], [20, 90],           // our GOLD lane
        [40, 10], [60, 10], [80, 10],           // enemy EXP (top edge)
        [90, 60], [90, 80],                     // enemy GOLD wrap (right edge)
        [40, 60], [55, 45], [45, 55],           // mid
      ].map(([x, y], i) => (
        <rect key={i} x={x - 1.1} y={y - 1.1} width="2.2" height="2.2" rx="0.4"
          fill="#3d4154" stroke="#585e78" strokeWidth="0.35" transform={`rotate(45 ${x} ${y})`} />
      ))}

      {/* objectives */}
      <circle cx="63" cy="58" r="4.6" fill="#2b1c33" stroke="#7c4dda" strokeWidth="0.8" />
      <text x="63" y="59.4" textAnchor="middle" fontSize="3" fill="#b79df2" fontWeight="700">T</text>
      <text x="63" y="66.5" textAnchor="middle" fontSize="2.6" fill="#8b76bd">TURTLE</text>
      <circle cx="37" cy="42" r="4.6" fill="#2b1c33" stroke="#7c4dda" strokeWidth="0.8" />
      <text x="37" y="43.4" textAnchor="middle" fontSize="3" fill="#b79df2" fontWeight="700">L</text>
      <text x="37" y="50.5" textAnchor="middle" fontSize="2.6" fill="#8b76bd">LORD</text>

      {/* buffs */}
      {[[26, 30], [30, 70], [74, 70], [70, 30]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="2.4" fill={i % 3 === 0 ? "#7c2d3a" : "#3d1f3f"} stroke="#a855f7" strokeWidth="0.5" />
          <text x={x} y={y + 4.8} textAnchor="middle" fontSize="2.4" fill="#a990d6">BUFF</text>
        </g>
      ))}

      {/* bases */}
      <circle cx="10" cy="90" r="9" fill="url(#bf-base-blue)" stroke="#3b82f6" strokeWidth="1" />
      <text x="10" y="91" textAnchor="middle" fontSize="3.4" fill="#9ecdff" fontWeight="800">OUR</text>
      <circle cx="90" cy="10" r="9" fill="url(#bf-base-red)" stroke="#e11d48" strokeWidth="1" />
      <text x="90" y="11" textAnchor="middle" fontSize="3.4" fill="#ffb3c1" fontWeight="800">FOE</text>

      {/* lane labels */}
      <text x="14" y="48" fontSize="3" fill="#6b7280" transform="rotate(-90 14 48)">EXP</text>
      <text x="50" y="94.5" fontSize="3" fill="#6b7280">GOLD</text>
      <text x="46" y="57" fontSize="3" fill="#6b7280" transform="rotate(-45 46 57)">MID</text>
    </svg>
  );
}
