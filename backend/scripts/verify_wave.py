"""Wave verification: registration, password login, dup rejection, rooms REST + WS + chat."""
from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3000"
PASSED, FAILED = [], []


def check(label, cond, detail=""):
    (PASSED if cond else FAILED).append(label)
    print(f"{'PASS' if cond else 'FAIL'} | {label}" + ("" if cond or not detail else f" -> {detail[:220]}"))


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except Exception:
            return exc.code, {}


def register(username, phone, password, name):
    return call("POST", "/api/auth/register", body={"username": username, "phone": phone, "password": password, "display_name": name})


def login(identifier, password):
    return call("POST", "/api/auth/student", body={"identifier": identifier, "password": password})


async def ws_client(token, room_id, out, seconds=6.0, send=None):
    import websockets

    url = f"ws://127.0.0.1:3000/ws/room/{room_id}?token={token}"
    try:
        async with websockets.connect(url) as socket:
            if send:
                await socket.send(json.dumps(send))

            async def pump():
                while True:
                    raw = await socket.recv()
                    out.append(json.loads(raw))

            task = asyncio.create_task(pump())
            await asyncio.sleep(seconds)
            task.cancel()
    except Exception as exc:  # noqa: BLE001
        out.append({"type": "error", "message": str(exc)})


async def main():
    import random
    SUF = str(random.randint(1000, 9999))
    ADA, BOB, CAROL = f"ada{SUF}", f"bob{SUF}", f"carol{SUF}"
    P1, P2, P3 = f"+2348010{SUF}01", f"+2348010{SUF}02", f"+2348010{SUF}03"
    # ---- registration ----
    st, s = register(ADA, P1, "secret123", "Ada Lovelace")
    check("register ada", st == 200 and s.get("token") and s["profile"]["username"] == ADA, str(s)[:200])
    ada_tok = s.get("token", "")
    check("welcome bonus on register", s["profile"]["coins"] >= 50, str(s.get("profile", {}))[:160])

    st, dup = register(ADA, f"+2348019{SUF}99", "secret123", "Impostor")
    check("duplicate username rejected 409", st == 409, str(dup)[:160])
    st, dup = register(f"ada2{SUF}", P1, "secret123", "Impostor")
    check("duplicate phone rejected 409", st == 409, str(dup)[:160])
    st, bad = register("xy", P2, "secret123", "Short Name")
    check("short username rejected", st == 422 or st == 400, str(bad)[:160])
    st, bad = register(BOB, P2, "12345", "Weak Pass")
    check("weak password rejected", st == 422 or st == 400, str(bad)[:160])

    st, b = register(BOB, P2, "secret456", "Bob Marley")
    bob_tok = b.get("token", "")
    check("register bob", st == 200 and bob_tok, str(b)[:160])
    st, c = register(CAROL, P3, "secret789", "Carol Danvers")
    carol_tok = c.get("token", "")
    check("register carol", st == 200 and carol_tok, str(c)[:160])

    # ---- login ----
    st, s = login(ADA, "secret123")
    check("login by username", st == 200 and s.get("token"), str(s)[:160])
    st, s = login(P2, "secret456")
    check("login by phone", st == 200 and s.get("token"), str(s)[:160])
    st, s = login(ADA, "wrongpass")
    check("wrong password 401", st == 401, str(s)[:160])
    st, s = login("nobody", "secret123")
    check("unknown user 401", st == 401, str(s)[:160])

    # ---- roster gone ----
    st, s = call("POST", "/api/auth/admin", body={"email": "admin@quizarena.ng", "password": "arena2026"})
    admin_tok = s.get("token", "")
    check("admin login", st == 200 and admin_tok, str(s)[:160])
    st, s = call("GET", "/api/admin/students?limit=50", token=admin_tok)
    total = s.get("total", -1)
    check("no seeded roster (only registered test accounts)", 1 <= total <= 200, str(s)[:200])

    # ---- rooms ----
    st, s = call("POST", "/api/rooms", body={"title": "Friday Night", "question_count": 3, "per_question_seconds": 8}, token=ada_tok)
    room = s.get("room", {})
    check("create room", st == 200 and room.get("code") and room["is_host"], str(s)[:200])
    room_id, code = room.get("id"), room.get("code", "")

    st, s = call("POST", f"/api/rooms/join/{code}", token=bob_tok)
    check("bob joins by code", st == 200 and len(s.get("room", {}).get("members", [])) == 2, str(s)[:200])
    st, s = call("POST", f"/api/rooms/join/{code}", token=carol_tok)
    check("carol joins", st == 200 and len(s.get("room", {}).get("members", [])) == 3, str(s)[:200])
    st, s = call("POST", "/api/rooms/join/ZZZZZZ", token=carol_tok)
    check("bad code rejected", st == 400, str(s)[:160])

    st, s = call("POST", f"/api/rooms/{room_id}/start", token=bob_tok)
    check("guest cannot start", st == 403, str(s)[:160])

    ada_msgs, bob_msgs = [], []
    st, s = call("POST", f"/api/rooms/{room_id}/start", token=ada_tok)
    q = s.get("question") or {}
    check("host starts + Q1 open", st == 200 and q.get("question", {}).get("text") and q.get("index") == 0, str(s)[:220])

    # WS: ada listens, bob joins + chats
    async def run_ws():
        bob_task = asyncio.create_task(ws_client(bob_tok, room_id, bob_msgs, seconds=8, send={"type": "chat", "body": "hello room! what topic is Q1?"}))
        ada_task = asyncio.create_task(ws_client(ada_tok, room_id, ada_msgs, seconds=8))
        await asyncio.sleep(1.0)
        # both answer Q1 (may be wrong, still locks)
        st1, r1 = call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "A", "elapsed_ms": 1500}, token=ada_tok)
        st2, r2 = call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "B", "elapsed_ms": 2000}, token=bob_tok)
        check("answers lock", st1 == 200 and st2 == 200, f"{st1}/{st2} {str(r1)[:120]}")
        st3, r3 = call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "C", "elapsed_ms": 2500}, token=carol_tok)
        check("third answer triggers all-answered reveal", st3 == 200 and r3.get("all_answered") and r3.get("reveal"), str(r3)[:200])
        # duplicate blocked
        st4, r4 = call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "D"}, token=ada_tok)
        check("duplicate answer blocked", st4 == 400, str(r4)[:160])
        await asyncio.gather(bob_task, ada_task)

    await run_ws()
    kinds = [m.get("event") for m in ada_msgs]
    check("ada received room_state", "room_state" in kinds, str(kinds)[:200])
    check("ada received room_chat from bob", any(m.get("event") == "room_chat" and m.get("data", {}).get("body") == "hello room! what topic is Q1?" for m in ada_msgs), str(ada_msgs)[:240])
    check("chat persisted", any(m.get("event") == "room_chat" for m in bob_msgs), str([m.get("event") for m in bob_msgs])[:200])
    check("WS saw reveal broadcast", any(m.get("event") == "room_reveal" for m in ada_msgs + bob_msgs), str(kinds)[:200])

    # host kicks carol, then runs the rest
    st, s = call("POST", f"/api/rooms/{room_id}/kick/{c['profile']['id']}", token=ada_tok)
    check("host kicks carol", st == 200 and len(s["room"]["members"]) == 2, str(s)[:200])
    st, s = call("POST", f"/api/rooms/{room_id}/kick/{b['profile']['id']}", token=bob_tok)
    check("guest cannot kick", st == 403, str(s)[:160])

    finished = None
    for i in range(4):
        st, s = call("POST", f"/api/rooms/{room_id}/next", token=ada_tok)
        if st != 200:
            break
        if s.get("finish"):
            finished = s["finish"]
            break
        # answer the fresh question so scoring works
        call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "A", "elapsed_ms": 1200}, token=ada_tok)
        call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "B", "elapsed_ms": 1600}, token=bob_tok)
    check("room run finishes with standings", bool(finished) and len(finished.get("standings", [])) == 2, str(finished)[:240])
    check("finish grants rewards", bool(finished) and any(r.get("xp") for r in finished.get("rewards", [])), str(finished)[:240])

    st, s = call("GET", "/api/rooms/mine", token=bob_tok)
    check("bob sees finished room gone from active list", st == 200 and all(r["id"] != room_id for r in s.get("rooms", [])), str(s)[:200])
    st, s = call("GET", f"/api/rooms/{room_id}/messages", token=ada_tok)
    check("room messages replay", st == 200 and len(s.get("messages", [])) >= 1, str(s)[:200])

    # capacity guard: fill a room to 15 then reject 16th
    st, s = call("POST", "/api/rooms", body={"title": "Capacity", "question_count": 3}, token=ada_tok)
    cap_room = s.get("room", {})
    toks = [bob_tok, carol_tok]
    for i in range(13):
        stx, sx = register(f"cap{SUF}{i}", f"+234802{SUF}{i:03d}", "secret123", f"Cap Player {i}")
        if stx == 200:
            toks.append(sx["token"])
    joined = 2  # ada(host) + ...
    for tok in toks[:14]:
        stj, _ = call("POST", f"/api/rooms/join/{cap_room['code']}", token=tok)
        if stj == 200:
            joined += 1
    st, s = call("GET", f"/api/rooms/{cap_room['id']}", token=ada_tok)
    check("room capped at 15 members", st == 200 and len(s["room"]["members"]) <= 15, str(len(s.get("room", {}).get("members", [])))[:120])
    stx, sx = register(f"cap15{SUF}", f"+2348029{SUF}99", "secret123", "Cap Fifteen")
    if stx == 200:
        st16, s16 = call("POST", f"/api/rooms/join/{cap_room['code']}", token=sx["token"])
        check("16th player rejected", st16 == 400, str(s16)[:160])

    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED:", *FAILED, sep="\n  - ")
    raise SystemExit(1 if FAILED else 0)


asyncio.run(main())
