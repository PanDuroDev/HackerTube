"""HTTP API for extracting and proxying temporary YouTube media streams."""
from __future__ import annotations

import ipaddress
import os
import re
import secrets
import shutil
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yt_dlp
from flask import Flask, Response, jsonify, request, url_for

app = Flask(__name__)
STREAM_API_VERSION = "2026.11.03-mweb-bgutil"

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
STREAM_TTL = int(os.environ.get("HT_STREAM_TOKEN_TTL", "21600"))
TRUST_CLOUDFLARE_IP = os.environ.get("HT_TRUST_CLOUDFLARE_IP", "false").lower() in {
    "1", "true", "yes"
}
MAX_CONCURRENT_STREAMS = max(1, int(os.environ.get("HT_MAX_CONCURRENT_STREAMS", "6")))
_stream_slots = threading.BoundedSemaphore(MAX_CONCURRENT_STREAMS)
MAX_CONCURRENT_EXTRACTIONS = max(1, int(os.environ.get("HT_MAX_CONCURRENT_EXTRACTIONS", "1")))
_extract_slots = threading.BoundedSemaphore(MAX_CONCURRENT_EXTRACTIONS)
BGUTIL_SERVER_HOME = Path(os.environ.get(
    "HT_BGUTIL_SERVER_HOME",
    Path(__file__).resolve().parent / "vendor" / "bgutil-ytdlp-pot-provider" / "server",
)).expanduser().resolve()
BGUTIL_NODE_SCRIPT = BGUTIL_SERVER_HOME / "build" / "generate_once.js"


def _bgutil_provider_ready() -> bool:
    """Return whether the bundled BgUtils script and its Node.js runtime are available."""
    return bool(shutil.which("node") and BGUTIL_NODE_SCRIPT.is_file())

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
    ttl = STREAM_TTL
    source_expiry = parse_qs(urlparse(url).query).get("expire")
    if source_expiry:
        try:
            # Never let the proxy token outlive the signed upstream URL.
            ttl = min(ttl, max(0, int(source_expiry[0]) - int(time.time())))
        except ValueError:
            pass
    with _stream_lock:
        now = time.monotonic()
        expired = [key for key, value in _streams.items() if value[0] <= now]
        for key in expired:
            _streams.pop(key, None)
        _streams[token] = (now + ttl, url, safe_headers)
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
    """Return service health and build identifiers for deployment verification."""
    return jsonify({
        "status": "ok",
        "api_version": STREAM_API_VERSION,
        "yt_dlp_version": yt_dlp.version.__version__,
        "pot_provider": "ready" if _bgutil_provider_ready() else "unavailable",
    })




def _muxed_mp4_candidates(info: dict) -> list[dict]:
    """Return directly playable HTTPS MP4 formats that already contain audio and video."""
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
        # Some extractors return a single format at the top level instead of
        # exposing a formats array. Keep supporting that response shape.
        if (
            info.get("ext") == "mp4"
            and info.get("protocol") in (None, "https")
            and info.get("vcodec") not in (None, "none")
            and info.get("acodec") not in (None, "none")
            and info.get("url", "").startswith("https://")
            and not info.get("has_drm")
        ):
            candidates = [info]
    return candidates


@app.route("/api/stream/<video_id>", methods=["GET", "OPTIONS"])
def stream(video_id: str):
    """Extract a muxed MP4 and return a short-lived URL served by the media proxy."""
    if request.method == "OPTIONS":
        return ("", 204)
    if not VIDEO_ID_RE.fullmatch(video_id):
        return jsonify({"error": "Invalid YouTube video ID"}), 400

    client_ip = _client_ip()
    if not _allow_request(client_ip, time.monotonic()):
        return jsonify({"error": "Too many stream requests. Try again shortly."}), 429

    if not _extract_slots.acquire(blocking=False):
        response = jsonify({"error": "Stream extraction is busy. Try again shortly."})
        response.status_code = 503
        response.headers["Retry-After"] = "5"
        return response

    try:
        try:
            options = {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "ignore_no_formats_error": True,
                "socket_timeout": 15,
                "extractor_retries": 0,
            }
            video_url = f"https://www.youtube.com/watch?v={video_id}"
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(video_url, download=False)

            candidates = _muxed_mp4_candidates(info)
            if not candidates:
                # web_embedded can expose a no-PO-token muxed format for videos
                # that allow embedding, but its format set is not guaranteed.
                embedded_options = {
                    **options,
                    "extractor_args": {
                        "youtube": {"player_client": ["default", "web_embedded"]}
                    },
                }
                with yt_dlp.YoutubeDL(embedded_options) as downloader:
                    info = downloader.extract_info(video_url, download=False)
                candidates = _muxed_mp4_candidates(info)

            provider_ready = _bgutil_provider_ready()
            if not candidates and provider_ready:
                # mweb needs PO Tokens for some YouTube sessions. The BgUtils
                # script provider generates them on demand using the bundled
                # Deno runtime; the extraction semaphore keeps this work serial.
                mweb_options = {
                    **options,
                    "extractor_args": {
                        "youtube": {"player_client": ["mweb"]},
                        "youtubepot-bgutilscript": {
                            "server_home": [str(BGUTIL_SERVER_HOME)]
                        },
                    },
                }
                with yt_dlp.YoutubeDL(mweb_options) as downloader:
                    info = downloader.extract_info(video_url, download=False)
                candidates = _muxed_mp4_candidates(info)

            if not candidates:
                app.logger.warning(
                    "No compatible progressive MP4 found for video %s "
                    "after %s extraction",
                    video_id,
                    "default, web_embedded, and mweb with BgUtils PO Tokens"
                    if provider_ready else "default and web_embedded",
                )
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
    finally:
        _extract_slots.release()


class _UpstreamStream:
    """Close an upstream response and release its concurrency slot exactly once."""

    def __init__(self, upstream, release_slot):
        self._upstream = upstream
        self._release_slot = release_slot
        self._close_lock = threading.Lock()
        self._closed = False

    def __iter__(self):
        try:
            while True:
                chunk = self._upstream.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            self.close()

    def close(self):
        with self._close_lock:
            if self._closed:
                return
            self._closed = True
        try:
            self._upstream.close()
        finally:
            self._release_slot()


@app.route("/media/<token>", methods=["GET", "HEAD", "OPTIONS"])
def media(token: str):
    """Proxy a signed media URL while bounding concurrent upstream streams."""
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
    if not _stream_slots.acquire(blocking=False):
        response = jsonify({"error": "Too many active video streams. Try again shortly."})
        response.status_code = 503
        response.headers["Retry-After"] = "5"
        return response

    release_lock = threading.Lock()
    released = False

    def release_slot():
        nonlocal released
        with release_lock:
            if released:
                return
            released = True
        _stream_slots.release()

    upstream = None
    stream_body = None
    response_owns_slot = False
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
            return Response(status=status, headers=response_headers)

        stream_body = _UpstreamStream(upstream, release_slot)
        response = Response(
            stream_body,
            status=status,
            headers=response_headers,
            direct_passthrough=False,
        )
        response_owns_slot = True
        return response
    finally:
        if not response_owns_slot:
            try:
                if stream_body is not None:
                    stream_body.close()
                elif upstream is not None:
                    upstream.close()
            finally:
                release_slot()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
