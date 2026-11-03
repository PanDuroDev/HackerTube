"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "public", "app.js"),
  "utf8",
);

function createHarness() {
  const view = { innerHTML: "", addEventListener() {} };
  const storage = new Map();
  const document = {
    title: "",
    querySelector(selector) {
      return selector === "#view" ? view : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const context = {
    document,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    location: { hash: "#/", origin: "https://example.test" },
    URLSearchParams,
    URL,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    window: {
      HackerTubeSearch: {
        SearchIndex: class {
          constructor(records) {
            this.records = records;
          }
          search() {
            return [];
          }
        },
      },
    },
    fetch: async () => {
      throw new Error("Unexpected network request in test");
    },
  };

  const source = APP_SOURCE.replace(/\ninit\(\);\s*\n/, "\n");
  assert.notEqual(source, APP_SOURCE, "the app init call should be isolated");
  vm.runInNewContext(
    source + "\nglobalThis.__testApi = { state, card, videoWatchHref, playlistPlaybackHref, youtubeIframeMarkup, loadYouTubeIframeApi, startYouTubePlayer, watchActionsHTML, renderSettings, renderHNWatch, renderWatch, renderCollection, renderPlaylists, renderPlaylist, playlistCard, toggleAct, addToPlaylist, syncWatchVideo, loadHNMentions, setFetchJson(fn) { fetchJson = fn; } };",
    context,
    { filename: "public/app.js" },
  );
  vm.runInContext("syncSidebar = () => {}; toast = () => {}; renderHNEvidence = () => {}; startPlaylistPlayer = () => {};", context);

  return {
    api: context.__testApi,
    context,
    document,
    location: context.location,
    view,
  };
}

function sampleHNVideo(id = "hn123") {
  return {
    vid: id,
    title: "Hacker News sample video",
    channel: "Sample channel",
    score: 3.7,
    primary_topic: "AI",
    recommenders: 4,
    hn: { recommenders: 4 },
    categories: [],
    tags: [],
  };
}

function setVideoLoader(harness, records) {
  harness.api.setFetchJson(async (file) => {
    if (file === "data/hacker-news/videos.json") return records;
    if (file === "data/hacker-news/existing.json") return {};
    throw new Error("Unexpected data request: " + file);
  });
}

test("Hacker News cards reuse the shared card and retain the correct watch route", () => {
  const { api } = createHarness();
  const hn = sampleHNVideo();
  const hnCard = api.card(hn);

  assert.ok(hnCard.includes('href="#/hn-watch/hn123"'));
  assert.ok(hnCard.includes('data-later-toggle="hn123"'));
  assert.ok(hnCard.includes("HN 3.7"));
  assert.ok(hnCard.includes('class="card"'));

  const mainVideo = {
    id: "main123",
    title: "Main catalog video",
    channel: "Main channel",
    channel_id: "channel1",
    views: 100,
    year: 2024,
    topics: [],
    duration: 180,
  };
  const mappedCard = api.card(mainVideo, { hn });

  assert.ok(mappedCard.includes('href="#/watch/main123"'));
  assert.ok(mappedCard.includes("4 recommenders"));
  assert.ok(!mappedCard.includes("#/hn-watch/main123"));
});

test("shared watch actions reflect saved state and playlist options", () => {
  const { api } = createHarness();
  const id = "hn123";
  api.state.likes.add(id);
  api.state.saved.add(id);
  api.state.playlists = [{ id: "pl_test", name: "Research", ids: [] }];

  const markup = api.watchActionsHTML(id);

  assert.ok(markup.includes('data-act="like" aria-pressed="true"'));
  assert.ok(markup.includes('data-act="save" aria-pressed="true"'));
  assert.ok(markup.includes('data-add-playlist="pl_test"'));
  assert.ok(markup.includes('href="https://www.youtube.com/watch?v=hn123"'));
});

test("opening an HN-only watch page binds actions to that video", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const id = "hn123";
  const video = sampleHNVideo(id);

  api.state.hnVideosPromise = Promise.resolve([video]);
  api.state.hnById = new Map([[id, video]]);
  api.state.hnExistingPromise = Promise.resolve({});
  api.state.hnRelatedPromise = Promise.resolve({});
  api.state.hnAliasesPromise = Promise.resolve({});
  api.state.hnMentionPartitions.set("h", Promise.resolve({ [id]: [] }));
  api.state.playlists = [{ id: "pl_test", name: "Research", ids: [] }];
  location.hash = "#/hn-watch/" + id;

  await api.renderHNWatch(id);

  assert.equal(api.state.current, id);
  assert.equal(api.state.seen[0], id);
  assert.ok(view.innerHTML.includes('data-act="like"'));
  assert.ok(view.innerHTML.includes('data-act="save"'));

  api.toggleAct("like");
  api.toggleAct("save");
  assert.ok(api.state.likes.has(id));
  assert.ok(api.state.saved.has(id));

  api.addToPlaylist("pl_test", api.state.current);
  assert.deepEqual(Array.from(api.state.playlists[0].ids), [id]);
});

test("collections reload and render saved HN-only videos, including updates during loading", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const first = sampleHNVideo("hn123");
  const addedWhileLoading = sampleHNVideo("hn456");
  let resolveVideos;
  api.setFetchJson((file) => {
    if (file === "data/hacker-news/existing.json") return Promise.resolve({});
    if (file === "data/hacker-news/videos.json") {
      return new Promise((resolve) => {
        resolveVideos = resolve;
      });
    }
    return Promise.reject(new Error("Unexpected data request: " + file));
  });

  api.state.videos = [];
  api.state.byId = new Map();
  api.state.hnById = new Map();
  api.state.hnVideosPromise = null;
  api.state.likes = new Set([first.vid]);
  api.state.saved = new Set([first.vid]);
  api.state.seen = [first.vid];
  location.hash = "#/liked";

  const pending = api.renderCollection("liked");
  assert.equal(typeof resolveVideos, "function", "HN catalog loading should start before the first await");
  api.state.likes.add(addedWhileLoading.vid);
  resolveVideos([first, addedWhileLoading]);
  await pending;

  assert.ok(view.innerHTML.includes("hn123"));
  assert.ok(view.innerHTML.includes("hn456"));
  assert.ok(view.innerHTML.includes('data-remove="liked"'));

  location.hash = "#/later";
  await api.renderCollection("later");
  assert.ok(view.innerHTML.includes('data-remove="later"'));

  location.hash = "#/history";
  await api.renderCollection("history");
  assert.ok(view.innerHTML.includes("Hacker News sample video"));
  assert.ok(view.innerHTML.includes('data-remove="history"'));
});

test("custom playlists render HN-only videos and use their video IDs for thumbnails", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const video = sampleHNVideo();
  setVideoLoader(harness, [video]);

  api.state.videos = [];
  api.state.byId = new Map();
  api.state.hnById = new Map();
  api.state.hnVideosPromise = null;
  api.state.playlists = [{ id: "pl_test", name: "Research", ids: [video.vid] }];
  location.hash = "#/playlist/pl_test";

  await api.renderPlaylist("pl_test");

  assert.ok(view.innerHTML.includes('href="#/hn-watch/hn123?list=pl_test&autoplay=1"'));
  assert.ok(view.innerHTML.includes('class="btn primary" href="#/hn-watch/hn123?list=pl_test&autoplay=1"'));
  assert.ok(view.innerHTML.includes('data-remove="playlist"'));
  assert.ok(view.innerHTML.includes('data-later-toggle="hn123"'));

  const playlistCard = api.playlistCard(api.state.playlists[0]);
  assert.ok(playlistCard.includes("/vi/hn123/"));
  assert.ok(!playlistCard.includes("/vi/undefined/"));

  location.hash = "#/playlists";
  await api.renderPlaylists();
  assert.ok(view.innerHTML.includes("/vi/hn123/"));
});

test("a stale HN watch request cannot overwrite a page after navigation", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  let resolveAliases;
  api.state.hnAliasesPromise = new Promise((resolve) => {
    resolveAliases = resolve;
  });
  location.hash = "#/hn-watch/hn123";

  const pending = api.renderHNWatch("hn123");
  location.hash = "#/";
  view.innerHTML = "new route";
  resolveAliases({});
  await pending;

  assert.equal(view.innerHTML, "new route");
});


test("mixed custom playlists load HN entries into the main video queue", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const hn = sampleHNVideo("hn456");
  const main = {
    id: "main123",
    title: "Main catalog video",
    channel: "Main channel",
    channel_id: "channel1",
    views: 100,
    year: 2024,
    topics: [],
    duration: 180,
    kind: "tutorial",
    level: "any",
    score: 1,
  };

  api.state.videos = [main];
  api.state.byId = new Map([[main.id, main]]);
  api.state.hnById = new Map();
  api.state.hnVideosPromise = null;
  api.state.playlists = [{ id: "pl_test", name: "Mixed", ids: [main.id, hn.vid] }];
  api.state.channels = new Map();
  api.setFetchJson(async (file) => file === "data/hacker-news/videos.json" ? [hn] : {});
  location.hash = "#/watch/main123?list=pl_test&autoplay=1";

  await api.renderWatch(main.id, "pl_test", true);

  assert.ok(view.innerHTML.includes('id="youtube-player"'));
  assert.ok(view.innerHTML.includes("playlist=hn456"));
});

test("mixed iframe queues switch watch routes at catalog boundaries", () => {
  const { api, location } = createHarness();
  const hn = sampleHNVideo("hn456");
  const main = { id: "main123", title: "Main", channel: "Main", topics: [], views: 1 };
  api.state.byId = new Map([[main.id, main]]);
  api.state.hnById = new Map([[hn.vid, hn]]);

  location.hash = "#/watch/main123?list=pl_test&autoplay=1";
  api.syncWatchVideo(hn.vid, "pl_test");
  assert.equal(location.hash, "#/hn-watch/hn456?list=pl_test&autoplay=1");

  location.hash = "#/hn-watch/hn456?list=pl_test&autoplay=1";
  api.syncWatchVideo(main.id, "pl_test");
  assert.equal(location.hash, "#/watch/main123?list=pl_test&autoplay=1");
});

test("HN watch uses the YouTube iframe with native controls and preserves playlist context", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const hn = sampleHNVideo("hn123");
  const main = { id: "main123", title: "Main", channel: "Main", topics: [], views: 10 };
  api.state.hnVideosPromise = Promise.resolve([hn]);
  api.state.hnById = new Map([[hn.vid, hn]]);
  api.state.hnExistingPromise = Promise.resolve({});
  api.state.hnRelatedPromise = Promise.resolve({});
  api.state.hnAliasesPromise = Promise.resolve({});
  api.state.hnMentionPartitions.set("h", Promise.resolve({ [hn.vid]: [] }));
  api.state.playlists = [{ id: "pl_test", name: "Mixed", ids: [hn.vid, main.id] }];
  api.state.byId = new Map([[main.id, main]]);
  location.hash = "#/hn-watch/hn123?list=pl_test&autoplay=1";

  await api.renderHNWatch(hn.vid, "pl_test", true);

  assert.equal(api.state.current, hn.vid);
  assert.equal(api.state.seen[0], hn.vid);
  assert.ok(view.innerHTML.includes('id="youtube-player"'));
  assert.ok(view.innerHTML.includes("youtube-nocookie.com/embed/hn123"));
  const frameSrc = view.innerHTML.match(/src="(https:\/\/www\.youtube-nocookie\.com\/embed\/[^"]+)"/)?.[1];
  assert.ok(frameSrc, "HN watch should render an embedded YouTube player");
  assert.equal(new URL(frameSrc).searchParams.get("controls"), "1");
  assert.ok(!view.innerHTML.includes("<video"));
  assert.ok(!view.innerHTML.includes("data-player-toggle"));
  assert.ok(view.innerHTML.includes('data-act="like"'));
  assert.ok(view.innerHTML.includes('data-act="save"'));
});



test("saved legacy Hacker News records restore from existing.json after reload", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const legacy = sampleHNVideo("legacy123");
  api.state.videos = [];
  api.state.byId = new Map();
  api.state.hnById = new Map();
  api.state.hnVideosPromise = null;
  api.state.hnExisting = null;
  api.state.hnExistingPromise = null;
  api.state.likes = new Set([legacy.vid]);
  api.state.saved = new Set([legacy.vid]);
  api.state.seen = [legacy.vid];
  api.state.playlists = [{ id: "pl_legacy", name: "Legacy", ids: [legacy.vid] }];

  api.setFetchJson(async (file) => {
    if (file === "data/hacker-news/videos.json") return [];
    if (file === "data/hacker-news/existing.json") return { [legacy.vid]: legacy };
    throw new Error("Unexpected data request: " + file);
  });

  location.hash = "#/liked";
  await api.renderCollection("liked");
  assert.ok(view.innerHTML.includes("Hacker News sample video"));
  assert.ok(view.innerHTML.includes('data-remove="liked"'));

  location.hash = "#/later";
  await api.renderCollection("later");
  assert.ok(view.innerHTML.includes('data-remove="later"'));

  location.hash = "#/history";
  await api.renderCollection("history");
  assert.ok(view.innerHTML.includes('data-remove="history"'));

  location.hash = "#/playlists";
  await api.renderPlaylists();
  assert.ok(view.innerHTML.includes("/vi/legacy123/"));

  location.hash = "#/playlist/pl_legacy";
  await api.renderPlaylist("pl_legacy");
  assert.ok(view.innerHTML.includes('href="#/hn-watch/legacy123?list=pl_legacy&autoplay=1"'));
});


test("main-catalog playlist entries remain playable when HN data loading fails", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const first = {
    id: "main123",
    title: "First catalog video",
    channel: "Main channel",
    channel_id: "channel1",
    views: 100,
    topics: [],
    duration: 120,
  };
  const second = {
    ...first,
    id: "main456",
    title: "Second catalog video",
  };

  api.state.videos = [first, second];
  api.state.byId = new Map([[first.id, first], [second.id, second]]);
  api.state.hnById = new Map();
  api.state.hnExisting = null;
  api.state.hnVideosPromise = null;
  api.state.hnExistingPromise = null;
  api.state.playlists = [{ id: "pl_test", name: "Mixed", ids: [first.id, "hn_missing", second.id] }];
  api.state.channels = new Map();
  api.setFetchJson(async (file) => {
    throw new Error("HN data unavailable: " + file);
  });
  location.hash = "#/watch/main123?list=pl_test&autoplay=1";

  await api.renderWatch(first.id, "pl_test", true);

  assert.ok(view.innerHTML.includes("youtube-nocookie.com/embed/main123"));
  assert.ok(view.innerHTML.includes("playlist=main456"));
});

test("HN watch uses the actual route when query parameter order differs", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const hn = sampleHNVideo("hn123");
  api.state.hnVideosPromise = Promise.resolve([hn]);
  api.state.hnById = new Map([[hn.vid, hn]]);
  api.state.hnExistingPromise = Promise.resolve({});
  api.state.hnRelatedPromise = Promise.resolve({});
  api.state.hnAliasesPromise = Promise.resolve({});
  api.state.hnMentionPartitions.set("h", Promise.resolve({ [hn.vid]: [] }));
  api.state.playlists = [{ id: "pl_test", name: "Single", ids: [hn.vid] }];
  location.hash = "#/hn-watch/hn123?autoplay=1&list=pl_test";

  await api.renderHNWatch(hn.vid, "pl_test", true);

  assert.ok(view.innerHTML.includes('class="watch hn-watch"'));
  assert.ok(!view.innerHTML.includes("Loading video and archived comments"));
});

test("single-video HN playlists use YouTube controls and preserve autoplay", async () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  const hn = sampleHNVideo("hn123");
  api.state.hnVideosPromise = Promise.resolve([hn]);
  api.state.hnById = new Map([[hn.vid, hn]]);
  api.state.hnExistingPromise = Promise.resolve({});
  api.state.hnRelatedPromise = Promise.resolve({});
  api.state.hnAliasesPromise = Promise.resolve({});
  api.state.hnMentionPartitions.set("h", Promise.resolve({ [hn.vid]: [] }));
  api.state.playlists = [{ id: "pl_test", name: "Single", ids: [hn.vid] }];
  location.hash = "#/hn-watch/hn123?list=pl_test&autoplay=1";

  await api.renderHNWatch(hn.vid, "pl_test", true);

  assert.ok(view.innerHTML.includes("youtube-nocookie.com/embed/hn123"));
  const frameSrc = view.innerHTML.match(/src="(https:\/\/www\.youtube-nocookie\.com\/embed\/[^"]+)"/)?.[1];
  assert.ok(frameSrc);
  const params = new URL(frameSrc).searchParams;
  assert.equal(params.get("controls"), "1");
  assert.equal(params.get("autoplay"), "1");
  assert.ok(view.innerHTML.includes('id="youtube-player"'));
  assert.ok(!view.innerHTML.includes("data-youtube-toggle"));
  assert.ok(!view.innerHTML.includes("data-youtube-seek"));
  assert.ok(!view.innerHTML.includes("<video"));
});



test("YouTube embeds always use the original player controls", () => {
  const { api } = createHarness();
  const markup = api.youtubeIframeMarkup("video123", "Test video");
  const src = markup.match(/src="([^"]+)"/)?.[1];
  assert.ok(src, "the iframe should have a source URL");
  const params = new URL(src).searchParams;
  assert.equal(params.get("controls"), "1");
  assert.equal(params.get("fs"), "1");
  assert.equal(params.get("disablekb"), "0");
  assert.equal(params.get("iv_load_policy"), "1");
  assert.ok(!markup.includes('id="youtube-player"'));
  assert.ok(!markup.includes("data-youtube-toggle"));

  const queueMarkup = api.youtubeIframeMarkup("video123", "Test video", ["video123", "video456"]);
  const queueSrc = queueMarkup.match(/src="([^"]+)"/)?.[1];
  assert.ok(queueMarkup.includes('id="youtube-player"'), "playlist playback should retain its API target");
  assert.equal(new URL(queueSrc).searchParams.get("controls"), "1");
  assert.equal(new URL(queueSrc).searchParams.get("playlist"), "video456");
});


test("Settings no longer expose Playback or Stream API options", () => {
  const { api, view } = createHarness();
  api.renderSettings();

  for (const label of ["Playback", "Custom YouTube controls", "Direct video playback", "Stream API URL", "trycloudflare.com"]) {
    assert.ok(!view.innerHTML.includes(label), `settings should not contain ${label}`);
  }
  assert.ok(view.innerHTML.includes("Browsing"));
});


test("ordinary single-video playback does not load the iframe API", async () => {
  const harness = createHarness();
  const { api, document, location } = harness;
  const markup = api.youtubeIframeMarkup("video123", "Test video");
  assert.ok(!markup.includes('id="youtube-player"'));

  location.hash = "#/watch/video123";
  await api.startYouTubePlayer("video123", ["video123"], null, location.hash);
  assert.equal(document.head, undefined, "single videos should not request the playlist API");
});


test("YouTube API timeout leaves native iframe controls available and permits a retry", async () => {
  const harness = createHarness();
  const { api, context, document, location } = harness;
  const markup = api.youtubeIframeMarkup("video123", "Test video", ["video123", "video456"]);
  const src = markup.match(/src="([^"]+)"/)?.[1];
  assert.ok(src, "a playlist should render an iframe source");
  assert.equal(new URL(src).searchParams.get("controls"), "1");
  assert.ok(markup.includes('id="youtube-player"'));

  const timeoutCallbacks = new Map();
  let nextTimerId = 1;
  context.setTimeout = (callback, delay) => {
    assert.equal(delay, 35000);
    const timerId = nextTimerId++;
    timeoutCallbacks.set(timerId, callback);
    return timerId;
  };
  context.clearTimeout = (timerId) => timeoutCallbacks.delete(timerId);

  let appendedScripts = 0;
  document.createElement = (tag) => {
    assert.equal(tag, "script");
    return { src: "", onerror: null };
  };
  document.head = {
    appendChild(script) {
      assert.equal(script.src, "https://www.youtube.com/iframe_api");
      appendedScripts += 1;
    },
  };

  const iframe = { src, isConnected: true };
  document.querySelector = (selector) => selector === "#youtube-player" ? iframe : null;
  context.window.YT = undefined;
  location.hash = "#/watch/video123?list=pl_test";

  const pending = api.startYouTubePlayer("video123", ["video123", "video456"], "pl_test", location.hash);
  assert.equal(appendedScripts, 1, "playlist playback should request the iframe API");
  assert.equal(timeoutCallbacks.size, 1, "the readiness timeout should be armed");

  const [timerId, onTimeout] = timeoutCallbacks.entries().next().value;
  timeoutCallbacks.delete(timerId);
  onTimeout();
  await pending;

  assert.equal(new URL(iframe.src).searchParams.get("controls"), "1");
  assert.ok(!markup.includes("data-youtube-toggle"), "the iframe does not depend on custom controls");

  const retry = api.loadYouTubeIframeApi();
  assert.equal(appendedScripts, 2, "a timeout should clear the cached promise so the API can be retried");
  assert.equal(timeoutCallbacks.size, 1, "a retry should arm a fresh readiness timeout");
  const [retryTimerId, onRetryTimeout] = timeoutCallbacks.entries().next().value;
  timeoutCallbacks.delete(retryTimerId);
  onRetryTimeout();
  await assert.rejects(retry, /did not become ready in time/);
});

test("HN comment partitions use a lowercase, case-insensitive prefix", async () => {
  const harness = createHarness();
  const requested = [];
  harness.context.fetch = async (url) => {
    requested.push(url);
    return { status: 404, ok: false };
  };

  const comments = await harness.api.loadHNMentions("AbCdEfGhIjK");
  assert.equal(comments.length, 0);
  assert.deepEqual(requested, ["data/hacker-news/mentions/a.json.gz"]);
});
