import io
import urllib.error

import pytest

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


def test_get_json_retries_5xx(monkeypatch):
    calls = {"n": 0}

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"ok": true}'

    def fake(url, timeout=20):
        calls["n"] += 1
        if calls["n"] < 3:
            raise urllib.error.HTTPError(
                url, 503, "busy", {}, io.BytesIO(b'{"error":{"message":"busy"}}')
            )
        return Resp()

    monkeypatch.setattr(sources.urllib.request, "urlopen", fake)
    monkeypatch.setattr(sources.time, "sleep", lambda seconds: None)
    assert sources._get_json("http://test") == {"ok": True}
    assert calls["n"] == 3


def test_get_json_does_not_retry_4xx(monkeypatch):
    calls = {"n": 0}

    def fake(url, timeout=20):
        calls["n"] += 1
        raise urllib.error.HTTPError(
            url, 403, "quota", {}, io.BytesIO(b'{"error":{"message":"quota","errors":[{"reason":"quotaExceeded"}]}}')
        )

    monkeypatch.setattr(sources.urllib.request, "urlopen", fake)
    monkeypatch.setattr(sources.time, "sleep", lambda seconds: None)
    with pytest.raises(FetchError, match="HTTP 403") as raised:
        sources._get_json("http://test")
    assert raised.value.status == 403
    assert raised.value.reason == "quotaExceeded"
    assert calls["n"] == 1


def test_api_marks_completed_live_stream(monkeypatch):
    responses = iter([
        {"items": [{
            "contentDetails": {"relatedPlaylists": {"uploads": "UU1"}},
            "snippet": {"title": "Test"},
        }]},
        {"items": [{"contentDetails": {"videoId": "archived-live"}}]},
        {"items": [{
            "id": "archived-live",
            "snippet": {"title": "Live recording", "liveBroadcastContent": "none"},
            "contentDetails": {"duration": "PT20M"},
            "liveStreamingDetails": {
                "actualStartTime": "2026-01-01T10:00:00Z",
                "actualEndTime": "2026-01-01T11:00:00Z",
            },
        }]},
    ])
    monkeypatch.setattr(sources, "_api_get", lambda endpoint, params: next(responses))
    result = sources.fetch_with_api("UC1", "Test", 1, "key")
    assert result["entries"][0]["id"] == "archived-live"
    assert result["entries"][0]["is_broadcast"] is True


def test_ytdlp_marks_archived_live_stream(monkeypatch):
    import json
    from types import SimpleNamespace
    payload = {
        "channel": "Test",
        "entries": [
            {"id": "archived-live", "title": "Live recording", "duration": 1200,
             "live_status": "was_live", "was_live": True},
            {"id": "normal", "title": "Regular video", "duration": 1200,
             "live_status": "not_live"},
        ],
    }
    completed = SimpleNamespace(returncode=0, stdout=json.dumps(payload).encode(), stderr=b"")
    monkeypatch.setattr(sources.subprocess, "run", lambda *args, **kwargs: completed)
    result = sources.fetch_with_ytdlp("UC1", "Test", 10)
    assert result["entries"][0]["is_broadcast"] is True
    assert result["entries"][1]["is_broadcast"] is False
