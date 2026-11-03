# HackerTube AR

A programming video index built from selected Arabic and English YouTube channels. Browse videos by topic, language, level, content type, duration, year, and channel. Search covers the full catalog and ranks results by relevance, with support for Arabic and English synonyms, prefixes, and basic typo tolerance.

Inspired by [HackerTube](https://hackertube.org), but with a different focus: the original centers on English-language recommendations from Hacker News, while this project prioritizes Arabic programming content (including Elzero, Yahya Tech, TheNewBaghdad, Codezilla, and others), alongside a curated selection of international channels.

## Features

- A home feed with varied recommendations that learns locally from likes, watch history, playlists, and watch-later activity, alongside long videos, likes, and viewing history. For you, Best, and explicit feed refresh modes separate personalized discovery from quality ranking.
- An English, left-to-right interface with a single **Filters** menu for topics, language, channel, level, content type, duration, year, and sorting.
- 20 categories with video counts, plus user-created playlists that can be managed and populated from the watch page.
- Curated playlists from content creators, fetched and cleaned automatically and displayed on the Playlists page with a creator-diverse preview, search, channel filters, and progressive loading.
- Full-catalog search with relevance ranking across titles, channels, topics, and metadata, including synonyms, prefixes, typo tolerance, quality boosts, channel diversity, and exact duplicate collapsing.
- Shareable topic and filter URLs, canonical/Open Graph metadata, a copy/native share action on watch pages, and generated sitemap/robots files.
- Keyboard-accessible filter menus, Arabic language/direction metadata, a skip link, and active navigation state.
- Watch progress with resume and Continue watching, optional autoplay-next, and video descriptions when the catalog provides them.
- Description/tag-aware classification, explicit **Unspecified** levels, and description-based language detection with channel fallback.
- A separate Hacker News search index covering titles, channels, summaries, recommendation context, tags, and categories. Results from the two catalogs are kept separate. The Hacker News page supports programming/all scope, recommendation status, content type, level, shelf life, area filters, and sorting.
- A dedicated Hacker News section for recommendations, discussions, categories, and related links, without mixing them into the main programming-channel catalog.
- Original relationship data, Hacker News comments, and embedding files are preserved for future semantic-search work.
- Video thumbnails use frames captured from inside the video (\`hq1\`/\`hq2\`/\`hq3\`) instead of relying only on the static thumbnail, with a fallback when frames are unavailable.
- Appearance settings (dark, light, or system), watched-video visibility, page size, and local-data reset controls.
- A minimal interface with neutral colors, inspired by HackerTube and Uber Base, using [MingCute](https://www.mingcute.com/) icons through [Iconify](https://iconify.design/).
- No accounts or tracking. Likes, history, and playlists are stored locally in \`localStorage\`.

## Run locally

From the repository root:

\`\`\`bash
python -m http.server 8080 -d public
# Open http://localhost:8080
\`\`\`

No application server or database is required. The website is made of static files and JSON data.

Video playback uses the official YouTube embedded player with its built-in controls.

## Build the data

\`\`\`bash
pip install -r requirements.txt
cp .env.example .env         # Optional for fetch; required for fetch_playlists
python -m pipeline.fetch     # Fetch the latest 500 videos per channel into data/raw/
python -m pipeline.fetch_playlists  # Requires YOUTUBE_API_KEY; fetches creator playlists into data/playlists/
python -m pipeline.build     # Generates videos.json, meta.json, and playlists.json
python -m pipeline.import_hacker_news  # Imports Hacker News recommendations without duplicate videos
python -m pipeline.build_sitemap       # Generates sitemap.xml and robots.txt
pytest                       # Run the test suite
\`\`\`

\`pipeline.fetch\` tries its sources in this order: YouTube Data API, yt-dlp, then YouTube.js. It falls back to the next source when one fails or is blocked. Change the order with \`--sources api,yt-dlp,youtubei\` or the \`HT_FETCH_SOURCES\` environment variable. The API key is read from \`.env\` (which is excluded from git) or from an environment variable; it is never written into the repository.

The YouTube.js fallback requires a one-time installation:

\`\`\`bash
cd pipeline/ytjs && npm install
\`\`\`

Restrict the key in Google Cloud to YouTube Data API v3 only. Never expose it in the frontend. Descriptions and tags come from the existing videos.list snippet response, so they add no extra API calls; the usual 10,000-units-per-day quota still applies to channel and video requests.

## Project structure

\`\`\`
pipeline/        Fetching (API/yt-dlp/YouTube.js), classification, and data generation
pipeline/ytjs/   YouTube.js fallback
public/          Static website (HTML/CSS/JS, no frontend framework)
public/search.js Local indexing, weighted search, synonyms, prefixes, and limited typo correction
public/data/     Generated catalog, Hacker News data, comments, relationships, and fast preview
data/hacker-news/ Source-only taxonomy and embedding assets (not deployed)
tests/           Tests for normalization, classification, sources, and data
\`\`\`

## Performance

- Hacker News renders a small `videos-preview.json` first, then loads the full catalog in the background.
- Search indexes are built on first search (or during idle time), not during the initial render.
- The main catalog omits the unused precomputed `search` string.
- Embedding and taxonomy assets live in `data/hacker-news/` and are excluded from the Pages artifact; `hackertube-data.zip` stays at the repository root and is not deployed either.
- Budget: first page under 2 seconds on a typical broadband connection; first HN cards from the preview without waiting for the full catalog.

## Known limitations

- The main catalog search indexes video titles, channels, topics, categories, language, level, content type, year, and descriptions/tags when available. Transcripts are not included, so search does not claim to cover spoken content. The current search is not semantic.
- Classification in the main programming catalog uses titles plus descriptions and tags when the source provides them. It does not use a language model, and videos with no clear signal are marked **Unspecified** instead of guessing a level.
- Hacker News data is kept separate because the source dataset does not provide video durations or view counts.
- HackerTube data is licensed under ODC-By 1.0. Attribution to HackerTube and open-index/hacker-news is required.
- The fetcher retrieves the latest 500 videos per channel, so older videos from large channels may not be included.
- YouTube API quota is limited per day. When the quota is exhausted, fetching automatically falls back to yt-dlp.
- Publish dates from the API are exact; dates from yt-dlp are approximate and marked as \`approximate_date\`.
- Personal recommendations use local interactions only. There are no accounts or tracking, and likes, history, and playlists remain in the browser.
- Videos are not stored or re-uploaded by this project. Playback uses youtube-nocookie embeds. All video rights remain with their respective owners.

## License and attribution

The project code is licensed under the MIT License. Video metadata (titles, IDs, and view counts) belongs to the respective YouTube content owners and is used here for indexing only.

HackerTube/Hacker News data is licensed under the [Open Data Commons Attribution License (ODC-By) 1.0](https://opendatacommons.org/licenses/by/1-0/). Required attribution:

- [HackerTube](https://hackertube.org/)
- [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news)

Hacker News comments remain the work of their authors. Video titles and channel names belong to their respective owners. YouTube metadata that YouTube's terms do not allow to be redistributed is not redistributed here. Videos are played through YouTube embeds.

This project is not affiliated with YouTube, Google, Hacker News, or Y Combinator.
