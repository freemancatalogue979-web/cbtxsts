"""Shared AI links: owner-only creation, private bits removed, team links need sign-in, revoke works."""

from __future__ import annotations

import json
import unittest

from app.clover_ai_models import AIMessage, AIShare
from tests import test_clover_ai as fixture
from tests.test_clover_ai import request


class ShareTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown
    req = fixture.CloverAITests.req
    new_chat = fixture.CloverAITests.new_chat

    def chat_with_messages(self):
        chat = self.new_chat()
        with self.factory() as db:
            db.add_all([
                AIMessage(conversation_id=chat, role="user", content="How do I play Fanny?"),
                AIMessage(conversation_id=chat, role="assistant", content="Use **cables** on walls.", mode="ai",
                          sources_json=json.dumps([
                              {"kind": "personal", "label": "Your pool: SECRET_POOL", "route": "/players/1"},
                              {"kind": "learned", "label": "SECRET_MEMORY", "memory_id": "x"},
                              {"kind": "web", "label": "Guide", "url": "https://example.com/fanny", "excerpt": "Cable tips"},
                              {"kind": "hero", "label": "Fanny", "url": "javascript:alert(1)", "knowledge_id": "k1",
                               "visual": {"kind": "hero", "name": "Fanny", "title": "Fanny", "roles": ["Assassin"], "ratings": {}}},
                          ])),
                AIMessage(conversation_id=chat, role="user", content="And Ling?"),
                AIMessage(conversation_id=chat, role="assistant", content="Ling runs on walls.", mode="ai"),
            ])
            db.commit()
            ids = [m.id for m in db.query(AIMessage).filter_by(conversation_id=chat).order_by(AIMessage.id).all()]
        return chat, ids

    def test_message_share_includes_prompt_and_strips_private_sources(self):
        chat, ids = self.chat_with_messages()
        status, share, _ = self.req("POST", f"/conversations/{chat}/shares", payload={"message_id": ids[1]})
        self.assertEqual((status, share["kind"], share["audience"]), (201, "message", "public"))
        self.assertTrue(share["path"].startswith("/#/share/"))
        status, body, headers = request("GET", f"/api/shared/{share['token']}")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get(b"cache-control"), b"no-store")
        self.assertEqual([m["role"] for m in body["messages"]], ["user", "assistant"])
        self.assertEqual(body["shared_by"]["name"], "OwnIGN")
        dump = json.dumps(body)
        for secret in ("SECRET_POOL", "SECRET_MEMORY", "javascript:", "memory_id", "knowledge_id", "route", "feedback", "proposal"):
            self.assertNotIn(secret, dump)
        sources = body["messages"][1]["sources"]
        self.assertEqual([s["kind"] for s in sources], ["web", "hero"])
        self.assertEqual(sources[0]["url"], "https://example.com/fanny")
        self.assertEqual(sources[1]["visual"]["name"], "Fanny")
        # Same request reuses the link.
        self.assertEqual(self.req("POST", f"/conversations/{chat}/shares", payload={"message_id": ids[1]})[1]["token"], share["token"])

    def test_chat_share_is_a_snapshot(self):
        chat, ids = self.chat_with_messages()
        share = self.req("POST", f"/conversations/{chat}/shares", payload={})[1]
        self.assertEqual(share["kind"], "chat")
        with self.factory() as db:
            db.add(AIMessage(conversation_id=chat, role="user", content="LATER_PRIVATE"))
            db.commit()
        body = request("GET", f"/api/shared/{share['token']}")[1]
        self.assertEqual(len(body["messages"]), 4)
        self.assertNotIn("LATER_PRIVATE", json.dumps(body))
        with self.factory() as db:
            self.assertEqual(db.query(AIShare).filter_by(token=share["token"]).one().views, 1)

    def test_only_owner_can_share_and_revoke(self):
        chat, ids = self.chat_with_messages()
        for who in ("other", "admin"):
            self.assertEqual(self.req("POST", f"/conversations/{chat}/shares", who, {})[0], 404)
        empty = self.new_chat()
        self.assertEqual(self.req("POST", f"/conversations/{empty}/shares", payload={})[0], 422)
        self.assertEqual(self.req("POST", f"/conversations/{chat}/shares", payload={"message_id": 999999})[0], 404)
        share = self.req("POST", f"/conversations/{chat}/shares", payload={})[1]
        self.assertEqual(self.req("DELETE", f"/shares/{share['token']}", "other")[0], 404)
        self.assertEqual(len(self.req("GET", "/shares")[1]["items"]), 1)
        self.assertEqual(self.req("GET", "/shares", "other")[1]["items"], [])
        self.assertEqual(self.req("DELETE", f"/shares/{share['token']}")[0], 204)
        self.assertEqual(request("GET", f"/api/shared/{share['token']}")[0], 404)

    def test_team_links_need_sign_in(self):
        chat, _ = self.chat_with_messages()
        share = self.req("POST", f"/conversations/{chat}/shares", payload={"audience": "team"})[1]
        self.assertEqual(request("GET", f"/api/shared/{share['token']}")[0], 401)
        self.assertEqual(request("GET", f"/api/shared/{share['token']}", "not-a-token")[0], 401)
        status, body, _ = request("GET", f"/api/shared/{share['token']}", self.tokens["other"])
        self.assertEqual((status, body["audience"]), (200, "team"))

    def test_deleting_the_chat_ends_the_link(self):
        chat, _ = self.chat_with_messages()
        share = self.req("POST", f"/conversations/{chat}/shares", payload={})[1]
        self.assertEqual(self.req("DELETE", f"/conversations/{chat}")[0], 204)
        self.assertEqual(request("GET", f"/api/shared/{share['token']}")[0], 404)
        self.assertEqual(request("GET", "/api/shared/short")[0], 404)


if __name__ == "__main__":
    unittest.main()
