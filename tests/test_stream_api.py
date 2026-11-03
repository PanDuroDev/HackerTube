from io import BytesIO
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
