"""Sign in with a username (the part before the @) or the full email."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("CLOVER_DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "login.db"))

import app.main  # noqa: E402,F401  (registers every model)
from app.db import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.routers.admin import create_user, update_user  # noqa: E402
from app.routers.auth import login, username_of  # noqa: E402
from app.schemas import LoginIn, UserIn, UserPatch  # noqa: E402
from app.security import hash_password  # noqa: E402


class FakeResponse:
    def set_cookie(self, *a, **k):
        self.cookie = (a, k)


class UsernameLoginTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.admin = User(email="admin@9clover.gg", password_hash=hash_password("clover2026"), name="Admin", ign="DRE", role="admin")
        self.tobi = User(email="Tobi@9clover.gg".lower(), password_hash=hash_password("tobi-pass"), name="Tobi", ign="TOBI", role="player")
        self.db.add_all([self.admin, self.tobi])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def sign_in(self, **kw):
        return login(LoginIn(**kw), FakeResponse(), db=self.db)

    def test_username_is_enough(self):
        self.assertEqual(username_of("Admin@9Clover.gg"), "admin")
        self.assertEqual(self.sign_in(username="admin", password="clover2026")["user"]["id"], self.admin.id)
        self.assertEqual(self.sign_in(username="  TOBI ", password="tobi-pass")["user"]["id"], self.tobi.id)

    def test_full_email_and_old_clients_still_work(self):
        self.assertEqual(self.sign_in(username="admin@9clover.gg", password="clover2026")["user"]["id"], self.admin.id)
        self.assertEqual(self.sign_in(email="admin@9clover.gg", password="clover2026")["user"]["id"], self.admin.id)
        self.assertEqual(self.sign_in(email="admin", password="clover2026")["user"]["id"], self.admin.id)

    def test_wrong_details_fail_the_same_way(self):
        for kw in ({"username": "admin", "password": "nope"}, {"username": "nobody", "password": "clover2026"},
                   {"username": "adm", "password": "clover2026"}, {"username": "admin%", "password": "clover2026"},
                   {"username": "", "password": "clover2026"}):
            with self.assertRaises(HTTPException) as err:
                self.sign_in(**kw)
            self.assertEqual((err.exception.status_code, err.exception.detail), (401, "Wrong username or password"), kw)

    def test_old_duplicate_usernames_use_the_password_then_the_email(self):
        other = User(email="admin@gmail.com", password_hash=hash_password("other-pass"), name="Other", role="player")
        self.db.add(other)
        self.db.commit()
        self.assertEqual(self.sign_in(username="admin", password="other-pass")["user"]["id"], other.id)
        self.assertEqual(self.sign_in(username="admin", password="clover2026")["user"]["id"], self.admin.id)
        other.password_hash = hash_password("clover2026")
        self.db.commit()
        with self.assertRaises(HTTPException) as err:
            self.sign_in(username="admin", password="clover2026")
        self.assertEqual(err.exception.status_code, 409)
        self.assertEqual(self.sign_in(username="admin@gmail.com", password="clover2026")["user"]["id"], other.id)

    def test_new_and_edited_accounts_keep_usernames_unique(self):
        with self.assertRaises(HTTPException) as err:
            create_user(UserIn(email="tobi@gmail.com", name="Copy", role="player", password="x"), db=self.db, user=self.admin)
        self.assertEqual(err.exception.status_code, 409)
        self.assertIn('"tobi" is taken', err.exception.detail)
        made = create_user(UserIn(email="kaze@9clover.gg", name="Kaze", role="player", password="kaze-pass"), db=self.db, user=self.admin)
        self.assertEqual(self.sign_in(username="kaze", password="kaze-pass")["user"]["id"], made["id"])
        with self.assertRaises(HTTPException):
            update_user(made["id"], UserPatch(email="TOBI@other.gg"), db=self.db, user=self.admin)
        # keeping your own username with a new domain is fine
        update_user(made["id"], UserPatch(email="kaze@newmail.gg"), db=self.db, user=self.admin)
        self.assertEqual(self.sign_in(username="kaze", password="kaze-pass")["user"]["id"], made["id"])


if __name__ == "__main__":
    unittest.main()
