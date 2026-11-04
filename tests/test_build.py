from pipeline.build import build_meta, build_records, load_playlist_hints, load_playlists


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


def test_channel_topic_fallback_for_known_channel():
    records = build_records([payload(
        [entry("a", "Introduction to the language")],
        channel_id="UCSp-OaMpsO8K0KkOqyBl7_w",
        channel="Let's Get Rusty",
        lang="en",
    )])
    assert records[0]["topics"] == ["rust"]


def test_playlist_hints_classify_video():
    records = build_records(
        [payload([entry("a", "Episode 4")], channel_id="UC_OTHER", lang="en")],
        hints={"a": ["Rust for beginners"]},
    )
    assert records[0]["topics"] == ["rust"]


def test_load_playlist_hints(tmp_path):
    import json

    (tmp_path / "ch.json").write_text(json.dumps({
        "playlists": [
            {"id": "PL1", "title": "Rust basics", "ids": ["a", "b"]},
            {"id": "PL2", "title": "Python basics", "ids": ["a"]},
        ],
    }), encoding="utf-8")
    hints = load_playlist_hints(tmp_path)
    assert hints["a"] == ["Rust basics", "Python basics"]
    assert hints["b"] == ["Rust basics"]


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


def test_description_is_used_but_not_shipped():
    records = build_records([payload([
        {"id": "a", "title": "دورة بايثون", "duration": 900, "views": 100,
         "description": "  وصف تفصيلي للفيديو  ", "timestamp": None},
    ])])
    assert "description" not in records[0]
    assert "tags" not in records[0]


def test_description_language_and_tags_are_used():
    records = build_records([payload([
        {
            "id": "a",
            "title": "Arabic title",
            "duration": 900,
            "views": 1000,
            "description": "This is a long English description about Python, projects, and beginner tutorials for everyone.",
            "tags": ["python", "programming"],
            "timestamp": None,
        },
    ], channel_id="UC_AR", channel="Arabic Channel", lang="ar")])
    record = records[0]
    assert record["lang"] == "en"
    assert record["lang_source"] == "description"
    assert "tags" not in record
    assert "python" in record["topics"]
