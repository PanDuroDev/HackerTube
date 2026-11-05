# HackerTube

A curated, searchable index of programming videos from selected Arabic- and English-language YouTube channels. Explore tutorials, courses, talks, and project walkthroughs by topic, language, level, duration, date, and channel.

**[Visit HackerTube](https://pandurodev.github.io/HackerTube/)**

HackerTube is an independent project. It focuses on making programming content easier to discover, with a dedicated Hacker News section alongside the main video catalog.

## Catalog snapshot

The published catalog snapshot generated on **November 4, 2026** contains:

| Metric | Count |
| --- | ---: |
| Indexed videos | 18,140 |
| Selected channels | 66 |
| Topics | 21 |
| Creator playlists | 1,025 |
| Arabic videos | 5,958 |
| English videos | 12,182 |

These numbers describe the current data snapshot and change when the catalog is refreshed.

## Features

### Video discovery
- Browse the main catalog across 21 topics, including web development, Python, JavaScript, systems, AI, databases, security, and computer science.
- Filter by topic, channel, content language, level, content type, duration, and year.
- Sort results by relevance, personal recommendations, newest, views, or duration.
- Search the full catalog across titles, channels, topics, and available metadata. Search supports Arabic and English synonyms, prefix matching, basic typo tolerance, relevance ranking, and duplicate collapsing.
- Get a locally personalized **For you** feed based on activity saved in the current browser.

### Playlists and Hacker News
- Browse playlists published by selected creators, with playlist search, channel filters, and progressive loading.
- Create personal playlists and add videos from their watch pages.
- Explore a separate Hacker News catalog for recommendations, discussions, categories, related videos, and archived comments. Hacker News entries remain separate from the main programming catalog.

### Watch experience and preferences
- Watch through the YouTube embedded player. Videos are not hosted or re-uploaded by this project.
- Resume videos from saved watch progress, continue watching, and optionally autoplay the next related video.
- Like videos, keep a watch-later list, and review watch history.
- Switch between English and Arabic interfaces. Arabic uses right-to-left layout; video titles and channel names retain their original language.
- Choose light, dark, or system appearance, adjust page size, and hide watched videos.
- Share topic/filter and watch-page links.

## Privacy and local data

HackerTube does not require an account. Likes, watch history, watch-later items, personal playlists, and preferences are stored in the browser's `localStorage`. The project does not use account-based profiles or behavioral tracking.

## Run the website locally

The website is a static HTML, CSS, and JavaScript app. It does not need an application server or database.

~~~bash
git clone https://github.com/PanDuroDev/HackerTube.git
cd HackerTube
python -m http.server 8080 --directory public
~~~

Open [http://localhost:8080](http://localhost:8080).

## Refresh the video catalog

The data pipeline uses Python. Python 3.12 is the version used by the repository's CI workflow.

Install the dependencies:

~~~bash
python -m pip install -r requirements.txt
~~~

To use the YouTube Data API, copy `.env.example` to `.env` and set `YOUTUBE_API_KEY`. Keep the key local; never put it in frontend files or commit it to the repository.

~~~bash
python -m pipeline.fetch
python -m pipeline.fetch_playlists
python -m pipeline.build
python -m pipeline.build_sitemap
~~~

- `pipeline.fetch` collects channel videos. Its default source order is YouTube Data API, yt-dlp, then YouTube.js. Change the order with `--sources` or `HT_FETCH_SOURCES`.
- The fetcher collects up to the latest 500 videos per channel, with a higher 2,500-video limit for freeCodeCamp.org.
- `pipeline.fetch_playlists` requires a YouTube Data API key and imports playlists published by the selected channels.
- The YouTube.js fallback requires a one-time dependency installation:

  ~~~bash
  cd pipeline/ytjs
  npm install
  ~~~

### Import Hacker News data

The Hacker News importer expects a source archive named `hackertube-data.zip` in the repository root:

~~~bash
python -m pipeline.import_hacker_news
~~~

That archive is not committed to this repository or deployed to GitHub Pages. Provide it locally before running the import command. The generated Hacker News catalog, comments, and related data are published under `public/data/hacker-news/`.

## Tests

The CI workflow runs the Python tests, Go backend tests, JavaScript syntax checks, search-engine tests, and search performance budgets. Run them locally with:

~~~bash
pytest -q
cd backend && go test ./... && cd ..
node --check public/search.js
node --check public/app.js
node --test tests/*.test.js
~~~

The desktop app ships a Go search sidecar. Install Electron, build the backend, then start the app from source:

~~~bash
cd electron
npm install
npm run build:backend
npm start
cd ..
~~~

Search benchmarks compare the Go backend with the JavaScript fallback and enforce latency/memory budgets from the repository root:

~~~bash
node benchmarks/search-parity.js
node benchmarks/search-bench.js --assert
~~~

## Project structure

~~~text
pipeline/             Video fetching, classification, and data generation
pipeline/ytjs/        Optional YouTube.js fallback
backend/              Go search sidecar for the desktop app
benchmarks/           Go/JavaScript parity and performance benchmarks
public/               Static website (HTML, CSS, and JavaScript)
public/data/           Generated video catalog and Hacker News data
public/i18n/           English and Arabic interface translations
data/hacker-news/      Source taxonomy and embedding assets
tests/                 Python and JavaScript tests
~~~

## Search and data limitations

- Main-catalog search covers titles, channels, topics, categories, language, level, content type, year, and descriptions/tags when available. It does not index transcripts and is not semantic search.
- Video classification uses titles, descriptions, tags, and playlist hints when available. It does not use a language model; unclear levels are marked **Unspecified** rather than guessed.
- The Hacker News dataset is maintained separately. Some source records do not include video duration or view counts.
- YouTube API quota and source availability can affect data refreshes. The fetch pipeline falls back to alternate sources when an earlier source fails.
- Publication dates obtained from yt-dlp may be approximate and are marked accordingly.

## License and attribution

The project code is licensed under the [MIT License](LICENSE).

The Hacker News dataset is licensed under the [Open Data Commons Attribution License (ODC-By) 1.0](https://opendatacommons.org/licenses/by/1-0/). Required attribution:

- [HackerTube](https://hackertube.org/)
- [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news)

Hacker News comments remain the work of their authors. Video titles, channel names, and videos belong to their respective owners. Videos are played through YouTube embeds; this project does not re-upload them.

This project is not affiliated with YouTube, Google, Hacker News, or Y Combinator.
