"""Interactive Land of Dawn map guide data.

Points of interest (timings/rewards) collected from the official MLBB wiki
(mobilelegends.fandom.com), cross-checked 2026-10. Coordinates are on our
0..100 diagram grid (your base bottom-left) and, like mlbbdex's own diagram,
are approximate rather than to scale.
"""

PINS: list[dict] = [
    # -------------------------------------------------- shared objectives
    {
        "id": "turtle", "name": "Turtle", "category": "objective", "side": "shared",
        "x": 63, "y": 60,
        "blurb": "First big team objective. Spawns next to the EXP lane — plan your rotation around it.",
        "facts": [
            ("First spawn", "2:00"),
            ("Respawn", "120 s after death, if killed before 6:00 (max 4 per match)"),
            ("HP", "≈ 10,367"),
            ("Reward", "60 / 70 / 80 gold per hero, team EXP and a 120 s shield; stronger shield + attack buff for the last hitter"),
        ],
        "tips": [
            "Jungler must be level 4 with Retribution ready before 2:00.",
            "EXP + roam should already be moved over before it spawns.",
            "If the setup is lost, back off and trade the opposite side of the map.",
        ],
    },
    {
        "id": "lord", "name": "Lord", "category": "objective", "side": "shared",
        "x": 38, "y": 40,
        "blurb": "The game-closing objective. Once slain it marches down a lane and hammers turrets.",
        "facts": [
            ("First spawn", "8:00"),
            ("Respawn", "180 s after death"),
            ("Reward", "Team gold + EXP, Lord pushes the weakest lane; later Lords hit much harder"),
        ],
        "tips": [
            "Never start it without vision of the enemy jungler — steals flip games.",
            "Close out by marching with it; force fights while it pressures the base.",
        ],
    },
    # -------------------------------------------------- buffs (ours / enemy)
    {
        "id": "purple-ours", "name": "Purple buff (ours)", "category": "buff", "side": "ours",
        "x": 29, "y": 24,
        "blurb": "Thunder Fenrir side buff. Its slow effect powers our jungler's early ganks.",
        "facts": [("First spawn", "0:25"), ("Respawn", "90 s after death"), ("Effect", "Attacks slow the target — chase-down power")],
        "tips": ["Log the death time in your head: +90 s is the return window.", "Give it to the jungler early; marksmen can inherit it later."],
    },
    {
        "id": "orange-ours", "name": "Orange buff (ours)", "category": "buff", "side": "ours",
        "x": 71, "y": 74,
        "blurb": "Molten Fiend side buff on the Gold-lane side. Extra damage on every hit.",
        "facts": [("First spawn", "0:20"), ("Respawn", "90 s after death"), ("Effect", "Bonus true damage / burn on attacks")],
        "tips": ["Usual jungle start: orange 0:20 → purple 0:25 lines you up for a level-4 Gold-side gank.", "Contest it if the enemy jungler shows on the opposite side."],
    },
    {
        "id": "purple-enemy", "name": "Purple buff (enemy)", "category": "buff", "side": "enemy",
        "x": 71, "y": 29,
        "blurb": "Their slow buff. Invade window opens when their jungler crosses mid.",
        "facts": [("First spawn", "0:25"), ("Respawn", "90 s after death")],
        "tips": ["Steal trade: take it only if you concede nothing on our side.", "Count the timer — denying buffs starves assassins."],
    },
    {
        "id": "orange-enemy", "name": "Orange buff (enemy)", "category": "buff", "side": "enemy",
        "x": 29, "y": 73,
        "blurb": "Their damage buff near our EXP side. A common invade target at 0:20.",
        "facts": [("First spawn", "0:20"), ("Respawn", "90 s after death")],
        "tips": ["EXP + roam can scout it at 0:20 — free steal if their jungler starts purple."],
    },
    # -------------------------------------------------- small camps
    {
        "id": "litho-ours", "name": "Lithowanderer", "category": "camp", "side": "river",
        "x": 47, "y": 52,
        "blurb": "River creep near mid finishing at 0:35. Mana regen + river speed for the finisher.",
        "facts": [("First spawn", "0:35"), ("Effect", "Mana regen + movement speed in the river")],
        "tips": ["Mid + roam should race for it — it fuels the level-4 race to 2:00."],
    },
    {
        "id": "crab-top", "name": "Crab (EXP side)", "category": "camp", "side": "river",
        "x": 28, "y": 44,
        "blurb": "Little Crab walks the river near side lanes. Free gold if you zone it correctly.",
        "facts": [("First spawn", "≈ 0:42 (Little Crab)"), ("Reward", "≈ 60 gold trickled over 18 s")],
        "tips": ["Hit it once so it runs to your lane, then last-hit it there safely."],
    },
    {
        "id": "crab-bot", "name": "Crab (Gold side)", "category": "camp", "side": "river",
        "x": 72, "y": 56,
        "blurb": "Gold-side river crab. Marksman + roam should treat it as first-income bonus.",
        "facts": [("First spawn", "≈ 0:42"), ("Reward", "≈ 60 gold over 18 s")],
        "tips": ["Win the wave slow, then take crab — don't fight in river bushes vs roam."],
    },
    {
        "id": "horned-lizard", "name": "Horned Lizard", "category": "camp", "side": "ours",
        "x": 15, "y": 23,
        "blurb": "Small EXP-side jungle camp. Part of the level-4 clear path.",
        "facts": [("Pattern", "Standard small camp — gold + EXP on kill"), ("Respawn", "≈ 90 s")],
        "tips": ["Chain it between buff and Turtle to hit level 4 precisely on time."],
    },
    {
        "id": "fire-beetle", "name": "Fire Beetle", "category": "camp", "side": "ours",
        "x": 84, "y": 74,
        "blurb": "Small Gold-side jungle camp — the bridge between orange buff and gank.",
        "facts": [("Pattern", "Standard small camp"), ("Respawn", "≈ 90 s")],
        "tips": ["Clear on the way down from buff: buff → beetle → gank Gold at level 4."],
    },
    {
        "id": "lava-golem", "name": "Lava Golem", "category": "camp", "side": "ours",
        "x": 40, "y": 68,
        "blurb": "Hardy camp guarding the middle jungle. Worth the time only on full clears.",
        "facts": [("Pattern", "Tanky small camp — higher reward, slower clear"), ("Respawn", "≈ 90 s")],
        "tips": ["Skip on fast pathing; take it when lanes push too far to gank."],
    },
    # -------------------------------------------------- terrain
    {
        "id": "cyclone", "name": "Cyclone Eye", "category": "terrain", "side": "river",
        "x": 51, "y": 49,
        "blurb": "Standing on it launches you across the river. Silent, instant rotation.",
        "facts": [("Active from", "≈ 2:00"), ("Cooldown", "≈ 45 s per use")],
        "tips": ["Dodge skillshots inside it — many ults whiff when you vanish.", "Ping before launching so roam turns your rotation into a play."],
    },
    {
        "id": "turrets", "name": "Turrets", "category": "terrain", "side": "shared",
        "x": 10, "y": 55,
        "blurb": "Three per lane. Early outer turrets carry defensive plates: gold for cracking them early.",
        "facts": [
            ("Plates", "Outer turret bonus gold window in the first minutes"),
            ("Inner turrets", "Slow nearby enemy wave once the outer falls (defense mode)"),
            ("Backdoor", "Turrets take reduced damage without your minions nearby"),
        ],
        "tips": ["Trade turrets, don't feed hero kills saving a doomed turret.", "After Lord dies, its march + turret plates often end the game in one push."],
    },
    {
        "id": "base-ours", "name": "Our base", "category": "terrain", "side": "ours",
        "x": 10, "y": 86,
        "blurb": "Crystal + fountain. While it stands, everything on this diagram is negotiable.",
        "facts": [("Inhibitor turret", "Last wall before the crystal"), ("Waves", "Super minions join the march once an inhibitor falls")],
        "tips": ["Defend with waveclear heroes — never let two lanes of supers stack."],
    },
    # -------------------------------------------------- lanes
    {
        "id": "lane-exp", "name": "EXP lane", "category": "lane", "side": "ours",
        "x": 12, "y": 45,
        "blurb": "Fighter lane. First cannon waves give 35% extra EXP — the lane that hits level 4 fast for Turtle.",
        "facts": [("Wave bonus", "First 10 cannon minions: +35% EXP"), ("Turtle", "Spawns next to this lane at 2:00")],
        "tips": ["Level 4 by 1:50 or don't walk into the river — that is the whole job."],
    },
    {
        "id": "lane-mid", "name": "Mid lane", "category": "lane", "side": "shared",
        "x": 50, "y": 55,
        "blurb": "Fastest waves, fastest rotations. Mid controls the whole map's timing.",
        "facts": [("Waves", "Early waves: 3 lancers + 1 infantry — clears quick"), ("Nearby", "Lithowanderer 0:35 just below the tower")],
        "tips": ["Clear, then move — never sit mid after shoving.", "Watch the enemy jungle invade in the first minute."],
    },
    {
        "id": "lane-gold", "name": "Gold lane", "category": "lane", "side": "ours",
        "x": 55, "y": 88,
        "blurb": "Marksman lane. Cannon minions pay 45% more gold early — the carry's salary.",
        "facts": [("Wave bonus", "First 10 cannon minions: +45% gold"), ("Nearby", "River crab ≈ 0:42")],
        "tips": ["Missing a cannon last-hit is throwing away gold — farm over fighting until 5:10.", "Wait for waves inside a bush, not in the open."],
    },
]

ROTATIONS: list[dict] = [
    {
        "role": "Jungle",
        "steps": [
            "Start the buff closest to EXP lane (orange at 0:20, purple at 0:25) — the clear leaves you level 4 near Gold lane, ready to gank.",
            "Chain the second buff and the small camps; the Lithowanderer (0:35, near mid) helps you reach level 4.",
            "Be at the Turtle for 2:00 with Retribution ready. Buffs return 90 s after dying — track them.",
            "Leave lane minions to laners early. Secure at least one of: both buffs, kills, or Turtle.",
        ],
        "links": ["Tier list: Assassin / Fighter for current jungle meta"],
    },
    {
        "role": "Roam",
        "steps": [
            "First minute: guard your jungler's first buff against invade.",
            "Head to the Turtle before 2:00 — the roamer's arrival usually decides it.",
            "Move lane to lane providing vision; never park in one bush.",
            "From 8:00 your rewards share with the team naturally — group around objectives.",
        ],
        "links": ["Tier list: Tank / Support for roam meta"],
    },
    {
        "role": "Gold lane",
        "steps": [
            "First 10 waves (until 5:10): your cannon minion pays 45% more gold — don't miss its last hit.",
            "The river Crab (from 0:42) gives ≈ 60 gold over 18 s; zone it, then take it.",
            "Your jungler doesn't tax your minions early — every wave is yours.",
            "Between waves, wait inside a bush instead of showing on the lane.",
        ],
        "links": ["Tier list: Marksman for carry meta"],
    },
    {
        "role": "EXP lane",
        "steps": [
            "First Turtle spawns at 2:00 next to your lane: be level 4 and ready.",
            "First 10 cannon waves give 35% extra EXP — that's your level-4 ticket.",
            "After the Turtle, go back to farming if the fight isn't winnable.",
        ],
        "links": ["Tier list: Fighter for EXP meta"],
    },
    {
        "role": "Mid lane",
        "steps": [
            "Lithowanderer spawns at 0:35 near mid — mana regen + river speed for the finisher.",
            "Early mid waves (3 lancers + 1 infantry) clear fast; rotate straight to a side.",
            "Level 4 by Turtle time at 2:00, and watch for a first-minute jungle invade.",
        ],
        "links": ["Tier list: Mage for mid meta"],
    },
]

SOURCES = ["mobilelegends.fandom.com (Turtle, Lord, buffs, camps, turrets, map) — checked 2026-10-07"]


def payload() -> dict:
    return {"pins": PINS, "rotations": ROTATIONS, "sources": SOURCES,
            "note": "Diagram positions are approximate, not to scale. Your base is bottom-left; the river cuts the map diagonally and enemy camps mirror yours."}
