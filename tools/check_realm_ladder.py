"""Exercise the season ladder without a database.

The arena's Python deps are not installable in this sandbox, so the sqlalchemy
and models imports are stubbed and only the pure ladder functions run.
"""
import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# --- stubs -----------------------------------------------------------------
sa = types.ModuleType("sqlalchemy")
sa.func = types.SimpleNamespace(count=lambda *a, **k: None)
sa.select = lambda *a, **k: None
sa.text = lambda *a, **k: None
sa.orm = types.ModuleType("sqlalchemy.orm")
sa.orm.Session = object
sys.modules["sqlalchemy"] = sa
sys.modules["sqlalchemy.orm"] = sa.orm

app = types.ModuleType("app")
app.__path__ = [str(ROOT / "backend/app")]
services = types.ModuleType("app.services")
services.__path__ = [str(ROOT / "backend/app/services")]
models = types.ModuleType("app.models")
for _name in ("SeasonStat", "Student", "Activity", "Attempt", "Badge", "Friendship", "StudentBadge"):
    setattr(models, _name, type(_name, (), {}))
models.utcnow = lambda: None
sys.modules["app"] = app
sys.modules["app.services"] = services
sys.modules["app.models"] = models

spec = importlib.util.spec_from_file_location("app.services.season", ROOT / "backend/app/services/season.py")
season = importlib.util.module_from_spec(spec)
sys.modules["app.services.season"] = season
spec.loader.exec_module(season)

# --- the ladder ------------------------------------------------------------
assert season.MAX_LEVEL == 100, season.MAX_LEVEL
ladder = season.ladder()
assert len(ladder) == 100, len(ladder)
assert ladder[0]["label"] == "Ember", ladder[0]
assert ladder[39]["label"] == "Polaris", ladder[39]
assert ladder[40]["label"] == "Aurora", ladder[40]
assert ladder[99]["label"] == "Absolute Genesis", ladder[99]
assert ladder[40]["mystical"] is True
assert ladder[39]["mystical"] is False

for level in range(1, 101):
    rank = season.rank_for_level(level)
    assert rank["from"] == level and rank["to"] == level, (level, rank)
    assert season.rank_payload(rank)["level_from"] == level

payload = season.rank_payload(season.rank_for_level(57))
assert payload["key"] == "silence", payload
assert payload["realm"] == 57
assert payload["level_from"] == 57 and payload["level_to"] == 57
assert payload["xp_from"] < payload["xp_to"]
assert payload["shape"] and payload["band"] and payload["family"]

levels = season.levels_table()
assert len(levels) == 100
assert levels[0]["rank"] == "ember"
assert levels[99]["rank"] == "absolute_genesis"
assert levels[0]["xp"] == 0
assert levels[99]["next_xp"] is None

# the XP curve still rises
xp = [season.xp_for_level(level) for level in range(1, 101)]
assert xp == sorted(xp) and len(set(xp)) == 100

# every level maps to a distinct realm
keys = {season.rank_for_level(level)["key"] for level in range(1, 101)}
assert len(keys) == 100, len(keys)

# --- the lifetime metals ----------------------------------------------------
spec = importlib.util.spec_from_file_location("app.game", ROOT / "backend/app/game.py")
game = importlib.util.module_from_spec(spec)
sys.modules["app.game"] = game
spec.loader.exec_module(game)

# Twenty-four division medals and Absolute Genesis at level 100.
LADDER = [
    (1, "bronze_1"), (2, "bronze_2"), (3, "bronze_3"),
    (4, "silver_1"), (5, "silver_2"), (6, "silver_3"),
    (7, "gold_1"), (8, "gold_2"), (9, "gold_3"),
    (10, "platinum_1"), (13, "platinum_2"), (16, "platinum_3"),
    (20, "diamond_1"), (24, "diamond_2"), (28, "diamond_3"),
    (33, "obsidian_1"), (38, "obsidian_2"), (43, "obsidian_3"),
    (50, "mythril_1"), (57, "mythril_2"), (64, "mythril_3"),
    (72, "aurora_1"), (81, "aurora_2"), (90, "aurora_3"),
    (100, "absolute_genesis"),
]
assert len(LADDER) == 25
assert game.TIER_LEVELS == tuple(LADDER), game.TIER_LEVELS

for level in range(1, game.MAX_LEVEL + 1):
    expected = LADDER[0][1]
    for threshold, name in LADDER:
        if level >= threshold:
            expected = name
    assert game.tier_for_level(level) == expected, (level, game.tier_for_level(level))

# every band boundary lands on the metal it names
for threshold, name in LADDER:
    assert game.tier_for_level(threshold) == name, (threshold, name)
    if threshold > 1:
        assert game.tier_for_level(threshold - 1) != name, (threshold, name)

assert game.tier_for_level(0) == "bronze_1"
assert game.MAX_LEVEL == 100
assert game.tier_for_level(60) == "mythril_2"
assert game.tier_for_level(100) == "absolute_genesis"

print("realm ladder OK — 100 realms, first mystical realm:", ladder[40]["label"])
print("lifetime metals OK —", " → ".join(name for _, name in LADDER))
