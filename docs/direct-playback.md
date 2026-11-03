# Direct playback setup

HackerTube is a static site. The optional HTML5 player needs a separate Python API because `yt-dlp` cannot run inside GitHub Pages.

The YouTube iframe remains the default and works without this API. Direct playback is optional and can be tested locally on your own Windows PC.

## Run the API locally

Open PowerShell in the HackerTube repository directory.

Install the Python dependencies:

```powershell
python -m pip install -r requirements.txt
```

Start the API in the first PowerShell window:

```powershell
$env:HT_ALLOWED_ORIGINS = "http://127.0.0.1:8080"
$env:HT_TRUST_CLOUDFLARE_IP = "false"
$env:HT_MAX_CONCURRENT_STREAMS = "2"
python -m flask --app stream_api run --host 127.0.0.1 --port 8787
```

Keep this window open. Check that [http://127.0.0.1:8787/health](http://127.0.0.1:8787/health) returns:

```json
{"status":"ok"}
```

## Run the website locally

Open a second PowerShell window in the same repository directory:

```powershell
python -m http.server 8080 --bind 127.0.0.1 --directory public
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). This serves the frontend only on your own PC.

## Connect the player

1. Open **Settings** in the local HackerTube page.
2. Enable **Direct video playback**.
3. Set **Stream API URL** to `http://127.0.0.1:8787`.
4. Save the setting and open a video.

The browser now sends extraction and media requests to the local Python API. The YouTube iframe remains the fallback. Keep both PowerShell windows open while testing. Press Ctrl+C in each window to stop its process.

## Why this is local-only

A local API is suitable for testing, but it does not provide a public backend for the GitHub Pages website. Visitors to the public site cannot use the API running on your PC.

Do not expose this video proxy through a Cloudflare Tunnel or another public tunnel unless the provider explicitly permits this kind of video delivery. Cloudflare's policy says public-hostname Tunnel traffic on Free, Pro, and Business plans is subject to its video-delivery restrictions. Cloudflare identifies Stream as its video delivery product and Stream Delivery as an Enterprise-only option. Quick Tunnels are intended for testing and development, not production hosting. See [Cloudflare's video-delivery policy](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/) and [Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

For a public HTML5 playback backend, use a hosting provider and plan whose terms explicitly allow proxying and delivering these video streams. The configured API URL must be HTTPS and must allow browser requests from the HackerTube site.

## Safety and limitations

- Bind the API and local website to `127.0.0.1` as shown. Do not bind the API to `0.0.0.0` or open router ports.
- Do not publish the local API URL as a public endpoint. It is intended only for requests from your own browser on the same PC.
- The API extracts temporary YouTube media URLs and proxies the media; it does not store or re-upload video files.
- Playback may still fall back to YouTube when a video is restricted, has no compatible progressive MP4, or cannot be extracted.
