"""يبني ملفات الموقع من data/raw: public/data/videos.json و meta.json."""

import datetime as dt
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from .classify import TOPIC_LABELS, classify, is_episode
from .config import CHANNEL_LANG, MIN_DURATION

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PLAYLIST_RAW = ROOT / "data" / "playlists"
OUT = ROOT / "public" / "data"


def load_raw() -> list[dict]:
    if not RAW.exists():
        raise SystemExit("لا توجد بيانات. شغّل: python -m pipeline.fetch")
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(RAW.glob("*.json"))]


_BIDI = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")


def clean_name(name: str) -> str:
    """أسماء يوتيوب تأتي أحيانًا برموز اتجاه مخفية تُفسد العرض."""
    return re.sub(r"\s+", " ", _BIDI.sub("", name or "")).strip()


def build_records(payloads: list[dict]) -> list[dict]:
    records: dict[str, dict] = {}

    for payload in payloads:
        channel = clean_name(payload.get("channel") or payload["channel_id"])
        lang = payload.get("lang") or CHANNEL_LANG.get(payload["channel_id"], "ar")
        for e in payload.get("entries", []):
            title = (e.get("title") or "").strip()
            duration = int(e.get("duration") or 0)
            views = int(e.get("views") or 0)
            ts = e.get("timestamp")
            year = dt.datetime.fromtimestamp(ts, dt.timezone.utc).year if ts else 0
            if (not title or duration < MIN_DURATION or "#shorts" in title.lower()
                    or e.get("is_broadcast")):
                continue

            rec = {
                "id": e["id"],
                "title": title,
                "channel": channel,
                "channel_id": payload["channel_id"],
                "views": views,
                "duration": duration,
                "year": year,
                **classify(title, duration, views, year),
            }
            description = (e.get("description") or "").strip()
            if description:
                rec["description"] = description
            rec["lang"] = lang  # لغة القناة أهم من لغة العنوان للتصفية
            kind = "course" if is_episode(title) and duration >= 600 else rec["kind"]
            rec["kind"] = kind
            prev = records.get(rec["id"])
            if not prev or rec["views"] > prev["views"]:
                records[rec["id"]] = rec

    # حقول البحث تُبنى في الواجهة من العنوان والقناة والمواضيع.

    # حلقة من سلسلة بلا كلمة مفتاحية: خذ الموضوع الغالب للقناة
    tagged = Counter()
    for rec in records.values():
        if rec["topics"]:
            tagged[rec["channel_id"]] += 1
    dominant: dict[str, str] = {}
    per_channel: dict[str, Counter] = defaultdict(Counter)
    for rec in records.values():
        for t in rec["topics"]:
            per_channel[rec["channel_id"]][t] += 1
    for cid, counts in per_channel.items():
        if tagged[cid] >= 3:
            dominant[cid] = counts.most_common(1)[0][0]

    keep = []
    for rec in records.values():
        if not rec["topics"] and is_episode(rec["title"]) and rec["channel_id"] in dominant:
            rec["topics"] = [dominant[rec["channel_id"]]]
        if rec["topics"]:
            keep.append(rec)

    keep.sort(key=lambda r: (-r["score"], -r["views"]))
    return keep


def load_playlists(records: list[dict], folder: Path = PLAYLIST_RAW) -> list[dict]:
    """قوائم أصحاب القنوات، مقتصرة على فيديوهات الفهرس وبترتيبها الأصلي."""
    if not folder.exists():
        return []
    by_id = {r["id"]: r for r in records}
    playlists = []
    seen = set()
    for path in sorted(folder.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        channel = clean_name(payload.get("channel") or payload["channel_id"])
        for pl in payload.get("playlists", []):
            ids = [vid for vid in pl.get("ids", []) if vid in by_id]
            if len(ids) < 2 or pl["id"] in seen:
                continue
            seen.add(pl["id"])
            playlists.append(
                {
                    "id": pl["id"],
                    "title": (pl.get("title") or "").strip() or "Playlist",
                    "channel_id": payload["channel_id"],
                    "channel": channel,
                    "ids": ids,
                }
            )
    playlists.sort(key=lambda p: (p["channel"].casefold(), p["title"].casefold()))
    return playlists


def build_meta(records: list[dict], payloads: list[dict], playlists: list[dict]) -> dict:
    topic_counts = Counter(t for r in records for t in r["topics"])
    channel_counts = Counter((r["channel_id"], r["channel"]) for r in records)
    lang_counts = Counter(r.get("lang", "ar") for r in records)
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "total": len(records),
        "total_hours": round(sum(r["duration"] for r in records) / 3600),
        "languages": dict(lang_counts),
        "channels": [
            {"id": cid, "name": name, "count": n}
            for (cid, name), n in channel_counts.most_common()
        ],
        "topics": [
            {"id": tid, "label": TOPIC_LABELS[tid], "count": topic_counts[tid]}
            for tid in TOPIC_LABELS
            if topic_counts[tid]
        ],
        "playlists": [
            {
                "id": p["id"],
                "title": p["title"],
                "channel_id": p["channel_id"],
                "channel": p["channel"],
                "count": len(p["ids"]),
                "cover": p["ids"][0],
            }
            for p in playlists
        ],
        "fetched_channels": len(payloads),
    }


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    payloads = load_raw()
    records = build_records(payloads)
    if not records:
        print("لا يوجد محتوى برمجي بعد التصفية.", file=sys.stderr)
        return 1
    playlists = load_playlists(records)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "videos.json").write_text(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (OUT / "playlists.json").write_text(
        json.dumps({p["id"]: p["ids"] for p in playlists}, separators=(",", ":")),
        encoding="utf-8",
    )
    (OUT / "meta.json").write_text(
        json.dumps(build_meta(records, payloads, playlists), ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(
        f"تم: {len(records)} فيديو من {len({r['channel_id'] for r in records})} قناة، "
        f"و{len(playlists)} قائمة جاهزة."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
