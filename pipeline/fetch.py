"""جلب بيانات القنوات عبر yt-dlp إلى data/raw/.

لا يستخدم YouTube API ولا مفاتيح. البيانات: العنوان، المدة، المشاهدات، تاريخ تقريبي.
"""

import argparse
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path

from .config import CHANNELS, MAX_PER_CHANNEL

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def fetch_channel(channel_id: str, name: str, limit: int) -> dict:
    url = f"https://www.youtube.com/channel/{channel_id}/videos"
    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end", str(limit),
        "--extractor-args", "youtubetab:approximate_date",
        "--no-warnings",
        "--ignore-errors",
        url,
    ]
    out = subprocess.run(cmd, capture_output=True, timeout=900)
    if out.returncode != 0 and not out.stdout.strip():
        raise RuntimeError(out.stderr.decode("utf-8", "ignore")[-400:])
    data = json.loads(out.stdout.decode("utf-8"))

    entries = []
    for e in data.get("entries") or []:
        if not e or not e.get("id"):
            continue
        if e.get("live_status") in ("is_live", "is_upcoming"):
            continue
        entries.append({
            "id": e["id"],
            "title": e.get("title") or "",
            "duration": int(e.get("duration") or 0),
            "views": int(e.get("view_count") or 0),
            "timestamp": e.get("timestamp"),
            "url": f"https://www.youtube.com/watch?v={e['id']}",
        })
    return {
        "channel_id": channel_id,
        "channel": data.get("channel") or name,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "entries": entries,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=MAX_PER_CHANNEL)
    ap.add_argument("--only", help="channel_id واحد للاختبار")
    ap.add_argument("--sleep", type=float, default=1.5)
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    channels = [c for c in CHANNELS if not args.only or c[0] == args.only]
    failed = 0
    for i, (cid, name) in enumerate(channels, 1):
        try:
            payload = fetch_channel(cid, name, args.limit)
        except Exception as exc:  # قناة محذوفة/محجوبة لا توقف الباقي
            failed += 1
            print(f"[{i}/{len(channels)}] FAIL {name}: {exc}", file=sys.stderr)
            continue
        (RAW / f"{cid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print(f"[{i}/{len(channels)}] {name}: {len(payload['entries'])} فيديو")
        if i < len(channels):
            time.sleep(args.sleep)
    print(f"تم. فشلت {failed} قناة.")
    return 0 if failed < len(channels) else 1


if __name__ == "__main__":
    raise SystemExit(main())
