import json
from pathlib import Path

import pytest

from pipeline.classify import TOPIC_LABELS
from pipeline.normalize import normalize_ar

ROOT = Path(__file__).resolve().parent.parent
VIDEOS = ROOT / "public" / "data" / "videos.json"
META = ROOT / "public" / "data" / "meta.json"


@pytest.mark.skipif(not VIDEOS.exists(), reason="الفهرس غير مبني بعد")
def test_built_dataset_schema():
    videos = json.loads(VIDEOS.read_text(encoding="utf-8"))
    meta = json.loads(META.read_text(encoding="utf-8"))
    required = {"id", "title", "channel", "channel_id", "views", "duration",
                "year", "topics", "level", "kind", "lang", "score", "search"}

    assert len(videos) == meta["total"] > 0
    assert len({v["id"] for v in videos}) == len(videos)
    for v in videos:
        assert required <= v.keys()
        assert v["duration"] >= 60
        assert v["topics"] and set(v["topics"]) <= set(TOPIC_LABELS)
        assert v["level"] in {"beginner", "advanced", "any"}
        assert v["kind"] in {"course", "tutorial", "project", "talk", "short"}
        assert v["search"] == normalize_ar(f"{v['title']} {v['channel']}")
        assert 0 <= v["year"] <= 2030
