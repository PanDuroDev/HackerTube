import json
from pathlib import Path

import pytest

from pipeline.classify import TOPIC_LABELS

ROOT = Path(__file__).resolve().parent.parent
VIDEOS = ROOT / "public" / "data" / "videos.json"
META = ROOT / "public" / "data" / "meta.json"


@pytest.mark.skipif(not VIDEOS.exists(), reason="الفهرس غير مبني بعد")
def test_built_dataset_schema():
    videos = json.loads(VIDEOS.read_text(encoding="utf-8"))
    meta = json.loads(META.read_text(encoding="utf-8"))
    required = {"id", "title", "channel", "channel_id", "views", "duration",
                "year", "topics", "level", "kind", "lang", "score"}

    assert len(videos) == meta["total"] > 0
    assert len({v["id"] for v in videos}) == len(videos)
    for v in videos:
        assert required <= v.keys()
        assert v["duration"] >= 60
        assert v["topics"] and set(v["topics"]) <= set(TOPIC_LABELS)
        assert v["level"] in {"beginner", "advanced", "any", "unknown"}
        assert v["kind"] in {"course", "tutorial", "project", "talk", "short"}
        assert "search" not in v
        assert 0 <= v["year"] <= 2030



def test_site_payload_budget():
    hn_dir = ROOT / "public" / "data" / "hacker-news"
    assets = ROOT / "data" / "hacker-news"
    preview = hn_dir / "videos-preview.json"

    assert VIDEOS.stat().st_size < 6_200_000
    assert (hn_dir / "videos.json").stat().st_size < 9_000_000
    assert preview.stat().st_size < 200_000
    assert not (hn_dir / "embeddings.npy").exists()
    assert not (hn_dir / "embedding_ids.json").exists()
    assert not (hn_dir / "taxonomy.json").exists()
    assert (assets / "embeddings.npy").is_file()
    assert (assets / "taxonomy.json").is_file()



def test_sitemap_and_robots_are_generated():
    sitemap = (ROOT / "public" / "sitemap.xml").read_text(encoding="utf-8")
    robots = (ROOT / "public" / "robots.txt").read_text(encoding="utf-8")

    assert sitemap.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' in sitemap
    assert "https://pandurodev.github.io/HackerTube/#/watch/" in sitemap
    assert "https://pandurodev.github.io/HackerTube/#/hn-watch/" in sitemap
    assert "https://pandurodev.github.io/HackerTube/#/?topics=web" in sitemap
    assert "Sitemap: https://pandurodev.github.io/HackerTube/sitemap.xml" in robots
    assert "User-agent: *" in robots


def test_level_and_language_distributions_are_meaningful():
    from collections import Counter

    videos = json.loads(VIDEOS.read_text(encoding="utf-8"))
    levels = Counter(video["level"] for video in videos)
    total = len(videos)

    assert levels["beginner"] > 0
    assert levels["advanced"] > 0
    assert levels["unknown"] < total * 0.7
    assert len(levels) >= 3
    meta = json.loads(META.read_text(encoding="utf-8"))
    assert meta["languages"]["ar"] > 0
    assert meta["languages"]["en"] > 0
