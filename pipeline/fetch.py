"""جلب بيانات القنوات إلى data/raw/ عبر عدة مصادر مع بدائل.

الترتيب الافتراضي: YouTube Data API (إن وُجد مفتاح)، ثم yt-dlp، ثم YouTube.js.
يمكن تغييره بـ --sources أو HT_FETCH_SOURCES. المفتاح يُقرأ من .env أو البيئة،
ولا يُكتب في المستودع.
"""

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

from .config import CHANNEL_LANG, CHANNELS, MAX_PER_CHANNEL
from .sources import FetchError, api_key, fetch_with_fallback

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DEFAULT_SOURCES = "api,yt-dlp,youtubei"


def parse_sources(value: str) -> list[str]:
    return [s.strip() for s in value.split(",") if s.strip()]


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=MAX_PER_CHANNEL)
    ap.add_argument("--only", help="channel_id واحد للاختبار")
    ap.add_argument("--sleep", type=float, default=0.3)
    ap.add_argument("--sources", default=os.environ.get("HT_FETCH_SOURCES", DEFAULT_SOURCES))
    ap.add_argument("--api-key", help="يتجاوز YOUTUBE_API_KEY (لا يُحفظ)")
    args = ap.parse_args()

    order = parse_sources(args.sources)
    key = api_key(args.api_key)
    RAW.mkdir(parents=True, exist_ok=True)
    channels = [c for c in CHANNELS if not args.only or c[0] == args.only]
    failed = 0
    used: dict[str, int] = {}

    for i, (cid, name) in enumerate(channels, 1):
        try:
            payload, source, attempts = fetch_with_fallback(cid, name, args.limit, order, key)
        except FetchError as exc:
            failed += 1
            print(f"[{i}/{len(channels)}] FAIL {name}: {exc}", file=sys.stderr)
            continue
        payload.update(
            channel_id=cid,
            lang=CHANNEL_LANG.get(cid, "ar"),
            source=source,
            fetched_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        )
        (RAW / f"{cid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        used[source] = used.get(source, 0) + 1
        note = f" (fallback after {', '.join(attempts)})" if attempts else ""
        print(f"[{i}/{len(channels)}] {name}: {len(payload['entries'])} via {source}{note}")
        if i < len(channels):
            time.sleep(args.sleep)

    summary = ", ".join(f"{src}={n}" for src, n in used.items()) or "none"
    print(f"Done. {len(channels) - failed}/{len(channels)} channels, {summary}.")
    return 0 if failed < len(channels) else 1


if __name__ == "__main__":
    raise SystemExit(main())
