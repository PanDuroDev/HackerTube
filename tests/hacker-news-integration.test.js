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
    source + "\nglobalThis.__testApi = { state, card, videoWatchHref, playlistPlaybackHref, youtubeIframeMarkup, loadYouTubeIframeApi, startYouTubePlayer, watchActionsHTML, renderHNWatch, renderWatch, renderCollection, renderPlaylists, renderPlaylist, playlistCard, toggleAct, addToPlaylist, syncWatchVideo, setFetchJson(fn) { fetchJson = fn; } };",
    context,
    { filename: "public/app.js" },
  );
  vm.runInContext("syncSidebar = () => {}; toast = () => {}; renderHNEvidence = () => {}; startPlaylistPlayer = () => {};", context);

  return {
    api: context.__testApi,
    context,
    document,
    location: context.location,
    storage,
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

test("HN watch preserves native playback controls while sharing actions and playlist context", async () => {
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
  api.state.settings.nativePlayer = true;
  location.hash = "#/hn-watch/hn123?list=pl_test&autoplay=1";

  await api.renderHNWatch(hn.vid, "pl_test", true);

  assert.equal(api.state.current, hn.vid);
  assert.equal(api.state.seen[0], hn.vid);
  assert.ok(view.innerHTML.includes('id="native-video-player"'));
  assert.ok(view.innerHTML.includes('data-player-toggle'));
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

test("single-video HN playlist uses custom player controls and keeps autoplay enabled", async () => {
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
  assert.ok(view.innerHTML.includes("controls=0"));
  assert.ok(view.innerHTML.includes("autoplay=1"));
  assert.ok(view.innerHTML.includes('id="youtube-player"'));
  assert.ok(view.innerHTML.includes('data-youtube-toggle'));
  assert.ok(view.innerHTML.includes('data-youtube-seek'));
  assert.ok(view.innerHTML.includes('data-youtube-speed'));
});

test("YouTube control preference restores native controls without custom controls", () => {
  const { api } = createHarness();
  const customMarkup = api.youtubeIframeMarkup("video123", "Test video");
  const customSrc = customMarkup.match(/src="([^"]+)"/)?.[1];
  assert.ok(customSrc, "custom mode should render an iframe source");
  const customParams = new URL(customSrc).searchParams;
  assert.equal(customParams.get("controls"), "0");
  assert.equal(customParams.get("fs"), "0", "YouTube fullscreen control should be hidden");
  assert.equal(customParams.get("disablekb"), "1", "YouTube keyboard controls should be disabled");
  assert.equal(customParams.get("iv_load_policy"), "3", "video annotations should be disabled");
  assert.ok(customMarkup.includes('data-youtube-toggle'));
  assert.ok(!customMarkup.includes("youtube-player-frame--cropped"));
  assert.ok(!customMarkup.includes("data-youtube-start"));

  api.state.settings.hideYoutubeOverlays = true;
  const croppedMarkup = api.youtubeIframeMarkup("video123", "Test video");
  assert.ok(croppedMarkup.includes("youtube-player-frame--cropped"));
  assert.ok(croppedMarkup.includes('data-youtube-start disabled'));
  assert.ok(croppedMarkup.includes("https://i.ytimg.com/vi/video123/hqdefault.jpg"));

  api.state.settings.customYoutubeControls = false;
  const nativeMarkup = api.youtubeIframeMarkup("video123", "Test video");
  const nativeSrc = nativeMarkup.match(/src="([^"]+)"/)?.[1];
  assert.ok(nativeSrc, "native mode should render an iframe source");
  const nativeParams = new URL(nativeSrc).searchParams;
  assert.equal(nativeParams.get("controls"), "1");
  assert.equal(nativeParams.get("fs"), "1");
  assert.equal(nativeParams.get("disablekb"), "0");
  assert.equal(nativeParams.get("iv_load_policy"), "1");
  assert.ok(!nativeMarkup.includes("data-youtube-toggle"));
  assert.ok(!nativeMarkup.includes('id="youtube-player"'));
});


test("YouTube API failure restores native iframe controls and removes custom controls", async () => {
  const harness = createHarness();
  const { api, context, location } = harness;
  api.state.settings.hideYoutubeOverlays = true;
  const customMarkup = api.youtubeIframeMarkup("video123", "Test video");
  const customSrc = customMarkup.match(/src="([^"]+)"/)?.[1];
  assert.ok(customSrc, "custom mode should render an iframe source");
  assert.ok(customMarkup.includes("youtube-player-frame--cropped"));

  let customControlsRemoved = false;
  const customControls = {
    remove() {
      customControlsRemoved = true;
    },
  };
  let cropClassRemoved = false;
  let startOverlayRemoved = false;
  const croppedFrame = {
    classList: {
      remove(className) {
        assert.equal(className, "youtube-player-frame--cropped");
        cropClassRemoved = true;
      },
    },
    querySelector(selector) {
      return selector === "[data-youtube-start]"
        ? { remove() { startOverlayRemoved = true; } }
        : null;
    },
  };
  const playerContainer = {
    querySelector(selector) {
      if (selector === "#youtube-player") return iframe;
      if (selector === ".youtube-controls") return customControls;
      if (selector === ".youtube-player-frame") return croppedFrame;
      return null;
    },
  };
  const iframe = {
    src: customSrc,
    isConnected: true,
    closest(selector) {
      assert.equal(selector, ".player");
      return playerContainer;
    },
  };

  context.document.querySelector = (selector) =>
    selector === "#youtube-player" ? iframe : null;
  context.window.YT = {
    Player: class {
      constructor() {
        throw new Error("Simulated YouTube player initialization failure");
      }
    },
  };
  location.hash = "#/watch/video123";

  await api.startYouTubePlayer("video123", ["video123"], null, location.hash);

  const restoredParams = new URL(iframe.src).searchParams;
  assert.equal(restoredParams.get("controls"), "1");
  assert.equal(restoredParams.get("fs"), "1");
  assert.equal(restoredParams.get("disablekb"), "0");
  assert.equal(restoredParams.get("iv_load_policy"), "1");
  assert.equal(customControlsRemoved, true, "custom controls should be removed after fallback");
  assert.equal(cropClassRemoved, true, "the crop mode should be removed after fallback");
  assert.equal(startOverlayRemoved, true, "the custom start overlay should be removed after fallback");
});


test("YouTube API readiness timeout restores native controls and permits a retry", async () => {
  const harness = createHarness();
  const { api, context, document, location } = harness;
  const customMarkup = api.youtubeIframeMarkup("video123", "Test video");
  const customSrc = customMarkup.match(/src="([^"]+)"/)?.[1];
  assert.ok(customSrc, "custom mode should render an iframe source");

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

  let customControlsRemoved = false;
  const customControls = { remove() { customControlsRemoved = true; } };
  const iframe = {
    src: customSrc,
    isConnected: true,
    closest(selector) {
      assert.equal(selector, ".player");
      return playerContainer;
    },
  };
  const playerContainer = {
    querySelector(selector) {
      if (selector === "#youtube-player") return iframe;
      if (selector === ".youtube-controls") return customControls;
      return null;
    },
  };
  document.querySelector = (selector) =>
    selector === "#youtube-player" ? iframe : null;
  context.window.YT = undefined;
  location.hash = "#/watch/video123";

  const pending = api.startYouTubePlayer("video123", ["video123"], null, location.hash);
  assert.equal(appendedScripts, 1, "the API script should be requested");
  assert.equal(timeoutCallbacks.size, 1, "the readiness timeout should be armed");

  const [timerId, onTimeout] = timeoutCallbacks.entries().next().value;
  timeoutCallbacks.delete(timerId);
  onTimeout();
  await pending;

  const restoredParams = new URL(iframe.src).searchParams;
  assert.equal(restoredParams.get("controls"), "1");
  assert.equal(restoredParams.get("fs"), "1");
  assert.equal(restoredParams.get("disablekb"), "0");
  assert.equal(restoredParams.get("iv_load_policy"), "1");
  assert.equal(customControlsRemoved, true, "custom controls should be removed after timeout");

  const retry = api.loadYouTubeIframeApi();
  assert.equal(appendedScripts, 2, "a timeout should clear the cached promise so the API can be retried");
  assert.equal(timeoutCallbacks.size, 1, "a retry should arm a fresh readiness timeout");
  const [retryTimerId, onRetryTimeout] = timeoutCallbacks.entries().next().value;
  timeoutCallbacks.delete(retryTimerId);
  onRetryTimeout();
  await assert.rejects(retry, /did not become ready in time/);
});


test("cropped YouTube overlay mode follows cued, playing, and ended states", async () => {
  const harness = createHarness();
  const { api, context, location } = harness;
  api.state.settings.hideYoutubeOverlays = true;
  api.state.current = "video123";

  const overlay = { hidden: false };
  const playerContainer = {
    querySelector(selector) {
      return selector === "[data-youtube-start]" ? overlay : null;
    },
  };
  const iframe = {
    isConnected: true,
    closest(selector) {
      assert.equal(selector, ".player");
      return playerContainer;
    },
  };
  let playerOptions;
  context.document.querySelector = (selector) =>
    selector === "#youtube-player" ? iframe : null;
  context.window.YT = {
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, CUED: 5, UNSTARTED: -1 },
    Player: class {
      constructor(target, options) {
        assert.equal(target, iframe);
        playerOptions = options;
      }
    },
  };
  location.hash = "#/watch/video123";

  await api.startYouTubePlayer("video123", ["video123"], null, location.hash);
  assert.ok(playerOptions, "the iframe API player should be initialized");

  playerOptions.events.onStateChange({ data: context.window.YT.PlayerState.CUED });
  assert.equal(overlay.hidden, false, "the custom start overlay should cover the cued YouTube overlay");

  playerOptions.events.onStateChange({
    data: context.window.YT.PlayerState.PLAYING,
    target: { getVideoData: () => ({ video_id: "video123" }) },
  });
  assert.equal(overlay.hidden, true, "the custom poster should disappear during playback");

  playerOptions.events.onStateChange({ data: context.window.YT.PlayerState.ENDED });
  assert.equal(overlay.hidden, false, "the custom replay poster should cover YouTube's end overlay");
});
