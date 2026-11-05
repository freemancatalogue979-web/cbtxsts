"""The hundred realms.

The season ladder used to stop at twelve ranks with Platinum on top, which is
not much of a ladder. Now every level of a season is its own realm: a name, a
colour, a frame and an emblem, so a player is never "just Platinum" but always
*a* realm — and the badge for that realm is the mark they carry.

Realms 1-40 are forged: ember, iron, gold, platinum — metal you can hold.
From realm 41 (Aurora) the ladder turns mystical, and every badge
past that point glows.

This table is generated from the same source as the client's
``frontend/src/lib/realms.ts``; if you change a name, change both.
"""
from __future__ import annotations

# The first realm past platinum. Everything from here glows.
MYSTICAL_FROM = 41

# How many realms there are — one per season level.
REALM_COUNT = 100

#: The realm table. ``realm`` is the season level the realm sits on.
REALMS: list[dict] = [
    {"realm": 1, "key": "ember", "label": "Ember", "glyph": "medal", "blurb": "The first spark. Everything begins here.", "band": "Ember", "family": "bronze", "shape": "shield", "mystical": False, "deep": "#6f3915", "bright": "#f5a85c"},
    {"realm": 2, "key": "spark", "label": "Spark", "glyph": "shield", "blurb": "Small, bright, and impossible to ignore.", "band": "Ember", "family": "bronze", "shape": "seal", "mystical": False, "deep": "#713c17", "bright": "#f4ad62"},
    {"realm": 3, "key": "tinder", "label": "Tinder", "glyph": "gem", "blurb": "It catches. Barely. It is enough.", "band": "Ember", "family": "bronze", "shape": "kite", "mystical": False, "deep": "#733f19", "bright": "#f3b269"},
    {"realm": 4, "key": "flare", "label": "Flare", "glyph": "star", "blurb": "A short flare in the dark of the arena.", "band": "Ember", "family": "bronze", "shape": "orb", "mystical": False, "deep": "#75421a", "bright": "#f2b76f"},
    {"realm": 5, "key": "cinder", "label": "Cinder", "glyph": "crown", "blurb": "Something still burns under the ash.", "band": "Ember", "family": "bronze", "shape": "rhomb", "mystical": False, "deep": "#77451c", "bright": "#f2bb75"},
    {"realm": 6, "key": "kindling", "label": "Kindling", "glyph": "flame", "blurb": "You gather what the fire left behind.", "band": "Ember", "family": "bronze", "shape": "spire", "mystical": False, "deep": "#78471e", "bright": "#f1bf7b"},
    {"realm": 7, "key": "coal", "label": "Coal", "glyph": "trophy", "blurb": "Pressed dark, and hotter for it.", "band": "Ember", "family": "bronze", "shape": "lotus", "mystical": False, "deep": "#7a4a20", "bright": "#f1c382"},
    {"realm": 8, "key": "pyre", "label": "Pyre", "glyph": "sparkles", "blurb": "The old fires, relit.", "band": "Ember", "family": "bronze", "shape": "astrolabe", "mystical": False, "deep": "#7c4d22", "bright": "#f0c787"},
    {"realm": 9, "key": "flicker", "label": "Flicker", "glyph": "zap", "blurb": "Holding on, barely, beautifully.", "band": "Ember", "family": "bronze", "shape": "blade", "mystical": False, "deep": "#7d5024", "bright": "#f0cb8d"},
    {"realm": 10, "key": "bonfire", "label": "Bonfire", "glyph": "sun", "blurb": "The first summit of the ember ladder.", "band": "Ember", "family": "bronze", "shape": "mandorle", "mystical": False, "deep": "#7f5326", "bright": "#f0ce93"},
    {"realm": 11, "key": "ore", "label": "Ore", "glyph": "award", "blurb": "Raw. Unrefined. Full of promise.", "band": "Iron", "family": "silver", "shape": "shield", "mystical": False, "deep": "#3a4350", "bright": "#bbcbdd"},
    {"realm": 12, "key": "temper", "label": "Temper", "glyph": "medal", "blurb": "Heat, then patience. Then steel.", "band": "Iron", "family": "silver", "shape": "seal", "mystical": False, "deep": "#3b4552", "bright": "#bdcddf"},
    {"realm": 13, "key": "anvil", "label": "Anvil", "glyph": "shield", "blurb": "Everything here has been struck true.", "band": "Iron", "family": "silver", "shape": "kite", "mystical": False, "deep": "#3c4655", "bright": "#bfcfe1"},
    {"realm": 14, "key": "forge", "label": "Forge", "glyph": "gem", "blurb": "The hammer never stops.", "band": "Iron", "family": "silver", "shape": "orb", "mystical": False, "deep": "#3d4757", "bright": "#c1d0e3"},
    {"realm": 15, "key": "steel", "label": "Steel", "glyph": "star", "blurb": "Cool to the touch, hard to break.", "band": "Iron", "family": "silver", "shape": "rhomb", "mystical": False, "deep": "#3e495a", "bright": "#c4d2e5"},
    {"realm": 16, "key": "magnesite", "label": "Magnesite", "glyph": "crown", "blurb": "The ore that remembers the mountain.", "band": "Iron", "family": "silver", "shape": "spire", "mystical": False, "deep": "#3f4a5d", "bright": "#c6d4e7"},
    {"realm": 17, "key": "filings", "label": "Filings", "glyph": "flame", "blurb": "Small shavings of something greater.", "band": "Iron", "family": "silver", "shape": "lotus", "mystical": False, "deep": "#404c5f", "bright": "#c8d6e8"},
    {"realm": 18, "key": "alloy", "label": "Alloy", "glyph": "trophy", "blurb": "Two metals, one strength.", "band": "Iron", "family": "silver", "shape": "astrolabe", "mystical": False, "deep": "#414d62", "bright": "#cbd8ea"},
    {"realm": 19, "key": "quench", "label": "Quench", "glyph": "sparkles", "blurb": "The heat leaves in a breath of steam.", "band": "Iron", "family": "silver", "shape": "blade", "mystical": False, "deep": "#424e64", "bright": "#cddaeb"},
    {"realm": 20, "key": "tempered", "label": "Tempered", "glyph": "zap", "blurb": "Cool, hard, and finally yours.", "band": "Iron", "family": "silver", "shape": "mandorle", "mystical": False, "deep": "#435067", "bright": "#d0dced"},
    {"realm": 21, "key": "assay", "label": "Assay", "glyph": "sun", "blurb": "Purity measured, not assumed.", "band": "Gold", "family": "gold", "shape": "shield", "mystical": False, "deep": "#755510", "bright": "#fbca37"},
    {"realm": 22, "key": "bullion", "label": "Bullion", "glyph": "award", "blurb": "Weight enough to matter.", "band": "Gold", "family": "gold", "shape": "seal", "mystical": False, "deep": "#785811", "bright": "#facd3f"},
    {"realm": 23, "key": "aurum", "label": "Aurum", "glyph": "medal", "blurb": "The golden hour, taken by hand.", "band": "Gold", "family": "gold", "shape": "kite", "mystical": False, "deep": "#7b5b12", "bright": "#fad046"},
    {"realm": 24, "key": "sol", "label": "Sol", "glyph": "shield", "blurb": "The sun, and what it refuses to hide.", "band": "Gold", "family": "gold", "shape": "orb", "mystical": False, "deep": "#7e5f13", "bright": "#fad34e"},
    {"realm": 25, "key": "meridian", "label": "Meridian", "glyph": "gem", "blurb": "The line that measures every voyage.", "band": "Gold", "family": "gold", "shape": "rhomb", "mystical": False, "deep": "#816214", "bright": "#f9d655"},
    {"realm": 26, "key": "auric", "label": "Auric", "glyph": "star", "blurb": "Gold that has been proven.", "band": "Gold", "family": "gold", "shape": "spire", "mystical": False, "deep": "#846515", "bright": "#f9d95d"},
    {"realm": 27, "key": "laurel", "label": "Laurel", "glyph": "crown", "blurb": "Worn for what was survived.", "band": "Gold", "family": "gold", "shape": "lotus", "mystical": False, "deep": "#866917", "bright": "#f9db64"},
    {"realm": 28, "key": "chalice", "label": "Chalice", "glyph": "flame", "blurb": "A cup filled by everyone before you.", "band": "Gold", "family": "gold", "shape": "astrolabe", "mystical": False, "deep": "#896c18", "bright": "#f9de6b"},
    {"realm": 29, "key": "regalia", "label": "Regalia", "glyph": "trophy", "blurb": "Crown, robe and the weight of both.", "band": "Gold", "family": "gold", "shape": "blade", "mystical": False, "deep": "#8c6f19", "bright": "#f9e073"},
    {"realm": 30, "key": "sovereign", "label": "Sovereign", "glyph": "sparkles", "blurb": "Gold that answers to a name.", "band": "Gold", "family": "gold", "shape": "mandorle", "mystical": False, "deep": "#8f731a", "bright": "#f8e27a"},
    {"realm": 31, "key": "pallid", "label": "Pallid", "glyph": "zap", "blurb": "The first pale light of a new metal.", "band": "Platinum", "family": "platinum", "shape": "shield", "mystical": False, "deep": "#175663", "bright": "#59e8f8"},
    {"realm": 32, "key": "argent", "label": "Argent", "glyph": "sun", "blurb": "Silver with the moon in it.", "band": "Platinum", "family": "platinum", "shape": "seal", "mystical": False, "deep": "#195866", "bright": "#5ee7f8"},
    {"realm": 33, "key": "moonlit", "label": "Moonlit", "glyph": "award", "blurb": "Cold light, sharp edges.", "band": "Platinum", "family": "platinum", "shape": "kite", "mystical": False, "deep": "#1a5a69", "bright": "#63e6f7"},
    {"realm": 34, "key": "halo", "label": "Halo", "glyph": "medal", "blurb": "A ring of light around the name.", "band": "Platinum", "family": "platinum", "shape": "orb", "mystical": False, "deep": "#1b5c6b", "bright": "#68e5f7"},
    {"realm": 35, "key": "rhodium", "label": "Rhodium", "glyph": "shield", "blurb": "Rare, hard, and very hard to see.", "band": "Platinum", "family": "platinum", "shape": "rhomb", "mystical": False, "deep": "#1d5d6e", "bright": "#6de4f6"},
    {"realm": 36, "key": "mirror", "label": "Mirror", "glyph": "gem", "blurb": "What you show is what stands behind you.", "band": "Platinum", "family": "platinum", "shape": "spire", "mystical": False, "deep": "#1e5f70", "bright": "#72e3f6"},
    {"realm": 37, "key": "lattice", "label": "Lattice", "glyph": "star", "blurb": "Strength held in a perfect grid.", "band": "Platinum", "family": "platinum", "shape": "lotus", "mystical": False, "deep": "#206073", "bright": "#76e3f6"},
    {"realm": 38, "key": "zephyr", "label": "Zephyr", "glyph": "crown", "blurb": "Light enough to carry everything.", "band": "Platinum", "family": "platinum", "shape": "astrolabe", "mystical": False, "deep": "#216276", "bright": "#7be2f5"},
    {"realm": 39, "key": "zenith", "label": "Zenith", "glyph": "flame", "blurb": "The highest point of the pale ladder.", "band": "Platinum", "family": "platinum", "shape": "blade", "mystical": False, "deep": "#236378", "bright": "#80e2f5"},
    {"realm": 40, "key": "polaris", "label": "Polaris", "glyph": "trophy", "blurb": "Fixed. Certain. The way home.", "band": "Platinum", "family": "platinum", "shape": "mandorle", "mystical": False, "deep": "#25647a", "bright": "#85e1f5"},
    {"realm": 41, "key": "aurora", "label": "Aurora", "glyph": "sparkles", "blurb": "The sky begins to speak in colour.", "band": "Astral", "family": "astral", "shape": "shield", "mystical": True, "deep": "#3d155b", "bright": "#b762f8"},
    {"realm": 42, "key": "nebula", "label": "Nebula", "glyph": "gem", "blurb": "A cloud that happens to be a birthplace.", "band": "Astral", "family": "astral", "shape": "seal", "mystical": True, "deep": "#3c165d", "bright": "#b566f9"},
    {"realm": 43, "key": "comet", "label": "Comet", "glyph": "star", "blurb": "Bright for a moment. Eternal for a while.", "band": "Astral", "family": "astral", "shape": "kite", "mystical": True, "deep": "#3c165f", "bright": "#b369f9"},
    {"realm": 44, "key": "aether", "label": "Aether", "glyph": "crown", "blurb": "The thin air above everything.", "band": "Astral", "family": "astral", "shape": "orb", "mystical": True, "deep": "#3b1761", "bright": "#b16df9"},
    {"realm": 45, "key": "pulsar", "label": "Pulsar", "glyph": "sun", "blurb": "A heartbeat in deep space.", "band": "Astral", "family": "astral", "shape": "rhomb", "mystical": True, "deep": "#3a1763", "bright": "#b070f9"},
    {"realm": 46, "key": "halcyon", "label": "Halcyon", "glyph": "zap", "blurb": "The calm after the storm of stars.", "band": "Astral", "family": "astral", "shape": "spire", "mystical": True, "deep": "#3a1865", "bright": "#ae73f9"},
    {"realm": 47, "key": "spectra", "label": "Spectra", "glyph": "flame", "blurb": "Light split into everything it was.", "band": "Astral", "family": "astral", "shape": "lotus", "mystical": True, "deep": "#391867", "bright": "#ad77f9"},
    {"realm": 48, "key": "lumen", "label": "Lumen", "glyph": "award", "blurb": "Light given a name.", "band": "Astral", "family": "astral", "shape": "astrolabe", "mystical": True, "deep": "#381969", "bright": "#ab7af9"},
    {"realm": 49, "key": "quasar", "label": "Quasar", "glyph": "trophy", "blurb": "Bright enough to rearrange the sky.", "band": "Astral", "family": "astral", "shape": "blade", "mystical": True, "deep": "#37196b", "bright": "#aa7efa"},
    {"realm": 50, "key": "zodiac", "label": "Zodiac", "glyph": "shield", "blurb": "The realm where the realms are written.", "band": "Astral", "family": "astral", "shape": "mandorle", "mystical": True, "deep": "#361a6d", "bright": "#a981fa"},
    {"realm": 51, "key": "umbra", "label": "Umbra", "glyph": "sparkles", "blurb": "The shadow the light leaves behind.", "band": "Umbra", "family": "umbra", "shape": "shield", "mystical": True, "deep": "#2b155b", "bright": "#9162f8"},
    {"realm": 52, "key": "eclipse", "label": "Eclipse", "glyph": "gem", "blurb": "Something vast passing in front.", "band": "Umbra", "family": "umbra", "shape": "seal", "mystical": True, "deep": "#2a165d", "bright": "#8f66f9"},
    {"realm": 53, "key": "penumbra", "label": "Penumbra", "glyph": "star", "blurb": "Neither dark nor light. Something else.", "band": "Umbra", "family": "umbra", "shape": "kite", "mystical": True, "deep": "#29165f", "bright": "#8e69f9"},
    {"realm": 54, "key": "occult", "label": "Occult", "glyph": "crown", "blurb": "Hidden, and hiding nothing.", "band": "Umbra", "family": "umbra", "shape": "orb", "mystical": True, "deep": "#281761", "bright": "#8d6df9"},
    {"realm": 55, "key": "void", "label": "Void", "glyph": "sun", "blurb": "The space between the stars.", "band": "Umbra", "family": "umbra", "shape": "rhomb", "mystical": True, "deep": "#271763", "bright": "#8c70f9"},
    {"realm": 56, "key": "maw", "label": "Maw", "glyph": "zap", "blurb": "It opens. It is already too late.", "band": "Umbra", "family": "umbra", "shape": "spire", "mystical": True, "deep": "#261865", "bright": "#8b73f9"},
    {"realm": 57, "key": "silence", "label": "Silence", "glyph": "flame", "blurb": "Loud enough to be heard.", "band": "Umbra", "family": "umbra", "shape": "lotus", "mystical": True, "deep": "#241867", "bright": "#8b77f9"},
    {"realm": 58, "key": "obsidian", "label": "Obsidian", "glyph": "award", "blurb": "Glass made from volcanic grief.", "band": "Umbra", "family": "umbra", "shape": "astrolabe", "mystical": True, "deep": "#231969", "bright": "#8b7af9"},
    {"realm": 59, "key": "entropy", "label": "Entropy", "glyph": "trophy", "blurb": "Everything here is quietly unravelling.", "band": "Umbra", "family": "umbra", "shape": "blade", "mystical": True, "deep": "#22196b", "bright": "#8a7efa"},
    {"realm": 60, "key": "nadir", "label": "Nadir", "glyph": "shield", "blurb": "The lowest point, which is still a foundation.", "band": "Umbra", "family": "umbra", "shape": "mandorle", "mystical": True, "deep": "#201a6d", "bright": "#8a81fa"},
    {"realm": 61, "key": "cherub", "label": "Cherub", "glyph": "sparkles", "blurb": "Something small and winged keeps watch.", "band": "Seraphim", "family": "seraphim", "shape": "shield", "mystical": True, "deep": "#19155b", "bright": "#6a62f8"},
    {"realm": 62, "key": "seraph", "label": "Seraph", "glyph": "gem", "blurb": "Burned clean, and given a voice.", "band": "Seraphim", "family": "seraphim", "shape": "seal", "mystical": True, "deep": "#18165d", "bright": "#6966f9"},
    {"realm": 63, "key": "dominion", "label": "Dominion", "glyph": "star", "blurb": "Authority, worn quietly.", "band": "Seraphim", "family": "seraphim", "shape": "kite", "mystical": True, "deep": "#16165f", "bright": "#6969f9"},
    {"realm": 64, "key": "archon", "label": "Archon", "glyph": "crown", "blurb": "The first rule, before there were rules.", "band": "Seraphim", "family": "seraphim", "shape": "orb", "mystical": True, "deep": "#171961", "bright": "#6d70f9"},
    {"realm": 65, "key": "empyrean", "label": "Empyrean", "glyph": "sun", "blurb": "The open sky, made into a throne.", "band": "Seraphim", "family": "seraphim", "shape": "rhomb", "mystical": True, "deep": "#171b63", "bright": "#7077f9"},
    {"realm": 66, "key": "pantheon", "label": "Pantheon", "glyph": "zap", "blurb": "Every name, standing together.", "band": "Seraphim", "family": "seraphim", "shape": "spire", "mystical": True, "deep": "#181e65", "bright": "#737ef9"},
    {"realm": 67, "key": "olympian", "label": "Olympian", "glyph": "flame", "blurb": "Above the crowd, not apart from it.", "band": "Seraphim", "family": "seraphim", "shape": "lotus", "mystical": True, "deep": "#182167", "bright": "#7785f9"},
    {"realm": 68, "key": "oracle", "label": "Oracle", "glyph": "award", "blurb": "The answer is given before it is asked.", "band": "Seraphim", "family": "seraphim", "shape": "astrolabe", "mystical": True, "deep": "#192369", "bright": "#7a8bf9"},
    {"realm": 69, "key": "apostle", "label": "Apostle", "glyph": "trophy", "blurb": "The first to carry the word out.", "band": "Seraphim", "family": "seraphim", "shape": "blade", "mystical": True, "deep": "#19266b", "bright": "#7e91fa"},
    {"realm": 70, "key": "apotheosis", "label": "Apotheosis", "glyph": "shield", "blurb": "Mortal, and then no longer.", "band": "Seraphim", "family": "seraphim", "shape": "mandorle", "mystical": True, "deep": "#1a296d", "bright": "#8197fa"},
    {"realm": 71, "key": "magma", "label": "Magma", "glyph": "sparkles", "blurb": "The earth, unedited.", "band": "Elemental", "family": "elemental", "shape": "shield", "mystical": True, "deep": "#15245b", "bright": "#6282f8"},
    {"realm": 72, "key": "tide", "label": "Tide", "glyph": "gem", "blurb": "What arrives is never what left.", "band": "Elemental", "family": "elemental", "shape": "seal", "mystical": True, "deep": "#16265d", "bright": "#6688f9"},
    {"realm": 73, "key": "gale", "label": "Gale", "glyph": "star", "blurb": "A force that argues with everything.", "band": "Elemental", "family": "elemental", "shape": "kite", "mystical": True, "deep": "#16295f", "bright": "#698ff9"},
    {"realm": 74, "key": "strata", "label": "Strata", "glyph": "crown", "blurb": "Layer upon layer of older worlds.", "band": "Elemental", "family": "elemental", "shape": "orb", "mystical": True, "deep": "#172c61", "bright": "#6d95f9"},
    {"realm": 75, "key": "squall", "label": "Squall", "glyph": "sun", "blurb": "A sky that changes its mind.", "band": "Elemental", "family": "elemental", "shape": "rhomb", "mystical": True, "deep": "#172f63", "bright": "#709bf9"},
    {"realm": 76, "key": "basalt", "label": "Basalt", "glyph": "zap", "blurb": "Stone that waited to become a shape.", "band": "Elemental", "family": "elemental", "shape": "spire", "mystical": True, "deep": "#183265", "bright": "#73a1f9"},
    {"realm": 77, "key": "crystal", "label": "Crystal", "glyph": "flame", "blurb": "Clear enough to see the truth in.", "band": "Elemental", "family": "elemental", "shape": "lotus", "mystical": True, "deep": "#183567", "bright": "#77a6f9"},
    {"realm": 78, "key": "fulgur", "label": "Fulgur", "glyph": "award", "blurb": "The sky, struck.", "band": "Elemental", "family": "elemental", "shape": "astrolabe", "mystical": True, "deep": "#193869", "bright": "#7aacf9"},
    {"realm": 79, "key": "torrent", "label": "Torrent", "glyph": "trophy", "blurb": "Water with no interest in banks.", "band": "Elemental", "family": "elemental", "shape": "blade", "mystical": True, "deep": "#193b6b", "bright": "#7eb1fa"},
    {"realm": 80, "key": "terra", "label": "Terra", "glyph": "shield", "blurb": "The ground that holds everything up.", "band": "Elemental", "family": "elemental", "shape": "mandorle", "mystical": True, "deep": "#1a3f6d", "bright": "#81b6fa"},
    {"realm": 81, "key": "genesis", "label": "Genesis", "glyph": "sparkles", "blurb": "The word that starts the book.", "band": "Primordial", "family": "primordial", "shape": "shield", "mystical": True, "deep": "#5b4415", "bright": "#f8c662"},
    {"realm": 82, "key": "logos", "label": "Logos", "glyph": "gem", "blurb": "Reason, and the order it finds.", "band": "Primordial", "family": "primordial", "shape": "seal", "mystical": True, "deep": "#5d4c16", "bright": "#f9d566"},
    {"realm": 83, "key": "alpha", "label": "Alpha", "glyph": "star", "blurb": "The first letter. The first principle.", "band": "Primordial", "family": "primordial", "shape": "kite", "mystical": True, "deep": "#5f5416", "bright": "#f9e369"},
    {"realm": 84, "key": "omega", "label": "Omega", "glyph": "crown", "blurb": "The last letter, and the return.", "band": "Primordial", "family": "primordial", "shape": "orb", "mystical": True, "deep": "#615d17", "bright": "#f9f16d"},
    {"realm": 85, "key": "thalassa", "label": "Thalassa", "glyph": "sun", "blurb": "The deep that answers with its own name.", "band": "Primordial", "family": "primordial", "shape": "rhomb", "mystical": True, "deep": "#616317", "bright": "#f4f970"},
    {"realm": 86, "key": "erebus", "label": "Erebus", "glyph": "zap", "blurb": "Darkness before darkness had a name.", "band": "Primordial", "family": "primordial", "shape": "spire", "mystical": True, "deep": "#5c6518", "bright": "#e8f973"},
    {"realm": 87, "key": "nyx", "label": "Nyx", "glyph": "flame", "blurb": "Night, as a witness.", "band": "Primordial", "family": "primordial", "shape": "lotus", "mystical": True, "deep": "#566718", "bright": "#ddf977"},
    {"realm": 88, "key": "chaos", "label": "Chaos", "glyph": "award", "blurb": "Everything, still undecided.", "band": "Primordial", "family": "primordial", "shape": "astrolabe", "mystical": True, "deep": "#506919", "bright": "#d2f97a"},
    {"realm": 89, "key": "anima", "label": "Anima", "glyph": "trophy", "blurb": "The breath inside the armour.", "band": "Primordial", "family": "primordial", "shape": "blade", "mystical": True, "deep": "#4b6b19", "bright": "#c8fa7e"},
    {"realm": 90, "key": "demiurge", "label": "Demiurge", "glyph": "shield", "blurb": "The craftsman behind the pattern.", "band": "Primordial", "family": "primordial", "shape": "mandorle", "mystical": True, "deep": "#446d1a", "bright": "#befa81"},
    {"realm": 91, "key": "astral_sovereign", "label": "Astral Sovereign", "glyph": "sparkles", "blurb": "The realm that watches the realms.", "band": "Absolute", "family": "absolute", "shape": "shield", "mystical": True, "deep": "#826517", "bright": "#ffe58f"},
    {"realm": 92, "key": "titan", "label": "Titan", "glyph": "gem", "blurb": "Old, enormous, and awake.", "band": "Absolute", "family": "absolute", "shape": "seal", "mystical": True, "deep": "#856817", "bright": "#ffe692"},
    {"realm": 93, "key": "overmind", "label": "Overmind", "glyph": "star", "blurb": "A single thought holding a body.", "band": "Absolute", "family": "absolute", "shape": "kite", "mystical": True, "deep": "#876b18", "bright": "#ffe895"},
    {"realm": 94, "key": "singularity", "label": "Singularity", "glyph": "crown", "blurb": "One point, and no way back out.", "band": "Absolute", "family": "absolute", "shape": "orb", "mystical": True, "deep": "#8a6d18", "bright": "#ffe998"},
    {"realm": 95, "key": "infinity", "label": "Infinity", "glyph": "sun", "blurb": "The number that never runs out.", "band": "Absolute", "family": "absolute", "shape": "rhomb", "mystical": True, "deep": "#8c7019", "bright": "#ffea9b"},
    {"realm": 96, "key": "eternity", "label": "Eternity", "glyph": "zap", "blurb": "Time, folded until it is quiet.", "band": "Absolute", "family": "absolute", "shape": "spire", "mystical": True, "deep": "#8f7319", "bright": "#ffec9e"},
    {"realm": 97, "key": "immortal", "label": "Immortal", "glyph": "flame", "blurb": "Cannot be ended. Tries anyway.", "band": "Absolute", "family": "absolute", "shape": "lotus", "mystical": True, "deep": "#92751a", "bright": "#ffeda1"},
    {"realm": 98, "key": "transcendent", "label": "Transcendent", "glyph": "award", "blurb": "Above the ladder. Still climbing.", "band": "Absolute", "family": "absolute", "shape": "astrolabe", "mystical": True, "deep": "#94781a", "bright": "#ffeea4"},
    {"realm": 99, "key": "absolute", "label": "The Absolute", "glyph": "trophy", "blurb": "Nothing left to want.", "band": "Absolute", "family": "absolute", "shape": "blade", "mystical": True, "deep": "#977b1b", "bright": "#ffefa7"},
    {"realm": 100, "key": "absolute_genesis", "label": "Absolute Genesis", "glyph": "shield", "blurb": "The beginning that begins again.", "band": "Absolute", "family": "absolute", "shape": "mandorle", "mystical": True, "deep": "#997d1b", "bright": "#fff0aa"},]

REALM_BY_KEY = {row["key"]: row for row in REALMS}


def realm_for_level(level: int) -> dict:
    """The realm that sits on a given season level (1-100)."""
    level = max(1, min(REALM_COUNT, int(level or 1)))
    return REALMS[level - 1]


def realm_by_key(key: str) -> dict | None:
    """The realm with a given key, if there is one."""
    return REALM_BY_KEY.get(key)
