#!/usr/bin/env python3
"""One-off generator for the hundred realms.

The realm ladder is the season ladder with one realm per level: a hundred
named, coloured, individually drawn badges. The client and the API must agree
on every name, colour and level, so both tables are emitted from this file
rather than hand-written twice.

    python3 tools/gen_realms.py

Writes:
    frontend/src/lib/realms.ts
    backend/app/services/realms.py
"""
from __future__ import annotations

import colorsys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

# --------------------------------------------------------------------------
# the names, in ladder order — one realm per level, 1 to 100
# --------------------------------------------------------------------------
REALMS: list[tuple[str, str]] = [
    # 1-10 · ember (bronze)
    ("Ember", "The first spark. Everything begins here."),
    ("Spark", "Small, bright, and impossible to ignore."),
    ("Tinder", "It catches. Barely. It is enough."),
    ("Flare", "A short flare in the dark of the arena."),
    ("Cinder", "Something still burns under the ash."),
    ("Kindling", "You gather what the fire left behind."),
    ("Coal", "Pressed dark, and hotter for it."),
    ("Pyre", "The old fires, relit."),
    ("Flicker", "Holding on, barely, beautifully."),
    ("Bonfire", "The first summit of the ember ladder."),
    # 11-20 · iron (silver)
    ("Ore", "Raw. Unrefined. Full of promise."),
    ("Temper", "Heat, then patience. Then steel."),
    ("Anvil", "Everything here has been struck true."),
    ("Forge", "The hammer never stops."),
    ("Steel", "Cool to the touch, hard to break."),
    ("Magnesite", "The ore that remembers the mountain."),
    ("Filings", "Small shavings of something greater."),
    ("Alloy", "Two metals, one strength."),
    ("Quench", "The heat leaves in a breath of steam."),
    ("Tempered", "Cool, hard, and finally yours."),
    # 21-30 · gold
    ("Assay", "Purity measured, not assumed."),
    ("Bullion", "Weight enough to matter."),
    ("Aurum", "The golden hour, taken by hand."),
    ("Sol", "The sun, and what it refuses to hide."),
    ("Meridian", "The line that measures every voyage."),
    ("Auric", "Gold that has been proven."),
    ("Laurel", "Worn for what was survived."),
    ("Chalice", "A cup filled by everyone before you."),
    ("Regalia", "Crown, robe and the weight of both."),
    ("Sovereign", "Gold that answers to a name."),
    # 31-40 · platinum
    ("Pallid", "The first pale light of a new metal."),
    ("Argent", "Silver with the moon in it."),
    ("Moonlit", "Cold light, sharp edges."),
    ("Halo", "A ring of light around the name."),
    ("Rhodium", "Rare, hard, and very hard to see."),
    ("Mirror", "What you show is what stands behind you."),
    ("Lattice", "Strength held in a perfect grid."),
    ("Zephyr", "Light enough to carry everything."),
    ("Zenith", "The highest point of the pale ladder."),
    ("Polaris", "Fixed. Certain. The way home."),
    # 41-50 · astral
    ("Aurora", "The sky begins to speak in colour."),
    ("Nebula", "A cloud that happens to be a birthplace."),
    ("Comet", "Bright for a moment. Eternal for a while."),
    ("Aether", "The thin air above everything."),
    ("Pulsar", "A heartbeat in deep space."),
    ("Halcyon", "The calm after the storm of stars."),
    ("Spectra", "Light split into everything it was."),
    ("Lumen", "Light given a name."),
    ("Quasar", "Bright enough to rearrange the sky."),
    ("Zodiac", "The realm where the realms are written."),
    # 51-60 · umbra
    ("Umbra", "The shadow the light leaves behind."),
    ("Eclipse", "Something vast passing in front."),
    ("Penumbra", "Neither dark nor light. Something else."),
    ("Occult", "Hidden, and hiding nothing."),
    ("Void", "The space between the stars."),
    ("Maw", "It opens. It is already too late."),
    ("Silence", "Loud enough to be heard."),
    ("Obsidian", "Glass made from volcanic grief."),
    ("Entropy", "Everything here is quietly unravelling."),
    ("Nadir", "The lowest point, which is still a foundation."),
    # 61-70 · seraphim
    ("Cherub", "Something small and winged keeps watch."),
    ("Seraph", "Burned clean, and given a voice."),
    ("Dominion", "Authority, worn quietly."),
    ("Archon", "The first rule, before there were rules."),
    ("Empyrean", "The open sky, made into a throne."),
    ("Pantheon", "Every name, standing together."),
    ("Olympian", "Above the crowd, not apart from it."),
    ("Oracle", "The answer is given before it is asked."),
    ("Apostle", "The first to carry the word out."),
    ("Apotheosis", "Mortal, and then no longer."),
    # 71-80 · elemental
    ("Magma", "The earth, unedited."),
    ("Tide", "What arrives is never what left."),
    ("Gale", "A force that argues with everything."),
    ("Strata", "Layer upon layer of older worlds."),
    ("Squall", "A sky that changes its mind."),
    ("Basalt", "Stone that waited to become a shape."),
    ("Crystal", "Clear enough to see the truth in."),
    ("Fulgur", "The sky, struck."),
    ("Torrent", "Water with no interest in banks."),
    ("Terra", "The ground that holds everything up."),
    # 81-90 · primordial
    ("Genesis", "The word that starts the book."),
    ("Logos", "Reason, and the order it finds."),
    ("Alpha", "The first letter. The first principle."),
    ("Omega", "The last letter, and the return."),
    ("Thalassa", "The deep that answers with its own name."),
    ("Erebus", "Darkness before darkness had a name."),
    ("Nyx", "Night, as a witness."),
    ("Chaos", "Everything, still undecided."),
    ("Anima", "The breath inside the armour."),
    ("Demiurge", "The craftsman behind the pattern."),
    # 91-100 · absolute
    ("Astral Sovereign", "The realm that watches the realms."),
    ("Titan", "Old, enormous, and awake."),
    ("Overmind", "A single thought holding a body."),
    ("Singularity", "One point, and no way back out."),
    ("Infinity", "The number that never runs out."),
    ("Eternity", "Time, folded until it is quiet."),
    ("Immortal", "Cannot be ended. Tries anyway."),
    ("Transcendent", "Above the ladder. Still climbing."),
    ("The Absolute", "Nothing left to want."),
    ("Absolute Genesis", "The beginning that begins again."),
]

# --------------------------------------------------------------------------
# the frames — the outer silhouette of a realm badge
# --------------------------------------------------------------------------
SHAPES = ["shield", "seal", "kite", "orb", "rhomb", "spire", "lotus", "astrolabe", "blade", "mandorle"]

# The emblems. Material realms lean on the forged marks, mystical ones on the
# celestial ones.
MATERIAL_GLYPHS = ["medal", "shield", "gem", "star", "crown", "flame", "trophy", "sparkles", "zap", "sun", "award"]
MYSTICAL_GLYPHS = ["sparkles", "gem", "star", "crown", "sun", "zap", "flame", "award", "trophy", "shield"]

# The band each realm belongs to — the family of realms it was born into.
BANDS = [
    (1, 10, "Ember", "bronze"),
    (11, 20, "Iron", "silver"),
    (21, 30, "Gold", "gold"),
    (31, 40, "Platinum", "platinum"),
    (41, 50, "Astral", "astral"),
    (51, 60, "Umbra", "umbra"),
    (61, 70, "Seraphim", "seraphim"),
    (71, 80, "Elemental", "elemental"),
    (81, 90, "Primordial", "primordial"),
    (91, 100, "Absolute", "absolute"),
]

# The first realm past platinum. Everything from here glows.
MYSTICAL_FROM = 41


def hsl_to_hex(h: float, s: float, light: float) -> str:
    r, g, b = colorsys.hls_to_rgb(h / 360.0, light / 100.0, s / 100.0)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def slug(name: str) -> str:
    return name.lower().replace("the ", "").replace(" ", "_")


def band_of(realm: int) -> tuple[str, str]:
    for start, end, band, family in BANDS:
        if start <= realm <= end:
            return band, family
    raise ValueError(realm)


def colours(realm: int) -> tuple[str, str]:
    """The realm's own two colours: a deep shadow and a bright highlight."""
    family = band_of(realm)[1]
    step = (realm - 1) % 10  # 0..9 inside the band

    if family == "bronze":
        deep = hsl_to_hex(24 + step * 0.7, 68 - step * 1.6, 26 + step * 0.7)
        bright = hsl_to_hex(30 + step * 0.9, 88 - step * 1.4, 66 + step * 1.1)
    elif family == "silver":
        deep = hsl_to_hex(215 + step * 0.4, 16 + step * 0.6, 27 + step * 0.7)
        bright = hsl_to_hex(212 + step * 0.3, 34 + step * 1.2, 80 + step * 0.8)
    elif family == "gold":
        deep = hsl_to_hex(41 + step * 0.5, 76 - step * 0.8, 26 + step * 0.8)
        bright = hsl_to_hex(45 + step * 0.5, 96 - step * 0.6, 60 + step * 1.4)
    elif family == "platinum":
        deep = hsl_to_hex(190 + step * 0.6, 62 - step * 0.9, 24 + step * 0.8)
        bright = hsl_to_hex(186 + step * 0.5, 92 - step * 0.8, 66 + step * 0.9)
    elif family == "absolute":
        # the summit: near-white gold, the brightest thing in the game
        deep = hsl_to_hex(44 + step * 0.3, 70, 30 + step * 0.6)
        bright = hsl_to_hex(46 + step * 0.4, 100, 78 + step * 0.6)
    else:
        # the mystical sweep: violet -> blue -> cyan -> teal -> jade -> gold
        hue = 274 - (realm - MYSTICAL_FROM) * 1.55
        if hue < 40:
            hue += 360
        if realm > 80:
            hue = 40 + (realm - 81) * 5.5  # the primordial band warms to amber
        if realm > 90:
            hue = 44 + (realm - 91) * 1.2  # the absolute band stays gold
        deep = hsl_to_hex(hue, 62, 22 + step * 0.5)
        bright = hsl_to_hex(hue, 92, 68 + step * 0.7)
    return deep, bright


def build() -> list[dict]:
    rows = []
    for index, (name, blurb) in enumerate(REALMS, start=1):
        band, family = band_of(index)
        deep, bright = colours(index)
        mystical = index >= MYSTICAL_FROM
        glyphs = MYSTICAL_GLYPHS if mystical else MATERIAL_GLYPHS
        rows.append(
            {
                "realm": index,
                "key": slug(name),
                "label": name,
                "glyph": glyphs[(index - 1) % len(glyphs)],
                "blurb": blurb,
                "band": band,
                "family": family,
                "shape": SHAPES[(index - 1) % len(SHAPES)],
                "mystical": mystical,
                "deep": deep,
                "bright": bright,
            }
        )
    return rows


HEADER_TS = """/**
 * The hundred realms.
 *
 * The season ladder used to stop at twelve ranks with Platinum on top, which is
 * not much of a ladder. Now every level of a season is its own realm: a name, a
 * colour, a frame and an emblem, so a player is never "just Platinum" but
 * always *a* realm — and the badge for that realm is the mark they carry.
 *
 * Realms 1-40 are forged: ember, iron, gold, platinum — metal you can hold.
 * From realm 41 (`{mystical_first}`) the ladder turns mystical, and every
 * badge past that point glows.
 *
 * This table is generated from the same source as the API's
 * `backend/app/services/realms.py`; if you change a name, change both.
 */

export type RealmShape =
  | 'shield'
  | 'seal'
  | 'kite'
  | 'orb'
  | 'rhomb'
  | 'spire'
  | 'lotus'
  | 'astrolabe'
  | 'blade'
  | 'mandorle';

export interface Realm {{
  /** 1-100 — the realm number, which is also the season level it sits on. */
  realm: number;
  key: string;
  label: string;
  glyph: string;
  blurb: string;
  /** The family of realms it was born into. */
  band: string;
  family: string;
  /** The outer silhouette of the badge. */
  shape: RealmShape;
  /** True past platinum — these badges glow. */
  mystical: boolean;
  deep: string;
  bright: string;
}}

/** The first realm past platinum. Everything from here glows. */
export const MYSTICAL_FROM = {mystical_from};

/** How many realms there are — one per season level. */
export const REALM_COUNT = {count};

export const REALMS: Realm[] = [
{rows}
];

/** The realm that sits on a given season level (1-100). */
export function realmForLevel(level: number): Realm {{
  const index = Math.max(1, Math.min(REALM_COUNT, Math.floor(level || 1))) - 1;
  return REALMS[index];
}}

/** The realm with a given key, if there is one. */
export function realmByKey(key: string): Realm | undefined {{
  return REALMS.find((realm) => realm.key === key);
}}

/** The highest realm a player has ever stood on. */
export function highestRealm(realms: Realm[]): Realm | undefined {{
  return realms.length ? realms.reduce((top, realm) => (realm.realm > top.realm ? realm : top)) : undefined;
}}

/**
 * Resolve the realm a server payload is talking about.
 *
 * The API sends the realm number, but an older server (or a cached payload)
 * may not, so fall back to the bottom of the rank band and then to the level
 * itself. The art always comes from this table, so a realm badge is the same
 * object wherever it is shown.
 */
export function realmFromRank(rank: {{
  key?: string;
  realm?: number;
  level_from?: number;
  level_to?: number;
}}): Realm {{
  if (typeof rank.realm === 'number' && rank.realm >= 1 && rank.realm <= REALM_COUNT) {{
    return REALMS[rank.realm - 1];
  }}
  const byKey = REALMS.find((realm) => realm.key === rank.key);
  if (byKey) return byKey;
  const level = rank.level_from ?? 1;
  return realmForLevel(level);
}}
"""


def emit_ts(rows: list[dict]) -> str:
    body = ",\n".join(
        "  {{realm: {realm}, key: '{key}', label: '{label}', glyph: '{glyph}', blurb: '{blurb}', "
        "band: '{band}', family: '{family}', shape: '{shape}', mystical: {mystical}, deep: '{deep}', bright: '{bright}'}}".format(
            **{**row, "mystical": "true" if row["mystical"] else "false"}
        )
        for row in rows
    )
    return HEADER_TS.format(
        rows=body,
        count=len(rows),
        mystical_from=MYSTICAL_FROM,
        mystical_first=REALMS[MYSTICAL_FROM - 1][0],
    )


HEADER_PY = '''"""The hundred realms.

The season ladder used to stop at twelve ranks with Platinum on top, which is
not much of a ladder. Now every level of a season is its own realm: a name, a
colour, a frame and an emblem, so a player is never "just Platinum" but always
*a* realm — and the badge for that realm is the mark they carry.

Realms 1-40 are forged: ember, iron, gold, platinum — metal you can hold.
From realm 41 ({mystical_first}) the ladder turns mystical, and every badge
past that point glows.

This table is generated from the same source as the client's
``frontend/src/lib/realms.ts``; if you change a name, change both.
"""
from __future__ import annotations

# The first realm past platinum. Everything from here glows.
MYSTICAL_FROM = {mystical_from}

# How many realms there are — one per season level.
REALM_COUNT = {count}

#: The realm table. ``realm`` is the season level the realm sits on.
REALMS: list[dict] = [
{rows}]

REALM_BY_KEY = {{row["key"]: row for row in REALMS}}


def realm_for_level(level: int) -> dict:
    """The realm that sits on a given season level (1-100)."""
    level = max(1, min(REALM_COUNT, int(level or 1)))
    return REALMS[level - 1]


def realm_by_key(key: str) -> dict | None:
    """The realm with a given key, if there is one."""
    return REALM_BY_KEY.get(key)
'''


def emit_py(rows: list[dict]) -> str:
    body = "\n".join(
        '    {{"realm": {realm}, "key": "{key}", "label": "{label}", "glyph": "{glyph}", '
        '"blurb": "{blurb}", "band": "{band}", "family": "{family}", "shape": "{shape}", '
        '"mystical": {mystical}, "deep": "{deep}", "bright": "{bright}"}},'.format(**row)
        for row in rows
    )
    return HEADER_PY.format(
        rows=body,
        count=len(rows),
        mystical_from=MYSTICAL_FROM,
        mystical_first=REALMS[MYSTICAL_FROM - 1][0],
    )


def main() -> None:
    rows = build()
    assert len(rows) == 100, len(rows)
    assert len({row["key"] for row in rows}) == 100, "realm keys must be unique"
    assert len({row["label"] for row in rows}) == 100, "realm labels must be unique"
    (ROOT / "frontend/src/lib/realms.ts").write_text(emit_ts(rows), encoding="utf-8")
    (ROOT / "backend/app/services/realms.py").write_text(emit_py(rows), encoding="utf-8")
    print(f"wrote {len(rows)} realms")


if __name__ == "__main__":
    main()
