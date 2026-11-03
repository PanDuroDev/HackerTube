"""HTTP API for extracting and proxying temporary YouTube media streams."""
from __future__ import annotations

import ipaddress
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from urllib.parse import urlparse

import yt_dlp
from flask import Flask, Response, jsonify, request, stream_with_context, url_for

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
STREAM_TTL = int(os.environ.get("HT_STREAM_TOKEN_TTL", "1800"))
TRUST_CLOUDFLARE_IP = os.environ.get("HT_TRUST_CLOUDFLARE_IP", "false").lower() in {
    "1", "true", "yes"
}

_requests: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = threading.Lock()
_last_rate_cleanup = time.monotonic()

# Tokens are random, short-lived references. Keep the signed Googlevideo URL and
# extractor request headers server-side so media requests use the same egress IP.
_streams: dict[str, tuple[float, str, dict[str, str]]] = {}
_stream_lock = threading.Lock()


def _is_googlevideo_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (
        host == "googlevideo.com" or host.endswith(".googlevideo.com")
    )


def _remember_stream(url: str, headers: dict | None) -> str:
    token = secrets.token_urlsafe(24)
    safe_headers = {
        key: str(value)
        for key, value in (headers or {}).items()
        if key.lower() in {"user-agent", "referer", "accept", "accept-language"}
    }
    if "User-Agent" not in safe_headers and "user-agent" not in safe_headers:
        safe_headers["User-Agent"] = "Mozilla/5.0"
    with _stream_lock:
        now = time.monotonic()
        expired = [key for key, value in _streams.items() if value[0] <= now]
        for key in expired:
            _streams.pop(key, None)
        _streams[token] = (now + STREAM_TTL, url, safe_headers)
    return token


def _get_stream(token: str):
    with _stream_lock:
        record = _streams.get(token)
        if record is None:
            return None
        if record[0] <= time.monotonic():
            _streams.pop(token, None)
            return None
        return record[1], dict(record[2])


def _client_ip() -> str:
    # Trust Cloudflare's single-value client IP header only on deployments
    # known to sit behind Render's Cloudflare edge. Local/direct deployments
    # use the socket peer and never accept client-supplied forwarding headers.
    if TRUST_CLOUDFLARE_IP:
        forwarded_ip = request.headers.get("CF-Connecting-IP", "").strip()
        if forwarded_ip:
            try:
                return str(ipaddress.ip_address(forwarded_ip))
            except ValueError:
                pass
    return request.remote_addr or "unknown"


def _allow_request(client_ip: str, now: float) -> bool:
    global _last_rate_cleanup
    with _rate_lock:
        timestamps = _requests[client_ip]
        while timestamps and now - timestamps[0] >= RATE_WINDOW:
            timestamps.popleft()
        if now - _last_rate_cleanup >= RATE_WINDOW:
            for address, events in list(_requests.items()):
                while events and now - events[0] >= RATE_WINDOW:
                    events.popleft()
                if not events:
                    _requests.pop(address, None)
            _last_rate_cleanup = now
            timestamps = _requests[client_ip]
        if len(timestamps) >= RATE_LIMIT:
            return False
        timestamps.append(now)
        return True


@app.after_request
def add_response_headers(response):
    origin = request.headers.get("Origin", "").rstrip("/")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Accept, Range, If-Range"
        response.headers["Access-Control-Expose-Headers"] = (
            "Accept-Ranges, Content-Range, Content-Length"
        )
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

    client_ip = _client_ip()
    if not _allow_request(client_ip, time.monotonic()):
        return jsonify({"error": "Too many stream requests. Try again shortly."}), 429

    try:
        options = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            # Let yt-dlp return all formats. Our explicit filter below handles
            # the no-compatible-MP4 case without format-selection exceptions.
            "ignore_no_formats_error": True,
            "socket_timeout": 20,
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
        if not candidates:
            item = info
            if (
                item.get("ext") == "mp4"
                and item.get("protocol") in (None, "https")
                and item.get("vcodec") not in (None, "none")
                and item.get("acodec") not in (None, "none")
                and item.get("url", "").startswith("https://")
                and not item.get("has_drm")
            ):
                candidates = [item]
        if not candidates:
            return jsonify({
                "error": "No compatible progressive MP4 stream is available for this video."
            }), 422

        selected = max(
            candidates,
            key=lambda item: (
                int(item.get("height") or 0),
                float(item.get("tbr") or 0),
                int(item.get("filesize") or item.get("filesize_approx") or 0),
            ),
        )
        stream_url = selected["url"]
        if not _is_googlevideo_url(stream_url):
            return jsonify({"error": "The extractor returned an unsupported media host."}), 502

        token = _remember_stream(
            stream_url,
            selected.get("http_headers") or info.get("http_headers"),
        )
        return jsonify({
            "url": url_for("media", token=token),
            "title": info.get("title", ""),
            "format_id": selected.get("format_id"),
            "height": selected.get("height"),
        })
    except Exception:
        app.logger.exception("yt-dlp failed for video %s", video_id)
        return jsonify({
            "error": "Could not extract this video. It may be private, restricted, or temporarily unavailable."
        }), 502


@app.route("/media/<token>", methods=["GET", "HEAD", "OPTIONS"])
def media(token: str):
    if request.method == "OPTIONS":
        return ("", 204)
    stored = _get_stream(token)
    if stored is None:
        return jsonify({"error": "This stream URL has expired. Request it again."}), 410

    stream_url, extractor_headers = stored
    if not _is_googlevideo_url(stream_url):
        return jsonify({"error": "Unsupported media host."}), 502

    headers = dict(extractor_headers)
    range_header = request.headers.get("Range")
    if range_header:
        headers["Range"] = range_header
    if_range = request.headers.get("If-Range")
    if if_range:
        headers["If-Range"] = if_range

    upstream_request = urllib.request.Request(
        stream_url,
        headers=headers,
        method=request.method,
    )
    try:
        try:
            upstream = urllib.request.urlopen(upstream_request, timeout=45)
        except urllib.error.HTTPError as error:
            # HTTPError is also a readable response (notably for 416 Range errors).
            upstream = error
    except (urllib.error.URLError, TimeoutError, OSError):
        app.logger.exception("Upstream media request failed")
        return jsonify({"error": "The upstream video stream is unavailable."}), 502

    status = getattr(upstream, "status", None) or upstream.getcode()
    response_headers = {}
    for name in (
        "Content-Type",
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "ETag",
        "Last-Modified",
    ):
        value = upstream.headers.get(name)
        if value:
            response_headers[name] = value

    if request.method == "HEAD":
        upstream.close()
        return Response(status=status, headers=response_headers)

    def generate():
        try:
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            upstream.close()

    return Response(
        stream_with_context(generate()),
        status=status,
        headers=response_headers,
        direct_passthrough=True,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
