import sys

import pytest

from pipeline import fetch_playlists
from pipeline.sources import FetchError


def test_fetch_channel_skips_only_unavailable_playlists(monkeypatch):
    monkeypatch.setattr(fetch_playlists, "list_playlists", lambda cid, key: [
        {"id": "private", "snippet": {"title": "Private"}},
        {"id": "visible", "snippet": {"title": "Visible"}},
    ])

    def playlist_ids(playlist_id, key, limit):
        if playlist_id == "private":
            raise FetchError("HTTP 403: inaccessible", status=403,
                             reason="playlistItemsNotAccessible")
        return ["a", "b", "c"]

    monkeypatch.setattr(fetch_playlists, "playlist_video_ids", playlist_ids)
    monkeypatch.setattr(fetch_playlists, "video_details", lambda ids, key: {})
    result = fetch_playlists.fetch_channel("UC1", "Test", "en", "key", 10, 3)
    assert [playlist["id"] for playlist in result["playlists"]] == ["visible"]


def test_fetch_channel_propagates_quota_errors(monkeypatch):
    monkeypatch.setattr(fetch_playlists, "list_playlists", lambda cid, key: [
        {"id": "playlist", "snippet": {"title": "Playlist"}},
    ])

    def fail_quota(playlist_id, key, limit):
        raise FetchError("HTTP 403: quota exceeded", status=403, reason="quotaExceeded")

    monkeypatch.setattr(fetch_playlists, "playlist_video_ids", fail_quota)
    with pytest.raises(FetchError) as raised:
        fetch_playlists.fetch_channel("UC1", "Test", "en", "key", 10, 3)
    assert raised.value.reason == "quotaExceeded"


def test_main_returns_failure_when_a_channel_fetch_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(fetch_playlists, "api_key", lambda: "key")
    monkeypatch.setattr(fetch_playlists, "CHANNELS", [("UC1", "Test")])
    monkeypatch.setattr(fetch_playlists, "OUT", tmp_path)
    monkeypatch.setattr(sys, "argv", ["pipeline.fetch_playlists"])

    def fail(*args, **kwargs):
        raise FetchError("quota exceeded", status=403, reason="quotaExceeded")

    monkeypatch.setattr(fetch_playlists, "fetch_and_write", fail)
    assert fetch_playlists.main() == 1
