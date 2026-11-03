"""Small HTTP API that extracts direct, muxed MP4 streams with yt-dlp."""
from __future__ import annotations

import os
import re
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

import yt_dlp
from flask import Flask, jsonify, request

app = Flask(__name__)
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "HT_ALLOWED_ORIGINS",
        "https://pandurodev.github.io,http://localhost:8080,http://127.0.0.1:8080",
    ).split(",")
    if origin.strip()
}
RATE_LIMIT = int(os.environ.get("HT_STREAM_RATE_LIMIT", "20"))
RATE_WINDOW = 60
_requests: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = threading.Lock()


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "").rstrip("/")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Accept"
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/stream/<video_id>", methods=["GET", "OPTIONS"])
def stream(video_id: str):
    if request.method == "OPTIONS":
        return ("", 204)
    if not VIDEO_ID_RE.fullmatch(video_id):
        return jsonify({"error": "Invalid YouTube video ID"}), 400

    client_ip = request.remote_addr or "unknown"
    now = time.monotonic()
    with _rate_lock:
        timestamps = _requests[client_ip]
        while timestamps and now - timestamps[0] >= RATE_WINDOW:
            timestamps.popleft()
        if len(timestamps) >= RATE_LIMIT:
            return jsonify({"error": "Too many stream requests. Try again shortly."}), 429
        timestamps.append(now)

    try:
        options = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            "format": "best[ext=mp4][protocol=https]",
            "socket_timeout": 15,
            "extractor_retries": 1,
        }
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(
                f"https://www.youtube.com/watch?v={video_id}",
                download=False,
            )
        formats = info.get("formats") or []
        candidates = [
            item for item in formats
            if item.get("ext") == "mp4"
            and item.get("protocol") == "https"
            and item.get("vcodec") not in (None, "none")
            and item.get("acodec") not in (None, "none")
            and item.get("url", "").startswith("https://")
            and not item.get("has_drm")
        ]
        if not candidates and info.get("url", "").startswith("https://"):
            if (
                info.get("ext") == "mp4"
                and info.get("vcodec") not in (None, "none")
                and info.get("acodec") not in (None, "none")
            ):
                candidates = [info]
        if not candidates:
            return jsonify({"error": "No compatible progressive MP4 stream is available for this video."}), 422

        selected = max(
            candidates,
            key=lambda item: (
                int(item.get("height") or 0),
                float(item.get("tbr") or 0),
                int(item.get("filesize") or item.get("filesize_approx") or 0),
            ),
        )
        stream_url = selected["url"]
        parsed = urlparse(stream_url)
        if parsed.scheme != "https" or not parsed.netloc:
            return jsonify({"error": "The extractor returned an invalid stream URL."}), 502
        return jsonify({
            "url": stream_url,
            "title": info.get("title", ""),
            "format_id": selected.get("format_id"),
            "height": selected.get("height"),
        })
    except Exception:
        app.logger.exception("yt-dlp failed for video %s", video_id)
        return jsonify({"error": "Could not extract this video. It may be private, restricted, or temporarily unavailable."}), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
