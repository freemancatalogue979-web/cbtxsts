"""Player data straight from Moonton (mlbb-api-own endpoints) with Rone as the backup. No network."""

from __future__ import annotations

import base64
import json
import unittest
import urllib.parse
from unittest.mock import patch

from fastapi import HTTPException

from app import mlbb_moonton as mt
from app.routers import intel


def _jwt(role=742039794, zone=10382) -> str:
    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return f"{b64({'alg': 'HS256'})}.{b64({'exp': 4102444800, 'Ext': {'roleId': role, 'zoneId': zone}})}.sig"


JWT = _jwt()


class Recorder:
    """Stands in for mt._send: records each Request and answers by URL path."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def __call__(self, req):
        url = urllib.parse.urlsplit(req.full_url)
        self.calls.append(req)
        key = url.path.rsplit("/actgateway/", 1)[-1].lstrip("/")
        answer = self.answers[key]
        return answer(req) if callable(answer) else json.loads(json.dumps(answer))


def form(req):
    return dict(urllib.parse.parse_qsl(req.data.decode()))


def query(req):
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(req.full_url).query))


class MoontonClientTests(unittest.TestCase):
    def setUp(self):
        mt._season_cache.clear()

    def test_send_code_and_login_post_forms_to_auth_host(self):
        rec = Recorder({"base/sendVc": {"code": 0, "data": "", "msg": "ok"},
                        "base/login": {"code": 0, "data": {"jwt": JWT, "token": "T"}}})
        with patch.object(mt, "_send", rec):
            self.assertEqual(mt.send_code(742039794, 10382)["code"], 0)
            self.assertEqual(mt.login(742039794, 10382, "2379")["data"]["jwt"], JWT)
        sent, login = rec.calls
        self.assertEqual(sent.full_url, "https://sg-api.mobilelegends.com/base/sendVc")
        self.assertEqual(sent.get_method(), "POST")
        self.assertEqual(form(sent), {"roleId": "742039794", "zoneId": "10382"})
        self.assertIn("x-www-form-urlencoded", sent.get_header("Content-type"))
        self.assertEqual(sent.get_header("Origin"), "https://www.mobilelegends.com")
        self.assertEqual(form(login), {"roleId": "742039794", "zoneId": "10382", "vc": "2379",
                                       "referer": "academy", "type": "web"})
        self.assertIsNone(sent.get_header("Authorization"))

    def test_profile_sends_raw_token_and_academy_ids(self):
        rec = Recorder({"base/getBaseInfo": {"code": 0, "data": {"name": "★Yoshino★", "level": 81}}})
        with patch.object(mt, "_send", rec):
            self.assertEqual(mt.profile(JWT, *mt.token_ids(JWT))["data"]["name"], "★Yoshino★")
        req = rec.calls[0]
        self.assertEqual(req.get_header("Authorization"), JWT)  # raw, no "Bearer"
        self.assertEqual(req.get_header("X-token"), JWT)
        self.assertEqual((req.get_header("X-actid"), req.get_header("X-appid")), ("2728785", "2713644"))
        self.assertEqual(form(req), {"roleId": "742039794", "zoneId": "10382"})

    def test_token_ids_reads_ext_and_tolerates_junk(self):
        self.assertEqual(mt.token_ids(JWT), (742039794, 10382))
        self.assertEqual(mt.token_ids("not-a-token"), (None, None))

    def test_recent_matches_uses_newest_season_and_walks_cursor_pages(self):
        def recent(req):
            q = query(req)
            self.assertEqual(q["sid"], "40")
            if "last_cursor" not in q:
                return {"code": 0, "data": {"result": [{"hid": 1}], "pageInfo": {"nextCursor": 77}}}
            self.assertEqual(q["last_cursor"], "77")
            return {"code": 0, "data": {"result": [{"hid": 2, "k": 3}], "pageInfo": {"nextCursor": 0}}}

        rec = Recorder({"battlereport/season/list": {"code": 0, "data": {"sids": [38, 40, 39]}},
                        "battlereport/matches/recent": recent})
        with patch.object(mt, "_send", rec):
            env = mt.recent_matches(JWT, limit=10, page=2)
            mt.recent_matches(JWT, limit=10, page=1)
        self.assertEqual(env["data"]["result"][0]["hid"], 2)
        self.assertEqual(env["data"]["sid"], 40)
        paths = [urllib.parse.urlsplit(c.full_url).path for c in rec.calls]
        self.assertEqual(paths.count("/actgateway/battlereport/season/list"), 1)  # cached per session
        self.assertTrue(all(c.full_url.startswith("https://app.web.moontontech.com/actgateway/") for c in rec.calls))
        self.assertEqual(rec.calls[1].get_header("Authorization"), JWT)

    def test_friendly_matches_heroes_stats_season(self):
        matches = mt.friendly("matches", {"code": 0, "data": {"sid": 40, "pageInfo": {"nextCursor": 5}, "result": [
            {"hid": 17, "k": 5, "d": 2, "a": 7, "res": 1, "mvp": 1, "lid": 4, "s": 9.1, "ts": 1779134240,
             "bid_s": "4139649383291049463", "hid_e": {"n": "Fanny", "ix": "https://x/icon.png"}},
            {"hid": 2, "k": 0, "d": 4, "a": 1, "res": 0, "lid": 5}]}})["data"]
        first = matches["records"][0]
        self.assertEqual((first["hero_name"], first["result"], first["kills"], first["lane"], first["kda"]),
                         ("Fanny", "win", 5, "Jungle", 6.0))
        self.assertEqual(first["match_id"], "4139649383291049463")
        self.assertEqual((matches["games"], matches["wins"], matches["win_rate"], matches["has_more"]), (2, 1, 50.0, True))
        self.assertEqual(matches["records"][1]["result"], "loss")

        heroes = mt.friendly("heroes", {"code": 0, "data": {"result": [
            {"hid": 17, "tc": 20, "wc": 15, "bs": 12.5, "hid_e": {"n": "Fanny"}}]}})["data"]["records"]
        self.assertEqual(heroes[0], {"hero_name": "Fanny", "hero_id": 17, "matches": 20, "wins": 15,
                                     "win_rate": 75.0, "best_score": 12.5})

        stats = mt.friendly("stats", {"code": 0, "data": {"tc": 200, "wc": 110, "mvpc": 30, "wsc": 9, "gt": 720,
                                                          "hk": {"v": 21, "hid": 17}}})["data"]
        self.assertEqual((stats["matches"], stats["wins"], stats["losses"], stats["win_rate"]), (200, 110, 90, 55.0))
        self.assertEqual((stats["mvp_count"], stats["best_streak"], stats["avg_game_minutes"], stats["most_kills"]),
                         (30, 9, 12.0, 21.0))

        self.assertEqual(mt.friendly("season", {"code": 0, "data": {"sids": [37, 40]}})["data"],
                         {"current_season": 40, "seasons": "40, 37"})
        refused = {"code": 1002, "msg": "auth is empty"}
        self.assertIs(mt.friendly("matches", refused), refused)


class AccountRoutingTests(unittest.TestCase):
    """Routing as it works if Moonton ever turns the battle report back on (MLBB_BATTLEREPORT=1)."""

    def setUp(self):
        mt._season_cache.clear()
        flag = patch.object(mt, "BATTLEREPORT", True)
        flag.start()
        self.addCleanup(flag.stop)

    def test_moonton_is_used_first_and_answers_are_made_readable(self):
        rec = Recorder({"battlereport/season/list": {"code": 0, "data": {"sids": [40]}},
                        "battlereport/heros/frequent": {"code": 0, "data": {"result": [{"hid": 1, "tc": 4, "wc": 3,
                                                                                         "hid_e": {"n": "Miya"}}]}}})
        with patch.object(mt, "_send", rec), patch.object(intel, "_rone_request") as rone:
            env = intel._account_request("GET", "user/heroes/frequent", params={"lang": "en"}, jwt=JWT)
        rone.assert_not_called()
        self.assertEqual(env["data"]["records"][0]["hero_name"], "Miya")
        self.assertEqual(env["data"]["records"][0]["win_rate"], 75.0)

    def test_rone_backup_steps_in_only_when_moonton_is_unreachable(self):
        def rone(method, path, *, payload=None, params=None, jwt=None):
            if path == "user/season":
                return {"code": 0, "data": {"sids": [40]}}
            self.assertEqual(path, "user/matches")
            self.assertEqual(params["sid"], 40)
            self.assertEqual(params["limit"], 10)
            self.assertNotIn("index", params)
            return {"code": 0, "data": {"result": [{"hid": 9, "res": 1, "hid_e": {"n": "Tigreal"}}]}}

        with patch.object(mt, "_send", side_effect=mt.SourceDown("offline")), \
                patch.object(intel, "_rone_request", side_effect=rone):
            env = intel._account_request("GET", "user/matches", params={"index": 1, "size": 10, "lang": "en"}, jwt=JWT)
        self.assertEqual(env["data"]["records"][0], {"hero_name": "Tigreal", "hero_id": 9, "result": "win", "mvp": 0})

    def test_a_refusal_from_moonton_is_not_retried_elsewhere(self):
        with patch.object(mt, "_send", return_value={"code": 10027, "msg": "Verification code error"}), \
                patch.object(intel, "_rone_request") as rone:
            env = intel._account_request("POST", "user/auth/login",
                                         payload={"role_id": 1, "zone_id": 2, "vc": "0000"})
        rone.assert_not_called()
        self.assertEqual(intel._envelope_error(env), "Verification code error")

    def test_backup_can_be_switched_off(self):
        with patch.object(intel, "RONE_BACKUP", False), \
                patch.object(mt, "_send", side_effect=mt.SourceDown("offline")), \
                patch.object(intel, "_rone_request") as rone:
            with self.assertRaises(HTTPException) as caught:
                intel._account_request("GET", "user/stats", params={"lang": "en"}, jwt=JWT)
        rone.assert_not_called()
        self.assertEqual(caught.exception.status_code, 502)

    def test_rone_only_mode(self):
        with patch.object(intel, "PLAYER_SOURCE", "rone"), patch.object(mt, "_send") as moonton, \
                patch.object(intel, "_rone_request", return_value={"code": 0, "data": {"tc": 10, "wc": 6}}):
            env = intel._account_request("GET", "user/stats", params={"lang": "en"}, jwt=JWT)
        moonton.assert_not_called()
        self.assertEqual(env["data"]["win_rate"], 60.0)

    def test_send_errors_become_source_down(self):
        import urllib.error

        class Boom:
            def open(self, *a, **k):
                raise urllib.error.URLError("no route")

        with patch.object(mt.urllib.request, "build_opener", return_value=Boom()):
            with self.assertRaises(mt.SourceDown):
                mt.send_code(1, 2)


class RetiredBattleReportTests(unittest.TestCase):
    """Moonton retired battlereport/* on 30 Jun 2026 (code 10407, "接口下线")."""

    def test_default_never_calls_the_dead_routes(self):
        self.assertFalse(mt.BATTLEREPORT)
        with patch.object(mt, "_send") as moonton, patch.object(intel, "_rone_request") as rone:
            for path in ("user/stats", "user/season", "user/matches", "user/heroes/frequent"):
                env = intel._account_request("GET", path, params={"lang": "en", "index": 1, "size": 10}, jwt=JWT)
                self.assertTrue(env["offline"], path)
                self.assertIn("30 June 2026", env["msg"])
        moonton.assert_not_called()
        rone.assert_not_called()

    def test_profile_still_goes_to_moonton(self):
        rec = Recorder({"base/getBaseInfo": {"code": 0, "data": {"name": "Tobi", "level": 50}}})
        with patch.object(mt, "_send", rec):
            env = intel._account_request("GET", "user/info", params={"lang": "en"}, jwt=JWT)
        self.assertEqual(env["data"]["name"], "Tobi")

    def test_10407_is_offline_not_expired(self):
        answer = {"code": 10407, "message": "接口下线"}
        self.assertTrue(mt.is_offline(answer))
        self.assertFalse(mt.is_auth_error(answer))
        with patch.object(mt, "BATTLEREPORT", True), patch.object(mt, "_send", return_value=answer):
            env = intel._account_request("GET", "user/stats", params={"lang": "en"}, jwt=JWT)
        self.assertTrue(env["offline"])
        self.assertNotIn("relink", env)


class SessionHealthTests(unittest.TestCase):
    def setUp(self):
        mt._season_cache.clear()
        flag = patch.object(mt, "BATTLEREPORT", True)
        flag.start()
        self.addCleanup(flag.stop)

    def test_expired_token_is_caught_before_asking_anyone(self):
        import time as _t

        old = _jwt()
        head, _, sig = old.split(".")
        body = base64.urlsafe_b64encode(json.dumps({"exp": int(_t.time()) - 5, "Ext": {"roleId": 1, "zoneId": 2}}).encode()).decode().rstrip("=")
        expired = f"{head}.{body}.{sig}"
        self.assertTrue(mt.token_expired(expired))
        self.assertFalse(mt.token_expired(JWT.replace(JWT.split(".")[1], base64.urlsafe_b64encode(
            json.dumps({"exp": int(_t.time()) + 3600}).encode()).decode().rstrip("="))))
        self.assertFalse(mt.token_expired("opaque-token-without-exp"))
        with patch.object(mt, "_send") as moonton, patch.object(intel, "_rone_request") as rone:
            env = intel._account_request("GET", "user/stats", params={"lang": "en"}, jwt=expired)
        moonton.assert_not_called()
        rone.assert_not_called()
        self.assertTrue(env["relink"])
        self.assertIn("expired", env["msg"])

    def test_actgateway_auth_refusal_becomes_a_clear_relink_message(self):
        # actgateway says "message", not "msg" — this used to show up as "couldn't reach MLBB"
        with patch.object(mt, "_send", return_value={"code": 1002, "message": "auth is empty"}):
            env = intel._account_request("GET", "user/stats", params={"lang": "en"}, jwt=JWT)
        self.assertTrue(env["relink"])
        self.assertEqual(intel._envelope_error(env), mt.EXPIRED_MSG)

    def test_wrong_code_at_login_is_not_called_expired(self):
        with patch.object(mt, "_send", return_value={"code": 10027, "msg": "token verify failed"}):
            env = intel._account_request("POST", "user/auth/login", payload={"role_id": 1, "zone_id": 2, "vc": "1"})
        self.assertNotIn("relink", env)

    def test_both_down_explains_why(self):
        with patch.object(mt, "_send", side_effect=mt.SourceDown("timed out waiting for MLBB")), \
                patch.object(intel, "_rone_request", side_effect=HTTPException(502, "MLBB data service is unreachable.")):
            with self.assertRaises(HTTPException) as caught:
                intel._account_request("POST", "user/auth/send-vc", payload={"role_id": 1, "zone_id": 2})
        self.assertIn("timed out waiting for MLBB", caught.exception.detail)
        self.assertIn("backup", caught.exception.detail)

    def test_reasons_are_plain(self):
        import socket
        import urllib.error

        self.assertIn("DNS", mt._why(urllib.error.URLError(socket.gaierror(11001, "getaddrinfo failed"))))
        self.assertIn("timed out", mt._why(urllib.error.URLError(TimeoutError("timed out"))))
        self.assertIn("secure connection", mt._why(urllib.error.URLError("[SSL: CERTIFICATE_VERIFY_FAILED]")))

    def test_server_check(self):
        with patch.object(mt, "_send", return_value={"code": 0, "data": {"time": 1}}):
            self.assertTrue(mt.server_check()["ok"])
        with patch.object(mt, "_send", side_effect=mt.SourceDown("connection refused")):
            res = mt.server_check()
        self.assertEqual((res["ok"], res["detail"]), (False, "connection refused"))


if __name__ == "__main__":
    unittest.main()
