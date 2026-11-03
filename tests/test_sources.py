from pipeline import sources
from pipeline.config import CHANNEL_LANG, CHANNELS
from pipeline.sources import FetchError, fetch_with_fallback, parse_iso_duration


def test_iso_durations():
    assert parse_iso_duration("PT1H2M3S") == 3723
    assert parse_iso_duration("PT15M") == 900
    assert parse_iso_duration("P1DT1H") == 90000
    assert parse_iso_duration("P0D") == 0
    assert parse_iso_duration("") == 0


def test_fallback_uses_next_source(monkeypatch):
    calls = []

    def broken(cid, name, limit, key):
        calls.append("broken")
        raise FetchError("down")

    def empty(cid, name, limit):
        calls.append("empty")
        return {"channel_id": cid, "channel": name, "entries": []}

    def works(cid, name, limit):
        calls.append("works")
        return {
            "channel_id": cid,
            "channel": name,
            "entries": [{"id": "v", "title": "t"}],
        }

    monkeypatch.setitem(sources.SOURCES, "api", broken)
    monkeypatch.setitem(sources.SOURCES, "yt-dlp", empty)
    monkeypatch.setitem(sources.SOURCES, "youtubei", works)
    payload, source, errors = fetch_with_fallback(
        "UC1", "Test", 5, ["api", "yt-dlp", "youtubei"], "key"
    )
    assert source == "youtubei"
    assert payload["entries"][0]["id"] == "v"
    assert calls == ["broken", "empty", "works"]
    assert len(errors) == 2


def test_fallback_without_key_skips_api(monkeypatch):
    monkeypatch.setitem(
        sources.SOURCES,
        "yt-dlp",
        lambda cid, name, limit: {"channel_id": cid, "channel": name, "entries": [{"id": "v"}]},
    )
    _, source, errors = fetch_with_fallback("UC1", "Test", 1, ["api", "yt-dlp"], "")
    assert source == "yt-dlp"
    assert errors == ["api: no YOUTUBE_API_KEY"]


def test_channel_ids_unique_and_tagged():
    ids = [cid for cid, _ in CHANNELS]
    assert len(ids) == len(set(ids))
    assert CHANNEL_LANG["UCSNkfKl4cU-55Nm-ovsvOHQ"] == "ar"
    assert CHANNEL_LANG["UC8butISFwT-Wl7EV0hUK0BQ"] == "en"
