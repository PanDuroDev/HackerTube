"""يبني sitemap.xml و robots.txt من بيانات الموقع الجاهزة."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data"
HN_DATA = DATA / "hacker-news"
SITE_URL = "https://pandurodev.github.io/HackerTube/"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    meta = load_json(DATA / "meta.json")
    main_videos = load_json(DATA / "videos.json")
    hn_videos = load_json(HN_DATA / "videos.json")
    lastmod = str(meta.get("generated_at", ""))[:10] or dt.date.today().isoformat()

    paths = ["", "#/categories", "#/channels", "#/playlists", "#/hacker-news", "#/longs"]
    paths.extend(f"#/?topics={quote(topic['id'])}" for topic in meta.get("topics", []))
    paths.extend(f"#/playlist/{quote(playlist['id'])}" for playlist in meta.get("playlists", []))
    paths.extend(f"#/watch/{quote(video['id'])}" for video in main_videos)
    paths.extend(f"#/hn-watch/{quote(video['vid'])}" for video in hn_videos)

    seen = set()
    urls = []
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        urls.append(
            "  <url>\n"
            f"    <loc>{escape(SITE_URL + path)}</loc>\n"
            f"    <lastmod>{lastmod}</lastmod>\n"
            "  </url>"
        )

    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )
    (PUBLIC / "sitemap.xml").write_text(sitemap, encoding="utf-8", newline="\n")
    (PUBLIC / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}sitemap.xml\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Wrote {len(urls)} sitemap URLs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
