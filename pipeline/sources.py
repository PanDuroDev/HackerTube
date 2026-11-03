"""مصادر بيانات يوتيوب مع بدائل: Data API ثم yt-dlp ثم YouTube.js.

كل مصدر يعيد نفس الشكل: {channel_id, channel, entries: [...]}. عند فشل مصدر
ننتقل للتالي، فلا توقف خدمة واحدة بناء الفهرس.
"""

import datetime as dt
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
YTJS = ROOT / "pipeline" / "ytjs" / "fetch.mjs"
API_KEY_ENV = "YOUTUBE_API_KEY"


class FetchError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, reason: str | None = None):
        super().__init__(message)
        self.status = status
        self.reason = reason


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """تحميل بسيط لملف .env بلا تبعيات؛ لا يطغى على متغيرات البيئة."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def api_key(explicit: str | None = None) -> str:
    load_dotenv()
    return (explicit or os.environ.get(API_KEY_ENV) or "").strip()


def _get_json(url: str) -> dict:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")
            reason = None
            try:
                error = json.loads(detail).get("error") or {}
                message = error.get("message") or detail[:200]
                reason = next(
                    (item.get("reason") for item in error.get("errors", []) if item.get("reason")),
                    None,
                )
            except (TypeError, ValueError):
                message = detail[:200]
            if exc.code < 500 or attempt == 2:
                raise FetchError(
                    f"HTTP {exc.code}: {message}", status=exc.code, reason=reason
                ) from exc
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < 2:
            time.sleep(1.5 * (attempt + 1))
    raise FetchError(str(getattr(last_error, "reason", last_error))) from last_error


def _api_get(endpoint: str, params: dict) -> dict:
    qs = urllib.parse.urlencode(params)
    return _get_json(f"https://www.googleapis.com/youtube/v3/{endpoint}?{qs}")


def parse_iso_duration(value: str) -> int:
    """PT1H2M3S → 3723. البث المباشر P0D يعيد 0."""
    match = re.fullmatch(
        r"P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", value or ""
    )
    if not match:
        return 0
    weeks, days, hours, minutes, seconds = (int(g or 0) for g in match.groups())
    return weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds


def _timestamp(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def fetch_with_api(channel_id: str, name: str, limit: int, key: str) -> dict:
    channel = _api_get(
        "channels", {"part": "contentDetails,snippet", "id": channel_id, "key": key}
    )
    items = channel.get("items") or []
    if not items:
        raise FetchError("channel not found")
    uploads = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

    ids: list[str] = []
    token = None
    while len(ids) < limit:
        params = {
            "part": "contentDetails",
            "playlistId": uploads,
            "maxResults": 50,
            "key": key,
        }
        if token:
            params["pageToken"] = token
        page = _api_get("playlistItems", params)
        ids += [
            item["contentDetails"]["videoId"]
            for item in page.get("items") or []
            if item.get("contentDetails", {}).get("videoId")
        ]
        token = page.get("nextPageToken")
        if not token:
            break

    entries = []
    video_ids = ids[:limit]
    for start in range(0, len(video_ids), 50):
        chunk = video_ids[start : start + 50]
        data = _api_get(
            "videos",
            {
                "part": "snippet,contentDetails,statistics,liveStreamingDetails",
                "id": ",".join(chunk),
                "key": key,
            },
        )
        for item in data.get("items") or []:
            snippet = item.get("snippet") or {}
            if snippet.get("liveBroadcastContent") in ("live", "upcoming"):
                continue
            entries.append(
                {
                    "id": item["id"],
                    "title": snippet.get("title") or "",
                    "duration": parse_iso_duration(
                        (item.get("contentDetails") or {}).get("duration", "")
                    ),
                    "views": int((item.get("statistics") or {}).get("viewCount") or 0),
                    "timestamp": _timestamp(snippet.get("publishedAt")),
                    "is_broadcast": bool(item.get("liveStreamingDetails"))
                    or snippet.get("liveBroadcastContent") in ("live", "upcoming"),
                    "url": f"https://www.youtube.com/watch?v={item['id']}",
                }
            )

    return {
        "channel_id": channel_id,
        "channel": items[0]["snippet"].get("title") or name,
        "entries": entries,
    }


def fetch_with_ytdlp(channel_id: str, name: str, limit: int) -> dict:
    url = f"https://www.youtube.com/channel/{channel_id}/videos"
    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        str(limit),
        "--extractor-args",
        "youtubetab:approximate_date",
        "--no-warnings",
        "--ignore-errors",
        url,
    ]
    out = subprocess.run(cmd, capture_output=True, timeout=900)
    if out.returncode != 0 and not out.stdout.strip():
        raise FetchError(out.stderr.decode("utf-8", "ignore")[-400:])
    data = json.loads(out.stdout.decode("utf-8"))

    entries = []
    for e in data.get("entries") or []:
        if not e or not e.get("id"):
            continue
        live_status = e.get("live_status")
        if live_status in ("is_live", "is_upcoming"):
            continue
        is_broadcast = bool(
            e.get("is_live") or e.get("was_live")
            or live_status in ("was_live", "post_live")
        )
        entries.append(
            {
                "id": e["id"],
                "title": e.get("title") or "",
                "duration": int(e.get("duration") or 0),
                "views": int(e.get("view_count") or 0),
                "timestamp": e.get("timestamp"),
                "is_broadcast": is_broadcast,
                "url": f"https://www.youtube.com/watch?v={e['id']}",
            }
        )
    return {
        "channel_id": channel_id,
        "channel": data.get("channel") or name,
        "entries": entries,
    }


def fetch_with_youtubei(channel_id: str, name: str, limit: int) -> dict:
    """YouTube.js بلا مفتاح ولا حصة API؛ يحتاج node وnpm install داخل pipeline/ytjs."""
    if not YTJS.exists():
        raise FetchError("missing pipeline/ytjs/fetch.mjs")
    try:
        out = subprocess.run(
            ["node", str(YTJS), channel_id, str(limit), name],
            capture_output=True,
            timeout=900,
        )
    except FileNotFoundError as exc:
        raise FetchError("node is not installed") from exc
    if out.returncode != 0 or not out.stdout.strip():
        raise FetchError(out.stderr.decode("utf-8", "ignore").strip()[-400:])
    return json.loads(out.stdout.decode("utf-8"))


SOURCES = {
    "api": fetch_with_api,
    "yt-dlp": fetch_with_ytdlp,
    "youtubei": fetch_with_youtubei,
}


def fetch_with_fallback(
    channel_id: str, name: str, limit: int, order: list[str], key: str
) -> tuple[dict, str, list[str]]:
    """يعيد (payload, source, errors). يرفع FetchError إذا فشلت كل المصادر."""
    errors: list[str] = []
    for source in order:
        fetch = SOURCES.get(source)
        if not fetch:
            errors.append(f"{source}: unknown source")
            continue
        if source == "api" and not key:
            errors.append("api: no YOUTUBE_API_KEY")
            continue
        try:
            if source == "api":
                payload = fetch(channel_id, name, limit, key)
            else:
                payload = fetch(channel_id, name, limit)
            if not payload.get("entries"):
                raise FetchError("no entries")
            return payload, source, errors
        except Exception as exc:  # المصدر التالي هو الخطة
            errors.append(f"{source}: {exc}")
    raise FetchError(" | ".join(errors))
