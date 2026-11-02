"""Saved MLBB snapshots: isolated SQLite, fake upstreams, no external requests."""

from __future__ import annotations

import json
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import HTTPException
from app.clover_ai_models import AIAccountConsent
from app.intel_cache import (
    IntelAccountGeneration,
    IntelSnapshot,
    claim_refresh,
    finish_refresh,
    save_snapshot,
    snapshot_key,
)
from app.models import IntelLink, User, utcnow
from tests import test_clover_ai as fixture


class IntelSnapshotTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown

    def get(self, path, who="owner"):
        return fixture.request("GET", "/api/intel/" + path, self.tokens[who])

    @staticmethod
    def response(value):
        return 200, json.dumps({"code": 0, "data": {"value": value}}).encode()

    def age(self, path, query=""):
        with self.factory() as db:
            row = db.get(IntelSnapshot, snapshot_key("public", path, query))
            row.observed_at = utcnow() - timedelta(days=3)
            db.commit()

    def test_cold_fetch_is_saved_and_shared_then_stale_refresh_is_nonblocking(self):
        with patch("app.routers.intel._fetch", return_value=self.response("first")) as upstream:
            status, body, headers = self.get("heroes/Alice?lang=en")
            self.assertEqual(status, 200)
            self.assertEqual(body["data"]["value"], "first")
            self.assertEqual(body["_clover_cache"]["status"], "fresh")
            self.assertEqual(headers[b"x-intel-cache"], b"fresh")
            self.assertEqual(upstream.call_count, 1)
        # A different member and a new DB session use the same saved public data.
        with patch("app.routers.intel._fetch", side_effect=AssertionError("unexpected network")):
            self.assertEqual(self.get("heroes/Alice?lang=en", "other")[1]["data"]["value"], "first")
        self.age("heroes/Alice", "lang=en")
        with patch("app.routers.intel._fetch", return_value=self.response("second")) as upstream:
            status, body, _ = self.get("heroes/Alice?lang=en")
            self.assertEqual((status, body["data"]["value"]), (200, "first"))
            self.assertEqual(body["_clover_cache"]["status"], "stale")
            self.assertTrue(body["_clover_cache"]["refreshing"])
            self.assertEqual(upstream.call_count, 1)
        with patch("app.routers.intel._fetch", side_effect=AssertionError("unexpected network")):
            status, body, _ = self.get("heroes/Alice?lang=en")
            self.assertEqual((status, body["data"]["value"], body["_clover_cache"]["status"]), (200, "second", "fresh"))

    def test_failed_or_invalid_refresh_preserves_saved_data_and_cools_down(self):
        with patch("app.routers.intel._fetch", return_value=self.response("good")):
            self.get("esports/ph/standings")
        self.age("esports/ph/standings")
        with patch("app.routers.intel._fetch", return_value=(200, b'{"code":123,"message":"bad"}')) as upstream:
            _, body, _ = self.get("esports/ph/standings")
            self.assertEqual(body["data"]["value"], "good")
            self.assertTrue(body["_clover_cache"]["refreshing"])
            _, body, _ = self.get("esports/ph/standings")
            self.assertEqual(body["data"]["value"], "good")
            self.assertTrue(body["_clover_cache"]["refresh_failed"])
            self.assertFalse(body["_clover_cache"]["refreshing"])
            self.assertEqual(upstream.call_count, 1)
        with self.factory() as db:
            self.assertEqual(db.query(IntelSnapshot).filter_by(scope="public").count(), 1)

    def test_query_keys_are_separate_and_credentials_are_not_cached(self):
        with patch("app.routers.intel._fetch", side_effect=[self.response("a"), self.response("b")]) as upstream:
            self.get("heroes/rank?rank=a")
            self.get("heroes/rank?rank=b")
            self.assertEqual(upstream.call_count, 2)
            self.assertEqual(self.get("heroes/rank?token=SECRET")[0], 400)
            self.assertEqual(self.get("heroes/../account/profile")[0], 404)
        with self.factory() as db:
            rows = db.query(IntelSnapshot).all()
            self.assertEqual(len(rows), 2)
            self.assertNotIn("SECRET", " ".join(row.query + row.payload_json for row in rows))

    def test_lease_is_atomic_and_obsolete_workers_cannot_overwrite(self):
        with self.factory() as db:
            row = save_snapshot(db, "public", "heroes", "", {"data": [1]})
            key = row.key
        with self.factory() as db:
            self.assertTrue(claim_refresh(db, key, "one"))
        with self.factory() as db:
            self.assertFalse(claim_refresh(db, key, "two"))
            self.assertFalse(finish_refresh(db, key, "two", {"data": [2]}))
            self.assertTrue(finish_refresh(db, key, "one", {"data": [3]}))
            self.assertEqual(json.loads(db.get(IntelSnapshot, key).payload_json)["data"], [3])

    def test_owner_account_cache_consent_and_unlink_are_isolated(self):
        def source(_method, path, *, params=None, jwt=None, payload=None):
            if path == "user/auth/logout":
                raise HTTPException(502, "offline")
            name = "Owner" if jwt == "SECRET_OWN_JWT" else "Other"
            return {
                "code": 0,
                "data": {"name": name, "wins": 12, "nested": {"access_token": "NO_STORE_SECRET", "echo": jwt}},
            }

        with patch("app.routers.intel._rone_request", side_effect=source) as upstream:
            status, owner, headers = self.get("account/matches?index=1&size=10")
            self.assertEqual(status, 200)
            self.assertEqual(headers[b"cache-control"], b"no-store")
            self.assertEqual(owner["data"]["name"], "Owner")
            self.assertNotIn("NO_STORE_SECRET", json.dumps(owner))
            self.assertNotIn("SECRET_OWN_JWT", json.dumps(owner))
            self.assertEqual(self.get("account/matches?index=1&size=10", "other")[1]["data"]["name"], "Other")
            self.assertEqual(self.get("account/matches?index=1&size=10")[1]["data"]["name"], "Owner")
            self.assertEqual(upstream.call_count, 2)
        self.assertEqual(fixture.request("GET", "/api/intel/account/matches", cookie=self.tokens["owner"])[0], 401)
        settings = fixture.request("GET", "/api/ai/settings", self.tokens["owner"])[1]
        self.assertFalse(settings["share_account_stats"])
        settings = fixture.request("PATCH", "/api/ai/settings", self.tokens["owner"], {"share_account_stats": True})[1]
        self.assertTrue(settings["share_account_stats"])
        self.assertFalse(fixture.request("GET", "/api/ai/settings", self.tokens["other"])[1]["share_account_stats"])
        with self.factory() as db:
            owner_id = db.query(User.id).filter_by(email="owner@test.invalid").scalar()
            owner_rows = db.query(IntelSnapshot).filter_by(owner_id=owner_id, scope="account").all()
            key, generation = owner_rows[0].key, owner_rows[0].generation_id
            self.assertNotIn("NO_STORE_SECRET", owner_rows[0].payload_json)
            self.assertTrue(claim_refresh(db, key, "old-worker"))
        with patch("app.routers.intel._rone_request", side_effect=source):
            status, _, _ = fixture.request("POST", "/api/intel/account/disconnect", self.tokens["owner"], {})
            self.assertEqual(status, 200)
        with self.factory() as db:
            self.assertIsNone(db.get(IntelAccountGeneration, generation))
            self.assertIsNone(db.get(AIAccountConsent, owner_id))
            self.assertEqual(db.query(IntelSnapshot).filter_by(owner_id=owner_id, scope="account").count(), 0)
            self.assertFalse(finish_refresh(db, key, "old-worker", {"code": 0, "data": {"name": "OLD"}}))
            with self.assertRaises(ValueError):
                save_snapshot(
                    db, "account", "user/matches", "", {"data": []}, owner_id=owner_id, generation_id=generation
                )
            self.assertEqual(db.query(IntelSnapshot).filter_by(scope="account").count(), 1)  # other owner untouched
        self.assertEqual(self.get("account/matches")[0], 404)
        self.assertFalse(fixture.request("GET", "/api/ai/settings", self.tokens["owner"])[1]["share_account_stats"])

    def test_relink_purges_previous_snapshot_and_resets_consent(self):
        def source(method, path, *, params=None, jwt=None, payload=None):
            if path == "user/auth/login":
                return {"code": 0, "data": {"jwt": "NEW_JWT", "token": "NEW_REFRESH"}}
            return {"code": 0, "data": {"name": "New Account" if jwt == "NEW_JWT" else "Old Account", "level": 7}}

        with patch("app.routers.intel._rone_request", side_effect=source), patch("app.routers.intel._adopt_avatar"):
            self.get("account/heroes")
            self.assertEqual(
                fixture.request("PATCH", "/api/ai/settings", self.tokens["owner"], {"share_account_stats": True})[0],
                200,
            )
            status, _, _ = fixture.request(
                "POST", "/api/intel/account/connect", self.tokens["owner"], {"role_id": 1, "zone_id": 2, "vc": "123456"}
            )
            self.assertEqual(status, 200)
            profile = self.get("account/profile")[1]
            self.assertEqual(profile["link"]["name"], "New Account")
            self.assertNotIn("Old Account", json.dumps(profile))
            self.assertNotIn("NEW_JWT", json.dumps(profile))
        self.assertFalse(fixture.request("GET", "/api/ai/settings", self.tokens["owner"])[1]["share_account_stats"])
        with self.factory() as db:
            owner_id = db.query(User.id).filter_by(email="owner@test.invalid").scalar()
            rows = db.query(IntelSnapshot).filter_by(owner_id=owner_id, scope="account").all()
            self.assertTrue(rows)
            self.assertNotIn("Old Account", json.dumps([row.payload_json for row in rows]))
            self.assertNotIn("NEW_JWT", json.dumps([row.payload_json for row in rows]))

    def test_size_and_scope_guards(self):
        with self.factory() as db:
            with self.assertRaises(ValueError):
                save_snapshot(db, "public", "heroes", "", {"data": "x" * 2_000_001})
            with self.assertRaises(ValueError):
                save_snapshot(db, "account", "profile", "", {}, owner_id=None)
            self.assertEqual(db.query(IntelSnapshot).count(), 0)


if __name__ == "__main__":
    unittest.main()
