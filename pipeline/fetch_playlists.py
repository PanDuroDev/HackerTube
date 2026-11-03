"""يجلب قوائم تشغيل القنوات الجاهزة (التي أنشأها أصحابها) عبر YouTube Data API.

يحفظ لكل قناة data/playlists/<channel_id>.json فيه بيانات الفيديوهات مرة واحدة
وقوائم التشغيل كمعرّفات مرتّبة، حتى لا تتكرر البيانات في كل قائمة.
"""

import argparse
import datetime as dt
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .config import CHANNELS, CHANNEL_LANG
from .sources import FetchError, _api_get, _timestamp, api_key, parse_iso_duration

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "playlists"


def list_playlists(channel_id: str, key: str) -> list[dict]:
    items: list[dict] = []
    token = None
    while True:
        params = {
            "part": "snippet,contentDetails",
            "channelId": channel_id,
            "maxResults": 50,
            "key": key,
        }
        if token:
            params["pageToken"] = token
        page = _api_get("playlists", params)
        items += page.get("items") or []
        token = page.get("nextPageToken")
        if not token:
            return items


def playlist_video_ids(playlist_id: str, key: str, limit: int) -> list[str]:
    ids: list[str] = []
    token = None
    while len(ids) < limit:
        params = {
            "part": "contentDetails",
            "playlistId": playlist_id,
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
    return ids[:limit]


def video_details(ids: list[str], key: str) -> dict[str, dict]:
    videos: dict[str, dict] = {}
    for start in range(0, len(ids), 50):
        chunk = ids[start : start + 50]
        data = _api_get(
            "videos",
            {"part": "snippet,contentDetails,statistics", "id": ",".join(chunk), "key": key},
        )
        for item in data.get("items") or []:
            snippet = item.get("snippet") or {}
            if snippet.get("liveBroadcastContent") in ("live", "upcoming"):
                continue
            videos[item["id"]] = {
                "title": snippet.get("title") or "",
                "duration": parse_iso_duration(
                    (item.get("contentDetails") or {}).get("duration", "")
                ),
                "views": int((item.get("statistics") or {}).get("viewCount") or 0),
                "timestamp": _timestamp(snippet.get("publishedAt")),
            }
    return videos


def fetch_channel(channel_id: str, name: str, lang: str, key: str, limit: int, min_items: int) -> dict:
    playlists = []
    ids: list[str] = []
    for item in list_playlists(channel_id, key):
        pid = item["id"]
        title = (item.get("snippet") or {}).get("title") or ""
        try:
            video_ids = playlist_video_ids(pid, key, limit)
        except FetchError:
            continue  # قائمة محذوفة أو خاصة أثناء الجلب؛ لا تُسقط القناة كلها
        if len(video_ids) < min_items:
            continue
        playlists.append({"id": pid, "title": title, "ids": video_ids})
        ids += video_ids

    unique = list(dict.fromkeys(ids))
    return {
        "channel_id": channel_id,
        "channel": name,
        "lang": lang,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "videos": video_details(unique, key) if unique else {},
        "playlists": playlists,
    }


def fetch_and_write(cid: str, name: str, lang: str, key: str, limit: int, min_items: int) -> str:
    payload = fetch_channel(cid, name, lang, key, limit, min_items)
    (OUT / f"{cid}.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )
    total = sum(len(p["ids"]) for p in payload["playlists"])
    return (
        f"{name}: {len(payload['playlists'])} قائمة، "
        f"{len(payload['videos'])} فيديو، {total} عضوية"
    )


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="معرّف قناة واحدة أو جزء من اسمها")
    ap.add_argument("--limit", type=int, default=500, help="أقصى فيديو في القائمة")
    ap.add_argument("--min-items", type=int, default=3, help="أقل عدد فيديوهات لقبول القائمة")
    ap.add_argument("--jobs", type=int, default=4, help="عدد القنوات المتوازية")
    ap.add_argument("--force", action="store_true", help="أعد جلب القنوات المحفوظة")
    args = ap.parse_args()

    key = api_key()
    if not key:
        print("مطلوب YOUTUBE_API_KEY في .env أو البيئة.", file=sys.stderr)
        return 1
    channels = CHANNELS
    if args.only:
        needle = args.only.lower()
        channels = [c for c in channels if needle in c[0].lower() or needle in c[1].lower()]
        if not channels:
            print("لا توجد قناة مطابقة.", file=sys.stderr)
            return 1

    OUT.mkdir(parents=True, exist_ok=True)
    todo = []
    for cid, name in channels:
        if (OUT / f"{cid}.json").exists() and not args.force:
            print(f"{name}: موجود، تخطٍّ")
        else:
            todo.append((cid, name))

    done = 0
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = {
            pool.submit(
                fetch_and_write, cid, name, CHANNEL_LANG.get(cid, "ar"),
                key, args.limit, args.min_items,
            ): name
            for cid, name in todo
        }
        for future in as_completed(futures):
            done += 1
            name = futures[future]
            try:
                print(f"[{done}/{len(todo)}] {future.result()}", flush=True)
            except (FetchError, OSError) as exc:
                print(f"[{done}/{len(todo)}] {name}: فشل — {exc}", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
