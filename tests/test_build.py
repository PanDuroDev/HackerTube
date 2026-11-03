from pipeline.build import build_meta, build_records


def entry(vid, title, duration=900, views=1000):
    return {"id": vid, "title": title, "duration": duration, "views": views, "timestamp": None}


def payload(entries, channel_id="UC1", channel="قناة تجريبية"):
    return {"channel_id": channel_id, "channel": channel, "entries": entries}


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
    meta = build_meta(records, [payload([])])
    assert meta["total"] == 2
    assert meta["channels"][0]["count"] == 2
    assert {t["id"] for t in meta["topics"]} == {"python", "web"}


def test_search_text_is_normalized():
    records = build_records([payload([entry("a", "دورة بايثون")])])
    assert records[0]["search"] == "دوره بايثون قناه تجريبيه"
