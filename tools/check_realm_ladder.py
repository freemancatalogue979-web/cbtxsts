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
sa.orm = types.ModuleType("sqlalchemy.orm")
sa.orm.Session = object
sys.modules["sqlalchemy"] = sa
sys.modules["sqlalchemy.orm"] = sa.orm

app = types.ModuleType("app")
app.__path__ = [str(ROOT / "backend/app")]
services = types.ModuleType("app.services")
services.__path__ = [str(ROOT / "backend/app/services")]
models = types.ModuleType("app.models")
models.SeasonStat = type("SeasonStat", (), {})
models.Student = type("Student", (), {})
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

print("realm ladder OK — 100 realms, first mystical realm:", ladder[40]["label"])
