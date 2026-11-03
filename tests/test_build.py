from pipeline.build import build_meta, build_records, load_playlists


def entry(vid, title, duration=900, views=1000):
    return {"id": vid, "title": title, "duration": duration, "views": views, "timestamp": None}


def payload(entries, channel_id="UC1", channel="قناة تجريبية", lang="ar"):
    return {"channel_id": channel_id, "channel": channel, "lang": lang, "entries": entries}


def test_build_filters_and_dedupes():
    entries = [
        entry("a", "دورة بايثون للمبتدئين"),
        entry("b", "فيديو قصير جدًا", duration=30),
        entry("c", "فيديو جديد على القناة"),
        entry("d", "شرح React للمبتدئين", views=5000),
        entry("d", "شرح React للمبتدئين", views=9000),
    ]
    records = build_records([payload(entries)])
    ids = [r["id"] for r in records]
    assert "b" not in ids and "c" not in ids
    assert ids.count("d") == 1
    assert next(r for r in records if r["id"] == "d")["views"] == 9000


def test_build_excludes_completed_broadcasts_and_shorts():
    broadcast = entry("live", "شرح برمجة كامل")
    broadcast["is_broadcast"] = True
    records = build_records([payload([
        entry("normal", "دورة بايثون للمبتدئين"),
        broadcast,
        entry("short", "شرح #Shorts لبايثون"),
    ])])
    assert {record["id"] for record in records} == {"normal"}


def test_episode_inherits_channel_topic():
    entries = [
        entry("1", "دورة بايثون - الحلقة 1"),
        entry("2", "دورة بايثون - الحلقة 2"),
        entry("3", "دورة بايثون - الحلقة 3"),
        entry("4", "الحلقة 4: المتغيرات"),
    ]
    records = {r["id"]: r for r in build_records([payload(entries)])}
    assert records["4"]["topics"] == ["python"]


def test_meta_counts():
    records = build_records([payload([
        entry("a", "دورة بايثون"),
        entry("b", "شرح React للمبتدئين"),
    ])])
    meta = build_meta(records, [payload([])], [])
    assert meta["total"] == 2
    assert meta["channels"][0]["count"] == 2
    assert meta["languages"] == {"ar": 2}
    assert {t["id"] for t in meta["topics"]} == {"python", "web"}


def test_channel_language_wins_over_title():
    records = build_records([payload(
        [entry("a", "Python for beginners")],
        channel_id="UC_EN",
        channel="Fireship",
        lang="en",
    )])
    assert records[0]["lang"] == "en"
    meta = build_meta(records, [], [])
    assert meta["languages"] == {"en": 1}


def test_playlists_keep_only_indexed_videos(tmp_path):
    import json

    records = build_records([payload([
        entry("a", "دورة بايثون"),
        entry("b", "شرح React للمبتدئين"),
    ])])
    (tmp_path / "ch.json").write_text(json.dumps({
        "channel_id": "UC1",
        "channel": "قناة تجريبية",
        "playlists": [
            {"id": "PL1", "title": "بايثون", "ids": ["a", "missing", "b"]},
            {"id": "PL2", "title": "قصيرة", "ids": ["a"]},
        ],
    }), encoding="utf-8")
    lists = load_playlists(records, tmp_path)
    assert [p["id"] for p in lists] == ["PL1"]
    assert lists[0]["ids"] == ["a", "b"]
