# Direct playback setup

HackerTube is a static site. The optional HTML5 player needs a separate Python API because `yt-dlp` cannot run inside a static GitHub Pages site or a Cloudflare Worker.

The YouTube iframe remains the default. Direct playback is an optional test feature.

## Windows: run the API locally

Open PowerShell in the HackerTube repository directory.

Install the Python dependencies:

```powershell
python -m pip install -r requirements.txt
```

Configure the API for requests coming through Cloudflare Tunnel:

```powershell
$env:HT_ALLOWED_ORIGINS = "https://pandurodev.github.io,http://localhost:8080,http://127.0.0.1:8080"
$env:HT_TRUST_CLOUDFLARE_IP = "true"
$env:HT_MAX_CONCURRENT_STREAMS = "2"
python -m flask --app stream_api run --host 127.0.0.1 --port 8787
```

Keep this terminal open. The API should respond locally at `http://127.0.0.1:8787/health` with:

```json
{"status":"ok"}
```

## Expose the local API temporarily

Install `cloudflared` from the [official download instructions](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

Open a second PowerShell window and run:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

Cloudflare prints a temporary HTTPS address ending in `.trycloudflare.com`. Keep this terminal open too. Quick Tunnels do not need a Cloudflare account, a domain, or a payment card. The address is temporary and changes when the tunnel is restarted. See the [official Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Connect HackerTube

1. Open [HackerTube](https://pandurodev.github.io/HackerTube/).
2. Open **Settings**.
3. Enable **Direct video playback**.
4. Paste the temporary `https://….trycloudflare.com` address into **Stream API URL** and select **Save**.
5. Open a video. The HTML5 player will use the local API through the tunnel.

To return to the default Render endpoint, clear the Stream API URL field and save it. The default Render backend is not currently deployed in this account, so direct playback will remain unavailable until that service is deployed.

## Important limitations and safety

- This is a development/test setup, not permanent hosting. The API and tunnel work only while both PowerShell processes and your PC remain running.
- Anyone who obtains the temporary tunnel URL can send requests to the API. Treat the URL as private: do not post it publicly, commit it to Git, or share it in screenshots. Stop the tunnel after testing.
- The API has request-rate and concurrent-stream limits. Keep the local concurrency limit low and do not use this setup for public traffic.
- Do not expose Flask on `0.0.0.0` or open a router port. The instructions bind it to `127.0.0.1`; Cloudflare Tunnel creates the outbound connection.
- Quick Tunnels have no uptime guarantee and are intended for testing. For permanent public playback, use a properly hosted backend.
