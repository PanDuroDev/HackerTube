from unittest.mock import MagicMock, patch

import stream_api


def test_health_endpoint():
    response = stream_api.app.test_client().get("/health")
    assert response.status_code == 200
    assert response.json == {"status": "ok"}


def test_rejects_invalid_video_id():
    response = stream_api.app.test_client().get("/api/stream/not-a-video-id")
    assert response.status_code == 400


def test_returns_muxed_mp4_url():
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
                "url": "https://video.example/360.mp4",
            },
            {
                "format_id": "137",
                "ext": "mp4",
                "protocol": "https",
                "vcodec": "avc1",
                "acodec": "none",
                "height": 1080,
                "url": "https://video.example/video-only.mp4",
            },
            {
                "format_id": "22",
                "ext": "mp4",
                "protocol": "https",
                "vcodec": "avc1",
                "acodec": "mp4a",
                "height": 720,
                "tbr": 1200,
                "url": "https://video.example/720.mp4",
            },
        ],
    }
    downloader = MagicMock()
    downloader.extract_info.return_value = info
    context = MagicMock()
    context.__enter__.return_value = downloader
    context.__exit__.return_value = False
    with patch.object(stream_api.yt_dlp, "YoutubeDL", return_value=context):
        response = stream_api.app.test_client().get(
            "/api/stream/dQw4w9WgXcQ",
            headers={"Origin": "https://pandurodev.github.io"},
        )
    assert response.status_code == 200
    assert response.json["url"] == "https://video.example/720.mp4"
    assert response.headers["Access-Control-Allow-Origin"] == "https://pandurodev.github.io"


def test_rejects_videos_without_muxed_mp4():
    downloader = MagicMock()
    downloader.extract_info.return_value = {
        "title": "Audio/video split only",
        "formats": [{
            "format_id": "137", "ext": "mp4", "protocol": "https",
            "vcodec": "avc1", "acodec": "none", "url": "https://video.example/video.mp4",
        }],
    }
    context = MagicMock()
    context.__enter__.return_value = downloader
    context.__exit__.return_value = False
    with patch.object(stream_api.yt_dlp, "YoutubeDL", return_value=context):
        response = stream_api.app.test_client().get("/api/stream/dQw4w9WgXcQ")
    assert response.status_code == 422


def test_disallowed_origin_gets_no_cors_permission():
    response = stream_api.app.test_client().get(
        "/health", headers={"Origin": "https://evil.example"}
    )
    assert "Access-Control-Allow-Origin" not in response.headers
