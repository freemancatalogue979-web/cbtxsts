"""Read-only Aerena client.

Aerena's public site currently uses Next.js server actions, not a documented
API. Discover their deployment-specific IDs from the site's public JavaScript
rather than treating one deployment's hashes as a stable API. No cookies,
account credentials, private draft data, or intermediary services are used.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any, Callable

logger = logging.getLogger("clover.aerena")

ORIGIN = "https://aerena.gg"
# The public page used by the site's own schedule client.
PAGE = ORIGIN + "/mobile-legends/schedule/mpl-ph/mpl-ph-s18"
USER_AGENT = "9Clover/1.0 (esports data; read-only)"
REQUIRED_ACTIONS = frozenset({"getSeries", "getSeasons", "getLeague", "getMatches", "getMatchStats", "getHeroes"})
OPTIONAL_ACTIONS = frozenset({"getLeagues"})
# Match one server-reference call exactly. A broad wildcard could accidentally
# pair an unrelated (possibly private) action ID with a later public name when
# minified calls are comma-separated.
ACTION_RE = re.compile(
    r'createServerReference\)\(\s*["\']([a-f0-9]{40,})["\']\s*,'
    r'\s*[^,;()]{1,100},\s*[^,;()]{1,100},\s*[^,;()]{1,100},'
    r'\s*["\'](getSeries|getSeasons|getLeague|getLeagues|getMatches|getMatchStats|getHeroes)["\']\s*\)'
)
# Some Next.js pages list client chunks only in inline Flight manifests rather
# than in script tags. Restrict this fallback to static chunk paths on our host.
CHUNK_RE = re.compile(r'(?<![A-Za-z0-9_/])(?:/_next/)?static/chunks/[A-Za-z0-9._%()/-]+\.js')
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_SCRIPT_BYTES = 5 * 1024 * 1024


class AerenaError(RuntimeError):
    """Safe-to-display description of a source or protocol failure."""


class _Scripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "script":
            source = dict(attrs).get("src")
            if source:
                self.sources.append(source)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        # Do not allow an upstream redirect to send requests to a different host.
        return None


def _http(url: str, *, method: str = "GET", body: bytes | None = None,
          headers: dict[str, str] | None = None, limit: int = MAX_RESPONSE_BYTES) -> bytes:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "aerena.gg" or parsed.port not in (None, 443):
        raise AerenaError("Aerena returned an unexpected endpoint.")
    req = urllib.request.Request(url, data=body, method=method, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=25) as response:
            result = response.read(limit + 1)
            if len(result) > limit:
                raise AerenaError("Aerena's response was too large to import safely.")
            return result
    except urllib.error.HTTPError as exc:
        raise AerenaError(f"Aerena returned HTTP {exc.code}.") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise AerenaError("Aerena could not be reached from this server.") from exc


def parse_flight(raw: bytes | str) -> Any:
    """Decode the JSON value returned by a read-only Next.js server action.

    The root is selected using the action pointer in record 0. Unsupported
    Flight records are rejected instead of silently storing malformed data.
    """
    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    except UnicodeDecodeError as exc:
        raise AerenaError("Aerena returned an unreadable response.") from exc
    records: dict[str, Any] = {}
    for line in text.splitlines():
        key, separator, value = line.partition(":")
        if not separator or not re.fullmatch(r"[0-9a-f]+", key):
            continue
        try:
            records[key] = json.loads(value)
        except json.JSONDecodeError:
            # Flight error records start with E; never treat them as an empty result.
            records[key] = None
    header = records.get("0")
    pointer = header.get("a") if isinstance(header, dict) else None
    if not isinstance(pointer, str) or not re.fullmatch(r"\$@[0-9a-f]+", pointer):
        raise AerenaError("Aerena's response format changed; the feed needs review.")
    root_key = pointer[2:]
    if root_key not in records or records[root_key] is None:
        raise AerenaError("Aerena could not return the requested data.")

    def resolve(value: Any, seen: frozenset[str] = frozenset()) -> Any:
        if isinstance(value, list):
            return [resolve(item, seen) for item in value]
        if isinstance(value, dict):
            return {key: resolve(item, seen) for key, item in value.items()}
        if isinstance(value, str):
            if value.startswith("$$"):
                return value[1:]
            if value == "$undefined":
                return None
            if value.startswith("$D"):
                return value[2:]
            if re.fullmatch(r"\$(?:@)?[0-9a-f]+", value):
                ref = value[2:] if value.startswith("$@") else value[1:]
                if ref in seen or ref not in records or records[ref] is None:
                    raise AerenaError("Aerena returned unsupported linked data.")
                return resolve(records[ref], seen | {ref})
        return value

    return resolve(records[root_key], frozenset({root_key}))


class AerenaClient:
    """A bounded client for just the public data displayed on Aerena."""

    def __init__(self, transport: Callable[..., bytes] = _http) -> None:
        self._transport = transport
        self._actions: dict[str, str] = {}
        self._discovered_at = 0.0
        self._lock = threading.Lock()

    def discover(self, *, force: bool = False) -> dict[str, str]:
        with self._lock:
            if not force and REQUIRED_ACTIONS.issubset(self._actions) and time.monotonic() - self._discovered_at < 3600:
                return dict(self._actions)
            try:
                html = self._transport(PAGE, limit=MAX_SCRIPT_BYTES).decode("utf-8")
            except UnicodeDecodeError as exc:
                raise AerenaError("Aerena's public page could not be read.") from exc
            parser = _Scripts()
            parser.feed(html)
            # Flight manifests may list `static/chunks/...` without leading
            # `/_next/`; these are public assets on the same fixed origin.
            manifest_sources = [path if path.startswith("/_next/") else "/_next/" + path
                                for path in CHUNK_RE.findall(html)]
            sources: list[str] = []
            for source in [*parser.sources, *manifest_sources]:
                try:
                    url = urllib.parse.urljoin(ORIGIN, source)
                    parsed = urllib.parse.urlsplit(url)
                    port = parsed.port
                except ValueError:
                    continue
                decoded_path = urllib.parse.unquote(parsed.path)
                if (parsed.scheme == "https" and parsed.hostname == "aerena.gg"
                        and port in (None, 443) and not parsed.username and not parsed.password
                        and decoded_path.startswith("/_next/static/") and decoded_path.endswith(".js")
                        and not any(part in (".", "..") for part in decoded_path.split("/"))):
                    clean = urllib.parse.urlunsplit(("https", "aerena.gg", parsed.path, "", ""))
                    if clean not in sources:
                        sources.append(clean)
            # Current deployment keeps the read-only action wrappers together.
            # The remaining scripts are checked too if chunk names change.
            sources.sort(key=lambda source: 0 if "/5659-" in source else 1)
            actions: dict[str, str] = {}
            for source in sources[:60]:
                script = self._transport(source, limit=MAX_SCRIPT_BYTES).decode("utf-8", errors="replace")
                actions.update({name: action_id for action_id, name in ACTION_RE.findall(script)})
                if REQUIRED_ACTIONS.issubset(actions) and OPTIONAL_ACTIONS.issubset(actions):
                    break
            if not REQUIRED_ACTIONS.issubset(actions):
                raise AerenaError("Aerena changed its public data interface; the feed needs review.")
            self._actions = actions
            self._discovered_at = time.monotonic()
            return dict(actions)

    def call(self, action: str, args: list[Any]) -> Any:
        if action not in REQUIRED_ACTIONS | OPTIONAL_ACTIONS:
            raise AerenaError("That Aerena action is not allowed.")
        actions = self.discover()
        if action not in actions:
            raise AerenaError("Aerena does not provide that catalog in this deployment.")
        body = json.dumps(args, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        for attempt in range(2):
            try:
                data = self._transport(
                    PAGE, method="POST", body=body,
                    headers={"Next-Action": actions[action], "Accept": "text/x-component", "Content-Type": "text/plain;charset=UTF-8"},
                    limit=MAX_RESPONSE_BYTES,
                )
                return parse_flight(data)
            except AerenaError as exc:
                # A Next.js deployment can invalidate action IDs without warning.
                # Rediscover only on a protocol/HTTP failure, never on connectivity failure.
                if attempt or not any(s in str(exc) for s in ("HTTP 404", "HTTP 500", "format changed", "requested data")):
                    raise
                actions = self.discover(force=True)
                if action not in actions:
                    raise AerenaError("Aerena changed its public data interface; the feed needs review.") from exc
        raise AerenaError("Aerena could not return the requested data.")

    def series(self) -> list[dict]:
        return self._list("getSeries", [])

    def seasons(self) -> list[dict]:
        return self._list("getSeasons", [])

    def leagues(self) -> list[dict]:
        return self._list("getLeagues", [])

    def heroes(self) -> list[dict]:
        return self._list("getHeroes", [])

    def league(self, league_id: str) -> dict:
        result = self.call("getLeague", [league_id])
        if not isinstance(result, dict) or result.get("_id") != league_id:
            raise AerenaError("Aerena returned an unexpected league record.")
        return result

    def matches(self, league_id: str) -> list[dict]:
        return self._list("getMatches", [{"league": league_id}])

    def match_stats(self, match_id: str) -> dict:
        result = self.call("getMatchStats", [match_id])
        if not isinstance(result, dict) or not isinstance(result.get("match"), dict) or result["match"].get("matchId") != match_id:
            raise AerenaError("Aerena returned an unexpected match record.")
        if not isinstance(result.get("playerGameStats"), list):
            raise AerenaError("Aerena returned an unexpected player-stat record.")
        return result

    def _list(self, action: str, args: list[Any]) -> list[dict]:
        result = self.call(action, args)
        if not isinstance(result, list) or any(not isinstance(item, dict) for item in result):
            raise AerenaError("Aerena returned an unexpected catalog format.")
        return result


client = AerenaClient()
