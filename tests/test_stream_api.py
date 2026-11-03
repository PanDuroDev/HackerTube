import threading
from unittest.mock import MagicMock, patch

import stream_api


VIDEO_URL = "https://rr1---sn-example.googlevideo.com/videoplayback?sig=test"


def mocked_downloader(info):
    downloader = MagicMock()
    downloader.extract_info.return_value = info
    context = MagicMock()
    context.__enter__.return_value = downloader
    context.__exit__.return_value = False
    return context


def test_health_endpoint():
    response = stream_api.app.test_client().get("/health")
    assert response.status_code == 200
    assert response.json == {"status": "ok"}


def test_rejects_invalid_video_id():
    response = stream_api.app.test_client().get("/api/stream/not-a-video-id")
    assert response.status_code == 400


def test_uses_cloudflare_client_ip_instead_of_forwarded_for():
    with patch.object(stream_api, "TRUST_CLOUDFLARE_IP", True):
        with stream_api.app.test_request_context(
            "/",
            headers={
                "CF-Connecting-IP": "203.0.113.27",
                "X-Forwarded-For": "198.51.100.99",
            },
            environ_base={"REMOTE_ADDR": "127.0.0.1"},
        ):
            assert stream_api._client_ip() == "203.0.113.27"


def test_invalid_cloudflare_ip_falls_back_to_socket_peer():
    with patch.object(stream_api, "TRUST_CLOUDFLARE_IP", True):
        with stream_api.app.test_request_context(
            "/",
            headers={"CF-Connecting-IP": "not-an-ip", "X-Forwarded-For": "198.51.100.99"},
            environ_base={"REMOTE_ADDR": "127.0.0.1"},
        ):
            assert stream_api._client_ip() == "127.0.0.1"


def test_forwarding_headers_are_ignored_without_trusted_edge():
    with patch.object(stream_api, "TRUST_CLOUDFLARE_IP", False):
        with stream_api.app.test_request_context(
            "/",
            headers={"CF-Connecting-IP": "203.0.113.27", "X-Forwarded-For": "198.51.100.99"},
            environ_base={"REMOTE_ADDR": "127.0.0.1"},
        ):
            assert stream_api._client_ip() == "127.0.0.1"


def test_returns_local_proxy_url_for_muxed_mp4():
    info = {
        "title": "Example",
        "formats": [
            {
                "format_id": "18",
                "ext": "mp4",
                "protocol": "https",
                "vcodec": "avc1",
                "acodec": "mp4a",
                "height": 360,
                "tbr": 500,
                "url": VIDEO_URL + "&quality=360",
                "http_headers": {"User-Agent": "yt-dlp-test", "Referer": "https://www.youtube.com/"},
            },
            {
                "format_id": "137",
                "ext": "mp4",
                "protocol": "https",
                "vcodec": "avc1",
                "acodec": "none",
                "height": 1080,
                "url": VIDEO_URL + "&quality=1080",
            },
            {
                "format_id": "22",
                "ext": "mp4",
                "protocol": "https",
                "vcodec": "avc1",
                "acodec": "mp4a",
                "height": 720,
                "tbr": 1200,
                "url": VIDEO_URL + "&quality=720",
            },
        ],
    }
    context = mocked_downloader(info)
    with patch.object(stream_api.yt_dlp, "YoutubeDL", return_value=context):
        response = stream_api.app.test_client().get(
            "/api/stream/dQw4w9WgXcQ",
            headers={"Origin": "https://pandurodev.github.io"},
        )

    assert response.status_code == 200
    assert response.json["url"].startswith("/media/")
    assert response.json["height"] == 720
    assert response.headers["Access-Control-Allow-Origin"] == "https://pandurodev.github.io"


def test_retries_with_android_client_when_default_has_no_muxed_mp4():
    """Retry extraction when the default client exposes only adaptive formats."""
    default_info = {
        "title": "Adaptive-only default client",
        "formats": [{
            "format_id": "137",
            "ext": "mp4",
            "protocol": "https",
            "vcodec": "avc1",
            "acodec": "none",
            "height": 1080,
            "url": VIDEO_URL + "&quality=1080",
        }],
    }
    android_info = {
        "title": "Android fallback",
        "formats": [{
            "format_id": "18",
            "ext": "mp4",
            "protocol": "https",
            "vcodec": "avc1",
            "acodec": "mp4a",
            "height": 360,
            "url": VIDEO_URL + "&quality=360",
        }],
    }
    contexts = [mocked_downloader(default_info), mocked_downloader(android_info)]
    client = stream_api.app.test_client()

    with patch.object(
        stream_api.yt_dlp,
        "YoutubeDL",
        side_effect=contexts,
    ) as youtube_dl:
        response = client.get("/api/stream/dQw4w9WgXcQ")

    assert response.status_code == 200
    assert response.json["height"] == 360
    assert response.json["url"].startswith("/media/")
    assert youtube_dl.call_count == 2
    assert "extractor_args" not in youtube_dl.call_args_list[0].args[0]
    assert youtube_dl.call_args_list[1].args[0]["extractor_args"] == {
        "youtube": {"player_client": ["android"]}
    }


def test_media_proxy_forwards_range_and_streams_partial_response():
    info = {
        "title": "Example",
        "formats": [{
            "format_id": "18",
            "ext": "mp4",
            "protocol": "https",
            "vcodec": "avc1",
            "acodec": "mp4a",
            "height": 360,
            "url": VIDEO_URL,
            "http_headers": {"User-Agent": "yt-dlp-test"},
        }],
    }
    context = mocked_downloader(info)
    client = stream_api.app.test_client()
    with patch.object(stream_api.yt_dlp, "YoutubeDL", return_value=context):
        extracted = client.get("/api/stream/dQw4w9WgXcQ")
    assert extracted.status_code == 200

    upstream = MagicMock()
    upstream.status = 206
    upstream.getcode.return_value = 206
    upstream.headers = {
        "Content-Type": "video/mp4",
        "Content-Length": "11",
        "Content-Range": "bytes 0-10/100",
        "Accept-Ranges": "bytes",
    }
    upstream.read.side_effect = [b"hello ", b"world", b""]
    with patch.object(stream_api.urllib.request, "urlopen", return_value=upstream) as open_url:
        response = client.get(
            extracted.json["url"],
            headers={"Range": "bytes=0-10"},
        )

    request_sent = open_url.call_args.args[0]
    assert request_sent.get_header("Range") == "bytes=0-10"
    assert request_sent.get_header("User-agent") == "yt-dlp-test"
    assert response.status_code == 206
    assert response.data == b"hello world"
    assert response.headers["Content-Range"] == "bytes 0-10/100"
    assert response.headers["Accept-Ranges"] == "bytes"


def test_expired_stream_token_is_rejected():
    response = stream_api.app.test_client().get("/media/not-a-real-token")
    assert response.status_code == 410


def test_no_compatible_format_returns_422_instead_of_extractor_error():
    context = mocked_downloader({"title": "No matching format", "formats": []})
    with patch.object(stream_api.yt_dlp, "YoutubeDL", return_value=context):
        response = stream_api.app.test_client().get("/api/stream/dQw4w9WgXcQ")
    assert response.status_code == 422


def test_rejects_videos_without_muxed_mp4():
    context = mocked_downloader({
        "title": "Audio/video split only",
        "formats": [{
            "format_id": "137", "ext": "mp4", "protocol": "https",
            "vcodec": "avc1", "acodec": "none", "url": VIDEO_URL,
        }],
    })
    with patch.object(stream_api.yt_dlp, "YoutubeDL", return_value=context):
        response = stream_api.app.test_client().get("/api/stream/dQw4w9WgXcQ")
    assert response.status_code == 422


def test_rejects_non_googlevideo_media_hosts():
    context = mocked_downloader({
        "title": "Unexpected host",
        "formats": [{
            "format_id": "18", "ext": "mp4", "protocol": "https",
            "vcodec": "avc1", "acodec": "mp4a",
            "url": "https://example.com/video.mp4",
        }],
    })
    with patch.object(stream_api.yt_dlp, "YoutubeDL", return_value=context):
        response = stream_api.app.test_client().get("/api/stream/dQw4w9WgXcQ")
    assert response.status_code == 502


def test_disallowed_origin_gets_no_cors_permission():
    response = stream_api.app.test_client().get(
        "/health", headers={"Origin": "https://evil.example"}
    )
    assert "Access-Control-Allow-Origin" not in response.headers


def test_stream_token_does_not_outlive_signed_upstream_url():
    now = 1_800_000_000
    with (
        patch.object(stream_api, "STREAM_TTL", 21_600),
        patch.object(stream_api.time, "time", return_value=now),
        patch.object(stream_api.time, "monotonic", return_value=100.0),
    ):
        token = stream_api._remember_stream(f"{VIDEO_URL}&expire={now + 120}", {})
        assert stream_api._streams[token][0] == 220.0


def test_media_proxy_limits_concurrent_streams_and_releases_slot_on_close():
    semaphore = threading.BoundedSemaphore(1)
    first_token = stream_api._remember_stream(VIDEO_URL, {})
    second_token = stream_api._remember_stream(VIDEO_URL, {})
    upstream = MagicMock()
    upstream.status = 200
    upstream.headers = {"Content-Type": "video/mp4"}
    client = stream_api.app.test_client()

    with (
        patch.object(stream_api, "_stream_slots", semaphore),
        patch.object(stream_api.urllib.request, "urlopen", return_value=upstream),
    ):
        first_response = client.get(f"/media/{first_token}", buffered=False)
        assert first_response.status_code == 200

        blocked_response = client.get(f"/media/{second_token}")
        assert blocked_response.status_code == 503
        assert blocked_response.headers["Retry-After"] == "5"

        first_response.close()
        assert semaphore.acquire(blocking=False)
        semaphore.release()

    upstream.close.assert_called_once()


def test_head_and_upstream_errors_release_concurrency_slots():
    semaphore = threading.BoundedSemaphore(1)
    head_token = stream_api._remember_stream(VIDEO_URL, {})
    error_token = stream_api._remember_stream(VIDEO_URL, {})
    upstream = MagicMock()
    upstream.status = 200
    upstream.headers = {"Content-Type": "video/mp4"}
    client = stream_api.app.test_client()

    with patch.object(stream_api, "_stream_slots", semaphore):
        with patch.object(stream_api.urllib.request, "urlopen", return_value=upstream):
            head_response = client.head(f"/media/{head_token}")
        assert head_response.status_code == 200
        assert semaphore.acquire(blocking=False)
        semaphore.release()

        with patch.object(
            stream_api.urllib.request,
            "urlopen",
            side_effect=OSError("upstream unavailable"),
        ):
            error_response = client.get(f"/media/{error_token}")
        assert error_response.status_code == 502
        assert semaphore.acquire(blocking=False)
        semaphore.release()

    upstream.close.assert_called_once()
