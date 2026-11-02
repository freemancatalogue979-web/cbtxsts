"""Synthetic local-first game evidence; no real player or community requests."""

from __future__ import annotations

import io
import json
import os
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from app import ai_game_sources, clover_ai_service
from app.ai_esports_analysis import load_rone
from app.intel_cache import IntelSnapshot, snapshot_key
from app.models import Hero, utcnow
from tests import test_clover_ai as fixture

REAL_ENRICH = ai_game_sources.enrich


def collection(*rows):
    return {"code": 0, "data": {"records": list(rows), "total": len(rows)}}


KIT = collection(
    {
        "data": {
            "hero": {
                "data": {
                    "name": "X.Borg",
                    "heroskilllist": [
                        {
                            "skilllist": [
                                {
                                    "skillname": "Fire Missiles",
                                    "skilldesc": "Burn nearby enemies.",
                                    "skillicon": "https://example.invalid/skill.png",
                                }
                            ]
                        }
                    ],
                }
            }
        }
    }
)
STATS = collection(
    {
        "data": {
            "main_hero": {"data": {"hero": {"data": {"name": "X.Borg"}}}},
            "main_hero_win_rate": 0.51,
            "main_hero_appearance_rate": 0.03,
            "main_hero_ban_rate": 0.01,
        }
    }
)
GUIDES = collection(
    {
        "user": {"name": "SECRET_AUTHOR", "roleId": 123},
        "uin": "SECRET_AUTHOR_ID",
        "data": {
            "data": {
                "game_version": "2.1.18",
                "recommend": "Sustain build",
                "equips": [
                    {
                        "equip_title": "Core",
                        "equip_ids": [3007],
                        "equip_desc": "Use <font color='gold'>sustain</font> to stay in the fight.",
                    }
                ],
                "emblems": [
                    {"emblem_title": "Fighter", "emblem_desc": "Keep pressure."}
                ],
                "spell": {"spell_desc": "Choose a suitable battle spell."},
            }
        },
    }
)
ITEMS = collection(
    {
        "data": {
            "equipid": 3007,
            "equipname": "Bloodlust Axe",
            "equipskilldesc": "<b>Spell vamp</b> for skills.",
            "equiptypename": "Attack",
        }
    }
)
VERSIONS = collection(
    {
        "createdAt": 1770000000000,
        "uin": "SECRET_VERSION_AUTHOR",
        "data": {"game_version": "2.1.18"},
    }
)


class GameSourceTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown
    req = fixture.CloverAITests.req
    new_chat = fixture.CloverAITests.new_chat

    def test_xborg_aliases_resolve_canonical_profile_and_ratings(self):
        with self.factory() as db:
            db.add(
                Hero(
                    name="X.Borg",
                    role="EXP",
                    hero_class="Fighter",
                    clover_rating=7.5,
                    tier="A",
                )
            )
            db.commit()
            for spelling in ("xborg", "X.Borg", "x-borg", "x borg"):
                heroes = clover_ai_service._matching_heroes(
                    db, f"Explain {spelling} skills", []
                )
                self.assertEqual(heroes[0][0].name, "X.Borg")
            self.assertFalse(
                any(
                    h.name == "X.Borg"
                    for h, _ in clover_ai_service._matching_heroes(
                        db, "notxborgsuffix", []
                    )
                )
            )

    def test_full_chat_uses_public_game_endpoints_only_and_strips_authors(self):
        calls, bodies = [], []
        payloads = {
            "heroes/xborg": KIT,
            "academy/heroes/xborg/stats": STATS,
            "academy/heroes/xborg/recommended": GUIDES,
            "academy/equipment/expanded": ITEMS,
            "academy/meta/version": VERSIONS,
        }

        def public(path, query):
            calls.append((path, query))
            return (200, payloads[path]) if path in payloads else (404, {})

        def provider(request, timeout):
            bodies.append(json.loads(request.data))
            return io.BytesIO(
                b'{"choices":[{"message":{"content":"Here is your analysis, bro."},"finish_reason":"stop"}]}'
            )

        chat = self.new_chat()
        with patch("app.ai_game_sources.enrich", REAL_ENRICH), patch(
            "app.routers.intel._public_fetch", side_effect=public
        ), patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=SimpleNamespace(open=provider),
        ), patch(
            "app.routers.intel._refresh_account_snapshot"
        ) as account:
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "xborg stats, skills and build please",
                    "web_mode": "off",
                },
            )
            self.assertEqual(status, 201)
            self.assertEqual(result["assistant_message"]["mode"], "ai")
            account.assert_not_called()
            context = json.loads(bodies[-1]["messages"][-1]["content"])[
                "available_context"
            ]
            hero = context["hero_library"][0]
            self.assertEqual(hero["name"], "X.Borg")
            self.assertTrue(hero["ability_ratings_out_of_10"])
            self.assertEqual(
                hero["saved_rone_skills"]["skills"][0]["name"], "Fire Missiles"
            )
            self.assertEqual(
                hero["rone_ranked_stats"]["records"][0]["win_rate_percent"], 51
            )
            self.assertEqual(
                hero["rone_recommended_builds"]["guides"][0]["equipment"][0][
                    "item_ids"
                ],
                [3007],
            )
            self.assertEqual(
                context["rone_equipment"]["entries"][0]["name"], "Bloodlust Axe"
            )
            self.assertIn(
                "Spell vamp for skills",
                context["rone_equipment"]["entries"][0]["description"],
            )
            sent = json.dumps(context)
            self.assertNotIn("SECRET_AUTHOR", sent)
            self.assertNotIn("roleId", sent)
            self.assertEqual(
                {p for p, _ in calls}, set(payloads) - {"academy/meta/version"}
            )
            self.assertTrue(
                all(
                    not p.startswith("user/") and "xborg stats" not in (p + q)
                    for p, q in calls
                )
            )
            self.assertEqual(
                dict(calls)["academy/equipment/expanded"], "size=300&index=1"
            )
            hero_source = next(
                s
                for s in result["assistant_message"]["sources"]
                if s.get("visual", {}).get("kind") == "hero"
            )
            self.assertEqual(hero_source["visual"]["name"], "X.Borg")

            # A version-only feed is not a full balance-note source.
            status, version, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Check patch notes", "web_mode": "off"},
            )
            self.assertEqual(status, 201)
            version_context = json.loads(bodies[-1]["messages"][-1]["content"])[
                "available_context"
            ]["rone_patch_versions"]
            self.assertEqual(version_context["status"], "version_only")
            self.assertEqual(version_context["versions"][0]["version"], "2.1.18")
            self.assertFalse(version_context["versions"][0]["notes"])
            self.assertNotIn("SECRET_VERSION_AUTHOR", json.dumps(version_context))
            self.assertIn("academy/meta/version", dict(calls))
            self.assertTrue(
                any(
                    "Rone" in source["label"] and source.get("observed_at")
                    for source in version["assistant_message"]["sources"]
                )
            )

    def test_team_created_names_never_become_public_source_paths(self):
        with self.factory() as db:
            db.add(Hero(name="Secret Team Strategy", role="EXP"))
            db.commit()
        chat = self.new_chat()
        with patch("app.ai_game_sources.enrich", REAL_ENRICH), patch(
            "app.routers.intel._public_fetch"
        ) as fetch:
            status, _, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Explain Secret Team Strategy skills",
                    "web_mode": "off",
                },
            )
            self.assertEqual(status, 201)
            fetch.assert_not_called()

    def test_saved_query_variants_and_stale_retention(self):
        with self.factory() as db:
            with patch(
                "app.routers.intel._public_fetch", return_value=(200, ITEMS)
            ) as fetch:
                got, _, state = load_rone(
                    db,
                    "academy/equipment/expanded",
                    lambda value: ai_game_sources._records(value) is not None,
                    ttl=timedelta(hours=1),
                    query="size=300&index=1",
                )
                self.assertEqual(state, "loaded")
                self.assertEqual(got, ITEMS)
                fetch.assert_called_once_with(
                    "academy/equipment/expanded", "size=300&index=1"
                )
            key = snapshot_key(
                "public", "academy/equipment/expanded", "size=300&index=1"
            )
            self.assertIsNotNone(db.get(IntelSnapshot, key))
            other = collection({"data": {"equipid": 4000, "equipname": "Other"}})
            with patch(
                "app.routers.intel._public_fetch", return_value=(200, other)
            ) as fetch:
                distinct, _, state = load_rone(
                    db,
                    "academy/equipment/expanded",
                    lambda value: ai_game_sources._records(value) is not None,
                    ttl=timedelta(hours=1),
                    query="size=100&index=2",
                )
                self.assertEqual((distinct, state), (other, "loaded"))
                fetch.assert_called_once_with(
                    "academy/equipment/expanded", "size=100&index=2"
                )
                self.assertIsNotNone(
                    db.get(
                        IntelSnapshot,
                        snapshot_key(
                            "public", "academy/equipment/expanded", "size=100&index=2"
                        ),
                    )
                )
            with patch("app.routers.intel._public_fetch") as fetch:
                _, _, state = load_rone(
                    db,
                    "academy/equipment/expanded",
                    lambda value: ai_game_sources._records(value) is not None,
                    ttl=timedelta(hours=1),
                    query="size=300&index=1",
                )
                self.assertEqual(state, "saved")
                fetch.assert_not_called()
            row = db.get(IntelSnapshot, key)
            row.observed_at = utcnow() - timedelta(days=2)
            db.commit()
            # Cooldown, another worker, or an error should preserve stale data.
            with patch("app.routers.intel._public_fetch", return_value=(503, {})):
                got, _, state = load_rone(
                    db,
                    "academy/equipment/expanded",
                    lambda value: ai_game_sources._records(value) is not None,
                    ttl=timedelta(hours=1),
                    query="size=300&index=1",
                    wait_for_peer=False,
                )
            self.assertEqual((got, state), (ITEMS, "saved_stale"))

    def test_unavailable_version_feed_does_not_invent_patch_notes(self):
        chat = self.new_chat()
        with patch("app.ai_game_sources.enrich", REAL_ENRICH), patch(
            "app.routers.intel._public_fetch", return_value=(503, {"code": 503})
        ):
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Check patch notes", "web_mode": "off"},
            )
        self.assertEqual(status, 201)
        self.assertEqual(result["assistant_message"]["mode"], "facts")
        self.assertIn(
            "Full balance notes weren’t available",
            result["assistant_message"]["content"],
        )
        self.assertNotIn("2.1.18", result["assistant_message"]["content"])

    def test_hero_rates_require_a_matching_source_name(self):
        self.assertTrue(
            ai_game_sources._stats_projection(STATS, "X.Borg", utcnow(), "loaded")[
                "records"
            ]
        )
        self.assertFalse(
            ai_game_sources._stats_projection(STATS, "Alice", utcnow(), "loaded")[
                "records"
            ]
        )
        no_name = collection({"data": {"main_hero_win_rate": 0.99}})
        self.assertFalse(
            ai_game_sources._stats_projection(no_name, "X.Borg", utcnow(), "loaded")[
                "records"
            ]
        )

    def test_battle_spell_and_emblem_descriptions_are_projected(self):
        spells = collection(
            {
                "data": {
                    "skillname": "@__data.skillname",
                    "__data": {
                        "skillname": "Arrival",
                        "skilldesc": "<b>Teleport</b> to an ally.",
                    },
                }
            }
        )
        emblems = collection(
            {
                "data": {
                    "emblemskill": {
                        "skillname": "Weapons Master",
                        "skilldesc": "Increase attack by 5%.",
                    }
                }
            }
        )
        spell = ai_game_sources._ability_catalog(
            spells, "Explain the Arrival spell", "spells", utcnow(), "loaded"
        )
        emblem = ai_game_sources._ability_catalog(
            emblems, "Explain Weapons Master talent", "emblems", utcnow(), "loaded"
        )
        self.assertEqual(spell["entries"][0]["name"], "Arrival")
        self.assertEqual(spell["entries"][0]["description"], "Teleport to an ally.")
        self.assertTrue(spell["exact_name_match"])
        self.assertEqual(emblem["entries"][0]["description"], "Increase attack by 5%.")

    def test_version_projection_never_mistakes_rone_changelog_for_game_notes(self):
        result = ai_game_sources._version_projection(VERSIONS, utcnow(), "loaded")
        self.assertEqual(result["status"], "version_only")
        self.assertEqual(result["versions"][0]["notes"], [])
        self.assertTrue(result["versions"][0]["source_created_at"].endswith("Z"))
        self.assertNotIn("SECRET_VERSION_AUTHOR", json.dumps(result))
        with_notes = collection(
            {"data": {"game_version": "2.1.19", "changes": ["Adjusted a test skill."]}}
        )
        self.assertEqual(
            ai_game_sources._version_projection(with_notes, utcnow(), "loaded")[
                "status"
            ],
            "available",
        )


if __name__ == "__main__":
    unittest.main()
