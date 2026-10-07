/** Land of Dawn minimap-style diagram, geometry traced from the official
 *  battlefield render (see /map/game-map.jpg) — matches the in-game minimap
 *  orientation: blue base bottom-left, red top-right, EXP lane left/top edge,
 *  Gold lane bottom/right edge, river and mid lane cutting the map diagonally. */
export function BattlefieldMap({ className = "" }: { className?: string }) {
  const lane = { fill: "#232a3a", stroke: "#3d4457", strokeWidth: 0.5 as const };
  const wall = { stroke: "#171c2a", strokeWidth: 1.1 as const, fill: "none" };
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

      {/* terrain base */}
      <rect x="0" y="0" width="100" height="100" fill="#151a26" />

      {/* jungle vegetation (traced from render) */}
      <ellipse cx="30" cy="26" rx="19" ry="15" fill="#1a2b21" />
      <ellipse cx="70" cy="27" rx="16" ry="14" fill="#1a2b21" />
      <ellipse cx="28" cy="71" rx="15" ry="14" fill="#1a2b21" />
      <ellipse cx="70" cy="73" rx="19" ry="15" fill="#1a2b21" />
      <ellipse cx="50" cy="50" rx="10" ry="8" fill="#15202a" />

      {/* river: S-curved band from top-left mouth to bottom-right mouth */}
      <path d="M -2 4 C 18 12, 26 24, 40 36 C 52 46, 60 52, 74 62 C 88 72, 98 86, 102 100 L 102 102 L 84 102 C 74 84, 62 74, 46 64 C 32 55, 22 44, 14 32 C 8 22, 2 12, -2 10 Z" fill="#1b3040" />
      <path d="M 4 10 C 18 18, 28 30, 42 42 C 54 52, 66 60, 80 70 C 90 78, 96 88, 100 98" fill="none" stroke="#28475c" strokeWidth="1" opacity="0.5" />

      {/* EXP lane (ours: left edge → top edge) */}
      <path d="M 6.5 82 L 6.5 8 L 88 8" {...lane} />
      <path d="M 6.5 82 L 6.5 8 L 88 8" {...wall} strokeDasharray="0 0" opacity="0.6" />

      {/* GOLD lane (ours: bottom edge → right edge) */}
      <path d="M 82 93.5 L 93.5 93.5 L 93.5 12" {...lane} />
      <path d="M 82 93.5 L 93.5 93.5 L 93.5 12" {...wall} opacity="0.6" />

      {/* MID lane */}
      <path d="M 15 86 L 85 15" {...lane} />

      {/* jungle tracks */}
      <path d="M 12 50 L 40 36 M 22 80 L 46 62 M 60 40 L 88 20 M 62 64 L 88 80 M 18 16 L 40 30 M 82 84 L 62 64" stroke="#2c3444" strokeWidth="1.4" fill="none" opacity="0.7" />

      {/* lane turrets: EXP (left/top), GOLD (bottom/right), MID */}
      {[
        [7, 62], [7, 40], [7, 16],            // ours EXP outer→inner
        [28, 7], [58, 7], [82, 8.5],          // enemy EXP
        [70, 93], [42, 93], [18, 93],         // ours GOLD
        [93, 60], [93, 38], [93, 14],         // enemy GOLD
        [25, 68.5], [37.5, 56.5], [50, 44],   // mid (ours side of river… shared lane)
        [75, 31.5], [62.5, 43.5],
      ].map(([x, y], i) => (
        <rect key={i} x={x - 1.1} y={y - 1.1} width="2.2" height="2.2" rx="0.4"
          fill="#3d4154" stroke="#5a6078" strokeWidth="0.35" transform={`rotate(45 ${x} ${y})`} />
      ))}

      {/* objective pits (traced from render: Lord NW of center, Turtle SE toward gold) */}
      <circle cx="38" cy="40" r="4.8" fill="#241a33" stroke="#7c4dda" strokeWidth="0.9" />
      <text x="38" y="41.4" textAnchor="middle" fontSize="3.1" fill="#c4abf2" fontWeight="800">L</text>
      <text x="38" y="48.6" textAnchor="middle" fontSize="2.6" fill="#8b76bd">LORD</text>
      <circle cx="63" cy="60" r="4.8" fill="#1d2f24" stroke="#3ecf8e" strokeWidth="0.9" />
      <text x="63" y="61.4" textAnchor="middle" fontSize="3.1" fill="#9af2cd" fontWeight="800">T</text>
      <text x="63" y="68.6" textAnchor="middle" fontSize="2.6" fill="#6fae92">TURTLE</text>

      {/* buffs: purple (EXP-side) / orange (gold-side) for both teams */}
      <circle cx="29" cy="24" r="2.6" fill="#3d1f4f" stroke="#a855f7" strokeWidth="0.6" />
      <circle cx="71" cy="29" r="2.6" fill="#3d1f4f" stroke="#a855f7" strokeWidth="0.6" />
      <circle cx="71" cy="74" r="2.6" fill="#4f2a1f" stroke="#f78a4d" strokeWidth="0.6" />
      <circle cx="29" cy="73" r="2.6" fill="#4f2a1f" stroke="#f78a4d" strokeWidth="0.6" />
      <text x="29" y="30" textAnchor="middle" fontSize="2.2" fill="#b588d9">BUFF</text>
      <text x="71" y="25" textAnchor="middle" fontSize="2.2" fill="#b588d9">BUFF</text>
      <text x="71" y="80" textAnchor="middle" fontSize="2.2" fill="#d9a988">BUFF</text>
      <text x="29" y="79" textAnchor="middle" fontSize="2.2" fill="#d9a988">BUFF</text>

      {/* small camps */}
      {[[15, 23], [22, 40], [85, 27], [84, 72], [76, 88], [40, 68], [60, 34]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.5" fill="#2c4434" stroke="#477555" strokeWidth="0.4" />
      ))}

      {/* cyclone eye */}
      <circle cx="51" cy="49" r="1.8" fill="#17333f" stroke="#41c9dd" strokeWidth="0.5" opacity="0.9" />

      {/* bases */}
      <circle cx="10" cy="86" r="8.5" fill="url(#bf-base-blue)" stroke="#3b82f6" strokeWidth="1" />
      <text x="10" y="87" textAnchor="middle" fontSize="3.3" fill="#9ecdff" fontWeight="800">OUR</text>
      <circle cx="90" cy="14" r="8.5" fill="url(#bf-base-red)" stroke="#e11d48" strokeWidth="1" />
      <text x="90" y="15" textAnchor="middle" fontSize="3.3" fill="#ffb3c1" fontWeight="800">FOE</text>

      {/* lane labels */}
      <text x="11.5" y="48" fontSize="3" fill="#7b849c" fontWeight="600" transform="rotate(-90 11.5 48)">EXP</text>
      <text x="52" y="97.5" fontSize="3" fill="#7b849c" fontWeight="600">GOLD</text>
      <text x="46" y="58" fontSize="3" fill="#7b849c" fontWeight="600" transform="rotate(-45 46 58)">MID</text>
    </svg>
  );
}
