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
  const sidebar = { innerHTML: "", addEventListener() {} };
  const brandLocale = { textContent: "EN" };
  const searchInput = { value: "" };
  const storage = new Map();
  const document = {
    title: "",
    querySelector(selector) {
      if (selector === "#q") return searchInput;
      if (selector === "#sidebar") return sidebar;
      if (selector === "#brandLocale") return brandLocale;
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
    location: { hash: "#/", origin: "https://example.test", pathname: "/", search: "" },
    history: { replaceState() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
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
    source + "\nglobalThis.__testApi = { state, ui, render, renderCategories, feedHashFromState, applyHNFilterParams, hnHashFromState, langAttrs, field, progressFor, saveProgress, card, videoWatchHref, playlistPlaybackHref, youtubeIframeMarkup, playerContainerMarkup, loadYouTubeIframeApi, startYouTubePlayer, watchActionsHTML, watchActionMenuOpensUp, renderSettings, renderRouteSkeleton, renderSidebar, applyBrandLocale, renderFeed, buildHomeOrder, markSeen, diverseCreatorPlaylists, renderHackerNews, renderHNWatch, renderWatch, renderCollection, renderPlaylists, renderPlaylist, playlistCard, toggleAct, addToPlaylist, syncWatchVideo, loadHNMentions, setFetchJson(fn) { fetchJson = fn; } };",
    context,
    { filename: "public/app.js" },
  );
  vm.runInContext("syncSidebar = () => {}; toast = () => {}; renderHNEvidence = () => {}; startPlaylistPlayer = () => {};", context);

  return {
    api: context.__testApi,
    context,
    document,
    location: context.location,
    sidebar,
    brandLocale,
    view,
  };
}

function sampleHNVideo(id = "hn123", overrides = {}) {  return {
    vid: id,
    title: "Hacker News sample video",
    channel: "Sample channel",
    score: 3.7,
    primary_topic: "AI",
    recommenders: 4,
    hn: { recommenders: 4 },
    categories: [{ id: "software-engineering", name: "Software engineering", area: "software", area_name: "Software Engineering & Languages" }],
    tags: [],
    content_type: "talk",
    level: "general",
    shelf_life: "evergreen",
    ...overrides,
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
  assert.ok(markup.includes('id="youtube-player"'));
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


test("single-video playback keeps an iframe API target for progress tracking", () => {
  const { api } = createHarness();
  const markup = api.youtubeIframeMarkup("video123", "Test video");
  assert.ok(markup.includes('id="youtube-player"'));
  assert.ok(!markup.includes("data-youtube-toggle"));
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

test("HN cards label score-zero videos as discussed", () => {
  const { api } = createHarness();
  const discussed = sampleHNVideo("discussed123", {
    score: 0,
    recommenders: 0,
    hn: { recommenders: 0 },
  });
  const markup = api.card(discussed);

  assert.ok(markup.includes("Discussed"));
  assert.ok(!markup.includes("HN 0.0"));
  assert.ok(markup.includes("Discussed, not recommended"));
});

test("HN list defaults to programming scope and can switch to All HN", async () => {
  const harness = createHarness();
  harness.location.hash = "#/hacker-news";
  const software = sampleHNVideo("software1", { title: "Software engineering video" });
  const comedy = sampleHNVideo("comedy1", {
    title: "Stand-up comedy video",
    categories: [{
      id: "standup-sketch-comedy",
      name: "Stand-up & sketch comedy",
      area: "arts-entertainment",
      area_name: "Arts, Comedy, Music & Film",
    }],
  });
  setVideoLoader(harness, [software, comedy]);

  await harness.api.renderHackerNews("");
  assert.match(harness.view.innerHTML, /Software engineering video/);
  assert.doesNotMatch(harness.view.innerHTML, /Stand-up comedy video/);

  harness.api.state.hnFilters.scope = "all";
  await harness.api.renderHackerNews("");
  assert.match(harness.view.innerHTML, /Software engineering video/);
  assert.match(harness.view.innerHTML, /Stand-up comedy video/);
});

test("HN recommendation filtering and score sorting work together", async () => {
  const harness = createHarness();
  harness.location.hash = "#/hacker-news";
  const top = sampleHNVideo("top123", {
    title: "Top recommended video",
    score: 9,
    recommenders: 9,
    hn: { recommenders: 9, mentions: 10 },
  });
  const lower = sampleHNVideo("lower123", {
    title: "Lower recommended video",
    score: 2,
    recommenders: 1,
    hn: { recommenders: 1, mentions: 50 },
  });
  const discussed = sampleHNVideo("discussed123", {
    title: "Discussed-only video",
    score: 0,
    recommenders: 0,
    hn: { recommenders: 0 },
  });
  setVideoLoader(harness, [lower, top, discussed]);

  await harness.api.renderHackerNews("");
  const sortedHtml = harness.view.innerHTML;
  assert.ok(sortedHtml.indexOf("Top recommended video") < sortedHtml.indexOf("Lower recommended video"));
  assert.match(sortedHtml, /Discussed-only video/);

  harness.api.state.hnFilters.sort = "recommenders";
  await harness.api.renderHackerNews("");
  assert.ok(harness.view.innerHTML.indexOf("Top recommended video") < harness.view.innerHTML.indexOf("Lower recommended video"));

  harness.api.state.hnFilters.sort = "mentions";
  await harness.api.renderHackerNews("");
  assert.ok(harness.view.innerHTML.indexOf("Lower recommended video") < harness.view.innerHTML.indexOf("Top recommended video"));

  harness.api.state.hnFilters.sort = "best";
  harness.api.state.hnFilters.recommendation = "recommended";
  await harness.api.renderHackerNews("");
  assert.match(harness.view.innerHTML, /Top recommended video/);
  assert.doesNotMatch(harness.view.innerHTML, /Discussed-only video/);

  harness.api.state.hnFilters.recommendation = "discussed";
  await harness.api.renderHackerNews("");
  assert.match(harness.view.innerHTML, /Discussed-only video/);
  assert.doesNotMatch(harness.view.innerHTML, /Top recommended video/);
});

test("HN filter panel exposes scope, recommendation, type, level, shelf life, area, and sort", async () => {
  const harness = createHarness();
  harness.location.hash = "#/hacker-news";
  setVideoLoader(harness, [sampleHNVideo("software1")]);
  harness.api.state.hnUiOpen = true;
  await harness.api.renderHackerNews("");
  const html = harness.view.innerHTML;

  assert.match(html, /data-hn-scope="programming"/);
  assert.match(html, /data-hn-scope="all"/);
  for (const name of ["recommendation", "contentType", "level", "shelfLife", "area", "sort"]) {
    assert.match(html, new RegExp(`data-select-toggle="${name}"`));
  }
  assert.match(html, /data-hn-clear/);
});

function sampleMainVideo(id, overrides = {}) {
  return {
    id,
    title: `${id} video`,
    channel: `Channel ${id}`,
    channel_id: `channel_${id}`,
    views: 100,
    year: 2024,
    topics: ["web"],
    level: "any",
    kind: "tutorial",
    lang: "en",
    score: 1,
    duration: 300,
    ...overrides,
  };
}

test("Home For you uses the personalized order while Best sorts by score", () => {
  const harness = createHarness();
  const low = sampleMainVideo("low", { title: "Low score video", score: 1 });
  const high = sampleMainVideo("high", { title: "High score video", score: 9 });
  harness.api.state.videos = [low, high];
  harness.api.state.homeOrder = [low, high];
  harness.api.state.homeStale = false;

  harness.api.ui.sort = "foryou";
  harness.api.renderFeed({ type: "all" });
  let html = harness.view.innerHTML;
  assert.ok(html.includes("data-refresh-home"));
  assert.ok(html.indexOf("Low score video") < html.indexOf("High score video"));

  harness.api.ui.sort = "best";
  harness.api.renderFeed({ type: "all" });
  html = harness.view.innerHTML;
  assert.ok(html.indexOf("High score video") < html.indexOf("Low score video"));
});

test("Home order keeps first-page channel diversity and invalidates after watching", () => {
  const harness = createHarness();
  const videos = Array.from({ length: 40 }, (_, index) => sampleMainVideo(`v${index}`, {
    channel: `Channel ${index % 20}`,
    channel_id: `channel_${index % 20}`,
    topics: [`topic${index}`],
  }));
  harness.api.state.videos = videos;
  const order = harness.api.buildHomeOrder(videos, () => 0.5);

  assert.equal(order.length, videos.length);
  const firstPageCounts = new Map();
  for (const video of order.slice(0, 36)) {
    firstPageCounts.set(video.channel_id, (firstPageCounts.get(video.channel_id) || 0) + 1);
  }
  assert.ok([...firstPageCounts.values()].every((count) => count <= 2));

  harness.api.markSeen("v0");
  assert.equal(harness.api.state.homeStale, true);
});

test("Home order prefers substantial courses over shorts at equal score", () => {
  const harness = createHarness();
  const course = sampleMainVideo("course", {
    kind: "course", duration: 3600, topics: ["python"], channel_id: "channel_course",
  });
  const short = sampleMainVideo("short", {
    kind: "short", duration: 90, topics: ["python"], channel_id: "channel_short",
  });

  const order = harness.api.buildHomeOrder([short, course], () => 0.5);

  assert.equal(order[0].id, "course");
});

test("creator playlists preview diversifies channels and supports filtering", async () => {
  const harness = createHarness();
  const { api, view, location } = harness;
  location.hash = "#/playlists";
  const playlists = [];
  for (let channel = 0; channel < 20; channel += 1) {
    for (let item = 0; item < 3; item += 1) {
      playlists.push({
        id: `playlist_${channel}_${item}`,
        title: `Course ${channel}-${item}`,
        channel: `Channel ${channel}`,
        channel_id: `channel_${channel}`,
        count: 5,
        cover: `cover${channel}${item}`,
      });
    }
  }
  api.state.builtin = playlists;

  const preview = api.diverseCreatorPlaylists(playlists, 24);
  assert.equal(preview.length, 24);
  assert.equal(new Set(preview.map((playlist) => playlist.channel_id)).size, 20);

  await api.renderPlaylists();
  assert.match(view.innerHTML, /data-playlist-filter/);
  assert.match(view.innerHTML, /data-select-group="playlists"/);
  assert.match(view.innerHTML, /data-select-opt="channel"/);
  assert.match(view.innerHTML, /class="select-menu"/);
  assert.doesNotMatch(view.innerHTML, /<select/);
  assert.match(view.innerHTML, /data-more-playlists/);
  assert.match(view.innerHTML, /Course 0-0/);
  assert.match(view.innerHTML, /Course 1-0/);
  assert.doesNotMatch(view.innerHTML, /Course 0-2/);

  api.state.playlistQuery = "Course 3-1";
  await api.renderPlaylists();
  assert.match(view.innerHTML, /Course 3-1/);
  assert.doesNotMatch(view.innerHTML, /Course 3-0/);
  assert.match(view.innerHTML, /1 of 60/);

  api.state.playlistQuery = "";
  api.state.playlistChannel = "channel_3";
  await api.renderPlaylists();
  assert.match(view.innerHTML, /Course 3-0/);
  assert.match(view.innerHTML, /Course 3-2/);
  assert.doesNotMatch(view.innerHTML, /Course 4-0/);
  assert.match(view.innerHTML, /3 of 60/);
  assert.match(view.innerHTML, /data-playlist-clear/);
});

test("HN renders a preview before the full catalog resolves", async () => {
  const harness = createHarness();
  harness.location.hash = "#/hacker-news";
  let resolveFull;
  harness.api.setFetchJson((file) => {
    if (file === "data/hacker-news/videos-preview.json") {
      return Promise.resolve([sampleHNVideo("preview1", { title: "Preview video" })]);
    }
    if (file === "data/hacker-news/videos.json") {
      return new Promise((resolve) => { resolveFull = resolve; });
    }
    throw new Error("Unexpected data request: " + file);
  });

  const pending = harness.api.renderHackerNews("");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(harness.view.innerHTML, /Preview video/);
  assert.doesNotMatch(harness.view.innerHTML, /class="count"/, "the feed head should not print a count");

  resolveFull([sampleHNVideo("full1", { title: "Full catalog video" })]);
  await pending;
  assert.match(harness.view.innerHTML, /Full catalog video/);
  assert.doesNotMatch(harness.view.innerHTML, /Preview video/);
});

test("feed filters hydrate from shareable URLs and categories use real links", () => {
  const harness = createHarness();
  const { api, location, view } = harness;
  api.state.meta = {
    total: 2,
    topics: [{ id: "web", label: "Web" }, { id: "python", label: "Python" }],
    channels: [],
    playlists: [],
  };
  api.state.topicLabels = { web: "Web", python: "Python" };
  api.state.videos = [
    sampleMainVideo("web1", { topics: ["web"], lang: "ar", views: 50 }),
    sampleMainVideo("py1", { topics: ["python"], lang: "en", views: 500 }),
  ];
  location.hash = "#/?topics=web&lang=ar&sort=views";

  api.render();

  assert.deepEqual([...api.ui.topics], ["web"]);
  assert.equal(api.ui.lang, "ar");
  assert.equal(api.ui.sort, "views");
  assert.match(view.innerHTML, /web1 video/);
  assert.doesNotMatch(view.innerHTML, /py1 video/);
  assert.equal(api.feedHashFromState(), "#/?topics=web&lang=ar&sort=views");

  api.renderCategories();
  assert.match(view.innerHTML, /href="#\/\?topics=web"/);
  assert.match(view.innerHTML, /href="#\/\?topics=python"/);
});

test("watch actions include a share control", () => {
  const { api } = createHarness();
  const markup = api.watchActionsHTML("video123");
  assert.match(markup, /data-share/);
  assert.match(markup, />Share</);
});

test("HN filters hydrate from shareable URLs", () => {
  const { api } = createHarness();
  api.applyHNFilterParams(new URLSearchParams("hnScope=all&hnRecommendation=discussed&hnSort=mentions"));

  assert.equal(api.state.hnFilters.scope, "all");
  assert.equal(api.state.hnFilters.recommendation, "discussed");
  assert.equal(api.state.hnFilters.sort, "mentions");
  assert.equal(
    api.hnHashFromState(""),
    "#/hacker-news?hnScope=all&hnRecommendation=discussed&hnSort=mentions",
  );
});

test("Arabic text carries language and direction attributes", () => {
  const { api } = createHarness();
  const arabic = {
    id: "arabic1",
    title: "دورة بايثون للمبتدئين",
    channel: "قناة عربية",
    views: 100,
    year: 2024,
    topics: ["python"],
    duration: 900,
  };
  const english = {
    id: "english1",
    title: "Python for Beginners",
    channel: "English Channel",
    views: 100,
    year: 2024,
    topics: ["python"],
    duration: 900,
  };

  assert.equal(api.langAttrs(arabic.title), ' lang="ar" dir="rtl"');
  assert.equal(api.langAttrs(english.title), ' lang="en" dir="ltr"');
  assert.match(api.card(arabic), /class="card-title"[^>]*lang="ar" dir="rtl"/);
  assert.match(api.card(english), /class="card-title"[^>]*lang="en" dir="ltr"/);
});

test("filter select markup exposes an accessible listbox", () => {
  const { api } = createHarness();
  const markup = api.field("lang", "Language", "All languages", [["ar", "Arabic"]], "ar", "ui");
  assert.match(markup, /aria-controls="select-ui-lang"/);
  assert.match(markup, /id="select-ui-lang"/);
  assert.match(markup, /role="listbox"/);
  assert.match(markup, /role="option" tabindex="-1"/);
});

test("the document includes a skip link to the main content", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /class="skip-link" href="#view"/);
});

test("watch progress is stored, rendered on cards, and offered as resume", () => {
  const { api } = createHarness();
  api.saveProgress("video123", 120, 600);

  const progress = api.progressFor("video123");
  assert.equal(progress.position, 120);
  assert.equal(progress.duration, 600);

  const cardMarkup = api.card(sampleMainVideo("video123"));
  assert.match(cardMarkup, /class="card-progress"/);
  assert.match(cardMarkup, /width:20%/);

  const actions = api.watchActionsHTML("video123");
  assert.match(actions, /data-resume="video123"/);
  assert.match(actions, /Resume at 2:00/);

  api.saveProgress("video123", 590, 600);
  assert.equal(api.progressFor("video123"), null);
});

test("history shows a Continue watching section for partial videos", async () => {
  const harness = createHarness();
  const { api, location } = harness;
  const video = sampleMainVideo("resume1", { title: "Resume this video" });
  api.state.videos = [video];
  api.state.byId = new Map([[video.id, video]]);
  api.state.seen = [video.id];
  api.saveProgress(video.id, 180, 900);
  location.hash = "#/history";

  await api.renderCollection("history");

  assert.match(harness.view.innerHTML, /Continue watching/);
  assert.match(harness.view.innerHTML, /Resume this video/);
  assert.match(harness.view.innerHTML, /class="card-progress"/);
});

test("main watch pages render a description when the catalog provides one", async () => {
  const harness = createHarness();
  const { api, location } = harness;
  const video = sampleMainVideo("desc1", {
    title: "Video with description",
    description: "An Arabic explanation of the topic.",
  });
  api.state.videos = [video];
  api.state.byId = new Map([[video.id, video]]);
  api.state.channels = new Map([["channel_desc1", { name: video.channel, count: 1 }]]);
  api.state.topicLabels = { web: "Web Development" };
  location.hash = "#/watch/desc1";

  await api.renderWatch(video.id);

  assert.match(harness.view.innerHTML, /id="watch-description"/);
  assert.match(harness.view.innerHTML, /An Arabic explanation of the topic/);
});

test("the document loads the i18n runtime and a language picker", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.ok(html.indexOf('i18n.js?v=1') < html.indexOf('app.js?v='));
  assert.doesNotMatch(html, /id="localeSelect"/);
  assert.match(html, /id="i-language"/);
  assert.match(html, /data-i18n="app.title"/);
  assert.match(html, /data-i18n-attr="placeholder:header.searchPlaceholder,aria-label:header.search"/);
});

test("language selection lives in Settings and uses site-styled buttons", () => {
  const { api, view } = createHarness();
  api.renderSettings();
  assert.match(view.innerHTML, /data-locale-pref="en"/);
  assert.match(view.innerHTML, /data-locale-pref="ar"/);
  assert.match(view.innerHTML, /class="active"[^>]*data-locale-pref="en"|data-locale-pref="en"[^>]*class="active"/);
  assert.doesNotMatch(view.innerHTML, /localeSelect/);
  assert.match(view.innerHTML, /data-install-app/);
  assert.match(view.innerHTML, /Install HackerTube/);
});

test("icon-and-label buttons collapse to their icon on mobile", () => {
  const { api, view } = createHarness();
  api.renderSettings();
  for (const label of ["Light", "Dark", "System"]) {
    assert.match(view.innerHTML, new RegExp(`data-theme-pref="[^"]+"[^>]*aria-label="${label}"`));
    assert.match(view.innerHTML, new RegExp(`title="${label}"`));
  }

  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(css, /\.btn:has\(> \.ic\):not\(\.filter-btn\):not\(\.watch-action-item\):not\(\.resume-btn\):not\(\.keep-label\)/);
  assert.match(css, /\.segmented button:has\(> \.ic\) \{/);
  assert.match(css, /font-size: 0;/);
});

test("route skeletons match the current page instead of showing feed cards everywhere", () => {
  const harness = createHarness();
  const { api, location, view } = harness;

  location.hash = "#/settings";
  api.renderRouteSkeleton();
  assert.match(view.innerHTML, /skeleton-settings/);
  assert.doesNotMatch(view.innerHTML, /skeleton-card-grid/);

  location.hash = "#/";
  api.renderRouteSkeleton();
  assert.match(view.innerHTML, /skeleton-card-grid/);

  location.hash = "#/watch/video123";
  api.renderRouteSkeleton();
  assert.match(view.innerHTML, /skeleton-watch/);
  assert.match(view.innerHTML, /sk-player/);

  location.hash = "#/playlists";
  api.renderRouteSkeleton();
  assert.match(view.innerHTML, /skeleton-playlist-grid/);

  location.hash = "#/categories";
  api.renderRouteSkeleton();
  assert.match(view.innerHTML, /skeleton-tile-grid/);
});


test("sidebar navigation no longer shows per-link counts", () => {
  const harness = createHarness();
  harness.api.state.meta = {
    total: 12096,
    channels: [{ id: "channel_1", name: "Channel 1", count: 10 }],
    topics: [{ id: "web", label: "Web", count: 10 }],
  };
  harness.api.renderSidebar();
  assert.doesNotMatch(harness.sidebar.innerHTML, /data-count/);
  assert.doesNotMatch(harness.sidebar.innerHTML, /side-count/);
  assert.doesNotMatch(harness.sidebar.innerHTML, /side-foot/);
});

test("the brand locale badge follows the active UI locale", () => {
  const harness = createHarness();
  harness.api.applyBrandLocale("ar");
  assert.equal(harness.brandLocale.textContent, "AR");
  harness.api.applyBrandLocale("en");
  assert.equal(harness.brandLocale.textContent, "EN");
});

test("Hacker News no longer renders its intro paragraph", async () => {
  const harness = createHarness();
  harness.location.hash = "#/hacker-news";
  setVideoLoader(harness, [sampleHNVideo("hn1")]);
  await harness.api.renderHackerNews("");
  assert.doesNotMatch(harness.view.innerHTML, /hn-intro/);
  assert.doesNotMatch(harness.view.innerHTML, /Videos recommended or discussed/);
});

test("Like and Watch later stay beside More while the rest stay inside the menu", () => {
  const harness = createHarness();
  const { api } = harness;
  api.saveProgress("video123", 120, 600);
  const markup = api.watchActionsHTML("video123");
  const toggle = markup.indexOf("data-watch-actions-toggle");
  const menu = markup.indexOf("watch-action-items");

  assert.ok(markup.indexOf('data-act="like"') < toggle, "Like should precede the More toggle");
  assert.ok(markup.indexOf('data-act="save"') < toggle, "Watch later should precede the More toggle");
  assert.ok(menu > toggle, "the menu should follow the toggle");
  assert.ok(menu < markup.indexOf("data-resume"), "Resume belongs in the menu");
  assert.ok(menu < markup.indexOf("data-share"), "Share belongs in the menu");
  assert.ok(menu < markup.indexOf("watch-youtube"), "YouTube belongs in the menu");
  assert.doesNotMatch(markup.slice(menu), /data-act=/, "Like/Watch later should not be duplicated in the menu");

  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(css, /\.watch-actions-toggle \{ display: inline-flex; \}/);
  assert.match(css, /\.watch-action-items \{ display: none; \}/);
  assert.match(css, /\.watch-actions\.menu-open\.drop-up \.watch-action-items \{/);
  assert.match(css, /\.watch-main \.player \{ width: calc\(100% \+ 28px\); margin-inline: -14px; border-radius: 0; \}/);
  assert.match(css, /html \{ scrollbar-gutter: auto; \}/);

  assert.equal(api.watchActionMenuOpensUp(400, 100, 250), true, "more room above should open upward");
  assert.equal(api.watchActionMenuOpensUp(100, 400, 250), false, "more room below should open downward");
  assert.equal(api.watchActionMenuOpensUp(300, 300, 250), false, "enough room below keeps it downward");
  assert.equal(api.watchActionMenuOpensUp(200, 150, 300), true, "insufficient room below and more above opens upward");
});

test("Add to playlist opens an inline submenu inside the actions menu", () => {
  const { api } = createHarness();
  const markup = api.watchActionsHTML("video123");
  assert.match(markup, /class="drop watch-submenu"/);
  assert.match(markup, /watch-submenu[\s\S]*drop-panel/);

  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(css, /\.watch-actions\.menu-open \.watch-action-items \{[\s\S]*?max-height:[^;]+;[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.watch-action-items \.watch-submenu \.drop-panel \{[\s\S]*?position: static;[\s\S]*?max-height: 200px;/);
  assert.doesNotMatch(css, /\.watch-submenu\.submenu-(left|right)/);
});

test("watch players expose the mobile drag handle without extra controls", async () => {
  const harness = createHarness();
  const { api, location } = harness;
  const video = sampleMainVideo("mini1", { title: "Mini player video" });
  api.state.videos = [video];
  api.state.byId = new Map([[video.id, video]]);
  api.state.channels = new Map([["channel_mini1", { name: video.channel, count: 1 }]]);
  api.state.topicLabels = { web: "Web Development" };
  location.hash = "#/watch/mini1";

  await api.renderWatch(video.id);

  const markup = harness.view.innerHTML;
  assert.equal((markup.match(/class="player"/g) || []).length, 1, "the player must not be nested twice");
  assert.match(markup, /class="mini-frame"/);
  assert.match(markup, /class="mini-bar"/);
  assert.match(markup, /data-mini-back/);
  assert.match(markup, /data-mini-size/);
  assert.match(markup, /data-mini-close/);
  assert.match(markup, /data-player-grab/);
  assert.doesNotMatch(markup, /mini-controls|data-mini-toggle|data-mini-seek|type="range"/);
  assert.match(markup, /id="youtube-player"/);

  const wrapper = api.playerContainerMarkup('<iframe id="youtube-player"></iframe>');
  assert.equal((wrapper.match(/class="player"/g) || []).length, 1);
  assert.ok(wrapper.indexOf("mini-bar") < wrapper.indexOf('id="youtube-player"'));
  assert.ok(wrapper.indexOf('id="youtube-player"') < wrapper.indexOf("data-player-grab"));

  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(css, /\.player-grab:hover/);
  assert.match(css, /\.player-grab\.grab-visible/);
  assert.match(css, /\.watch-main \.player\.grab-idle \.player-grab/);
});

test("the mini player window keeps the native YouTube controls and uses the MingCute share icon", () => {
  const root = path.join(__dirname, "..", "public");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  const share = html.match(/<symbol id="i-share"[\s\S]*?<\/symbol>/)?.[0] || "";
  assert.match(share, /m16\.136 8\.081/, "share should use the MingCute share-2 path");
  assert.doesNotMatch(share, /M18 16\.08/);
  assert.match(html, /<symbol id="i-expand-player"/);
  assert.match(html, /<symbol id="i-miniplayer"/);
  assert.match(html, /<div id="mini-host" hidden><\/div>/);

  assert.match(css, /\.mini-frame\.mini-player \{/);
  assert.match(css, /\.mini-frame\.mini-player\.mini-large \{/);
  assert.match(css, /\.mini-frame\.mini-player \.mini-bar \{/);
  assert.match(css, /\.mini-frame\.mini-player \.player-grab \{ display: none; \}/);
  assert.doesNotMatch(css, /\.player\.mini-player iframe \{ pointer-events: none; \}/);
  assert.doesNotMatch(css, /\.mini-(toggle|seek|controls)/);

  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n", "en.json"), "utf8"));
  const ar = JSON.parse(fs.readFileSync(path.join(root, "i18n", "ar.json"), "utf8"));
  for (const key of ["minimize", "playerWindow", "backToVideo", "enlarge", "shrink", "closePlayer"]) {
    assert.ok(en.watch[key], `en watch.${key} is missing`);
    assert.ok(ar.watch[key], `ar watch.${key} is missing`);
  }
});

test("filter dropdowns stack above the video grid and playlists reuse the shared menu", () => {
  const harness = createHarness();
  const markup = harness.api.field("channel", "Channel", "All channels", [["c1", "Creator 1"]], "", "playlists", false);
  assert.doesNotMatch(markup, /filter-label/);
  assert.match(markup, /aria-label="Channel"/);
  assert.match(markup, /data-select-group="playlists"/);

  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  const filtersRule = css.match(/\.filters \{([\s\S]*?)\}/)?.[1] || "";
  assert.match(filtersRule, /position: relative/);
  assert.match(filtersRule, /z-index: 20/);

  const plFilterRule = css.match(/\.pl-filter \{([\s\S]*?)\}/)?.[1] || "";
  assert.match(plFilterRule, /position: relative/);
  assert.match(plFilterRule, /z-index: 20/);
  assert.match(css, /\.pl-filter \.select-btn \{/);
});
