/* Static UI, no frameworks: data from public/data, all state in the browser. */

const KIND_LABELS = { course: "Course", tutorial: "Tutorial", project: "Project", talk: "Talk", short: "Short" };
const LEVEL_LABELS = { beginner: "Beginner", advanced: "Advanced", any: "General" };
const TOPIC_LABELS = {
  python: "Python", javascript: "JavaScript", web: "Web Development", php: "PHP",
  java: "Java", cpp: "C++", csharp: "C#", mobile: "Mobile", database: "Databases",
  linux: "Linux", devops: "DevOps & Cloud", git: "Git", security: "Security",
  ai: "AI", data: "Data Analysis", algorithms: "Algorithms", cs: "Computer Science",
  testing: "Testing", networking: "Networking", tools: "Dev Tools",
};
const TOPIC_SEARCH_ALIASES = {
  python: "py بايثون",
  javascript: "js جافاسكربت جافا سكريبت nodejs",
  web: "frontend front end تطوير الويب",
  php: "لارافيل",
  java: "جافا",
  cpp: "c++ cplusplus c plus plus سي بلس بلس",
  csharp: "c# c sharp dotnet .net سي شارب",
  mobile: "android ios flutter kotlin اندرويد كوتلن",
  database: "sql mysql postgres mongodb داتا بيز قواعد البيانات",
  linux: "لينكس اوبونتو",
  devops: "cloud kubernetes docker ديفوبس",
  git: "github جيت",
  security: "cyber hacking cybersecurity امن سيبراني",
  ai: "machine learning deep learning artificial intelligence ml ذكاء اصطناعي تعلم الاله",
  data: "data science data analysis تحليل البيانات علم البيانات",
  algorithms: "data structures هياكل البيانات داتا ستركتشر",
  cs: "computer science علوم الحاسوب علوم الحاسب",
  testing: "qa tests اختبار",
  networking: "شبكات",
  tools: "ide editors ادوات المطور",
};
const DEFAULTS = { pageSize: 36, hideSeen: false, nativePlayer: false };
const STORE = { likes: "ht_likes", later: "ht_saved", seen: "ht_seen", playlists: "ht_playlists", settings: "ht_settings", theme: "ht_theme", homeRecent: "ht_home_recent" };

const state = {
  videos: [],
  meta: null,
  byId: new Map(),
  searchEngine: null,
  hnVideos: null,
  hnVideosPromise: null,
  hnRelated: null,
  hnRelatedPromise: null,
  hnAliases: null,
  hnAliasesPromise: null,
  hnById: new Map(),
  hnSearchEngine: null,
  hnExisting: null,
  hnExistingPromise: null,
  hnMentionPartitions: new Map(),
  hnQuery: null,
  hnLimit: 36,
  topicLabels: {},
  channels: new Map(),
  likes: new Set(storeGet(STORE.likes, [])),
  saved: new Set(storeGet(STORE.later, [])),
  seen: storeGet(STORE.seen, []),
  playlists: storeGet(STORE.playlists, []).filter((p) => p && p.id && Array.isArray(p.ids)),
  settings: Object.assign({}, DEFAULTS, storeGet(STORE.settings, {})),
  theme: storeGet(STORE.theme, "dark"),
  longCount: 0,
  scope: { type: "all" },
  current: null,
  homeOrder: [],
  builtin: [],
  builtinIds: null,
  showAllPlaylists: false,
};
const ui = { topics: new Set(), lang: "", level: "", kind: "", duration: "", year: "", channel: "", sort: "best", limit: pageSize(), open: false };
let pendingTopic = null;
let playlistPlayer = null;
let youtubeApiPromise = null;
const STREAM_API_BASE_URL = "https://hackertube-stream-api.onrender.com";
let isMobileLayout = matchMedia("(max-width: 980px)").matches;

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const videos = (n) => `${n} ${n === 1 ? "video" : "videos"}`;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

init();

async function init() {
  applyTheme(state.theme);
  if (matchMedia("(max-width: 980px)").matches) setSidebar(false);
  $("#menuBtn").addEventListener("click", () => {
    if (matchMedia("(max-width: 980px)").matches) setSidebar(!$("#sidebar").classList.contains("open"));
    else {
      const collapsed = document.body.classList.toggle("side-collapsed");
      $("#menuBtn").setAttribute("aria-expanded", String(!collapsed));
    }
  });
  $("#scrim").addEventListener("click", () => setSidebar(false));
  $("#themeBtn").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q").value.trim();
    const currentHash = location.hash || "#/";
    const inHackerNews = currentHash.startsWith("#/hacker-news") || currentHash.startsWith("#/hn-watch");
    const next = q
      ? `${inHackerNews ? "#/hacker-news/" : "#/search/"}${encodeURIComponent(q)}`
      : (inHackerNews ? "#/hacker-news" : "#/");
    if (location.hash === next) render();
    else location.hash = next;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#q").focus();
    }
    if (e.key === "Escape") {
      setSidebar(false);
      closeSelects();
      closeWatchActionMenu(true);
    }
    if (e.key === "Tab" && matchMedia("(max-width: 980px)").matches && $("#sidebar").classList.contains("open")) {
      const focusable = $("#sidebar").querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });
  addEventListener("resize", () => {
    const nextMobileLayout = matchMedia("(max-width: 980px)").matches;
    if (nextMobileLayout === isMobileLayout) return;
    isMobileLayout = nextMobileLayout;
    setSidebar(false);
  });
  if (matchMedia("(prefers-color-scheme: dark)").addEventListener) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.theme === "system") applyTheme("system");
    });
  }

  view.addEventListener("click", onViewClick);
  view.addEventListener("change", onViewChange);
  view.addEventListener("submit", onViewSubmit);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".select")) closeSelects();
    if (!e.target.closest(".watch-actions")) closeWatchActionMenu();
  });

  try {
    const [videos, meta] = await Promise.all([
      fetchJson("data/videos.json"),
      fetchJson("data/meta.json"),
    ]);
    state.videos = videos;
    state.meta = meta;
    state.builtin = meta.playlists || [];
    state.homeOrder = buildHomeOrder(videos);
    state.byId = new Map(videos.map((v) => [v.id, v]));
    state.channels = new Map(meta.channels.map((c) => [c.id, c]));
    state.topicLabels = Object.fromEntries(meta.topics.map((t) => [t.id, TOPIC_LABELS[t.id] || t.label]));
    state.searchEngine = new window.HackerTubeSearch.SearchIndex(videos, (video) => ({
      title: video.title,
      channel: video.channel,
      topics: (video.topics || []).map((topic) => [
        topic,
        TOPIC_LABELS[topic] || topic,
        TOPIC_SEARCH_ALIASES[topic] || "",
      ].join(" ")).join(" "),
      metadata: [
        KIND_LABELS[video.kind],
        LEVEL_LABELS[video.level],
        video.lang === "ar" ? "Arabic عربي" : "English",
        video.year,
      ].join(" "),
      id: video.id,
    }));
    state.longCount = videos.filter((v) => v.duration >= 1200).length;
    renderSidebar();
    addEventListener("hashchange", () => {
      setSidebar(false);
      scrollTo({ top: 0, left: 0, behavior: "instant" });
      render();
    });
    render();
  } catch (err) {
    view.innerHTML = `<div class="error"><strong>Could not load the data.</strong>
      <p>Run the site from a local server: <code>python -m http.server 8080 -d public</code></p>
      <p>${esc(err.message)}</p></div>`;
  }
}

function fetchJson(url) {
  return fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  });
}

function pageSize() {
  const n = Number(state.settings.pageSize);
  return [24, 36, 60].includes(n) ? n : DEFAULTS.pageSize;
}

function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/* ---------- Search normalization ---------- */

function normalizeAr(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\w\u0600-\u06FF+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- Formatting ---------- */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDuration(seconds) {
  const s = Math.max(0, seconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const TOAST_ICONS = {
  check: "check",
  liked: "liked",
  later: "later",
  playlists: "playlists",
  plus: "plus",
  close: "close",
  trash: "trash",
  info: "playlists",
};

function toast(message, kind = "check") {
  const el = $("#toast");
  el.querySelector(".toast-ic").innerHTML = icon(TOAST_ICONS[kind] || TOAST_ICONS.check);
  el.querySelector(".toast-msg").textContent = message;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

function applyTheme(pref) {
  state.theme = pref;
  storeSet(STORE.theme, pref);
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0f0f0f" : "#ffffff";
  const btn = $("#themeBtn");
  btn.innerHTML = icon(dark ? "sun" : "moon");
  btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

function setSidebar(open) {
  const mobile = matchMedia("(max-width: 980px)").matches;
  const sidebar = $("#sidebar");

  if (mobile) {
    if (open) document.body.classList.remove("side-collapsed");
    sidebar.classList.toggle("open", open);
    sidebar.setAttribute("aria-hidden", String(!open));
    sidebar.inert = !open;
    $("#scrim").hidden = !open;
    document.body.classList.toggle("menu-open", open);

    if (open) sidebar.querySelector(".side-close")?.focus();
    else if (sidebar.contains(document.activeElement)) $("#menuBtn").focus();

    $("#menuBtn").setAttribute("aria-expanded", String(open));
    return;
  }

  if (sidebar.contains(document.activeElement)) $("#menuBtn").focus();
  sidebar.classList.remove("open");
  sidebar.removeAttribute("aria-hidden");
  sidebar.inert = false;
  $("#scrim").hidden = true;
  document.body.classList.remove("menu-open");
  $("#menuBtn").setAttribute("aria-expanded", String(!document.body.classList.contains("side-collapsed")));
}

/* ---------- Routing ---------- */

function render() {
  if (playlistPlayer) {
    playlistPlayer.destroy();
    playlistPlayer = null;
  }
  const hash = location.hash || "#/";
  const path = hash.replace(/^#\/?/, "");
  const [seg, ...rest] = path.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  state.current = null;
  ui.open = false;

  if (!seg || seg === "home") {
    resetFilters();
    if (pendingTopic) {
      ui.topics = new Set([pendingTopic]);
      pendingTopic = null;
    }
    return renderFeed({ type: "all" });
  }
  if (seg === "longs") {
    resetFilters();
    return renderFeed({ type: "longs", title: "Long videos", minDuration: 1200 });
  }
  if (seg === "search") {
    resetFilters();
    return renderFeed({ type: "search", q: arg, title: `Results for “${arg}”` });
  }
  if (seg === "channel") {
    const ch = state.channels.get(arg);
    if (!ch) return renderNotFound();
    resetFilters();
    return renderFeed({ type: "channel", channel: arg, title: ch.name });
  }
  if (seg === "liked") return renderCollection("liked");
  if (seg === "later" || seg === "saved") return renderCollection("later");
  if (seg === "history") return renderCollection("history");
  if (seg === "categories") return renderCategories();
  if (seg === "hacker-news") return renderHackerNews(arg);
  if (seg === "hn-watch") return renderHNWatch(arg);
  if (seg === "playlists") return renderPlaylists();
  if (seg === "playlist") return arg.startsWith("pl_") ? renderPlaylist(arg) : renderBuiltinPlaylist(arg);
  if (seg === "settings") return renderSettings();
  if (seg === "watch") {
    const queryIndex = arg.indexOf("?");
    const id = queryIndex < 0 ? arg : arg.slice(0, queryIndex);
    const query = queryIndex < 0 ? "" : arg.slice(queryIndex + 1);
    return renderWatch(id, new URLSearchParams(query).get("list"));
  }
  if (seg === "channels") return renderChannels();
  return renderNotFound();
}

function renderSidebar() {
  const nav = [
    ["home", "#/", "home", "Home"],
    ["longs", "#/longs", "longs", "Longs"],
    ["liked", "#/liked", "liked", "Liked"],
    ["history", "#/history", "history", "History"],
    ["later", "#/later", "later", "Watch later"],
    ["categories", "#/categories", "categories", "Categories"],
    ["playlists", "#/playlists", "playlists", "Playlists"],
    ["hacker-news", "#/hacker-news", "categories", "Hacker News"],
    ["settings", "#/settings", "settings", "Settings"],
  ];
  $("#sidebar").innerHTML = `
    <div class="side-head">
      <span class="side-heading">Menu</span>
      <button class="icon-btn side-close" type="button" aria-label="Close menu">${icon("close")}</button>
    </div>
    <nav class="side-nav">
      ${nav.map(([key, href, ic, label]) => `<a class="side-link" data-nav="${key}" href="${href}" title="${label}">${icon(ic)}<span>${label}</span><span class="side-count" data-count="${key}"></span></a>`).join("")}
    </nav>
    <div class="side-title">Explore</div>
    <a class="side-link" data-nav="channels" href="#/channels" title="Channels">${icon("channels")}<span>Channels</span><span class="side-count" data-count="channels"></span></a>
    <p class="side-foot">${videos(state.meta.total)} · ${state.meta.channels.length} channels</p>`;
  syncSidebar();
  $("#sidebar").addEventListener("click", (e) => {
    if (e.target.closest(".side-close")) {
      setSidebar(false);
      return;
    }
    const a = e.target.closest("[data-nav]");
    if (!a) return;
    const target = a.getAttribute("href");
    if (target === (location.hash || "#/")) {
      if (a.dataset.nav === "home") resetFilters();
      setSidebar(false);
      render();
    }
  });
}

function syncSidebar() {
  if (!state.meta) return;
  const hash = location.hash || "#/";
  const map = {
    "#/": "home", "#/home": "home", "#/longs": "longs", "#/liked": "liked",
    "#/history": "history", "#/later": "later", "#/saved": "later",
    "#/categories": "categories", "#/playlists": "playlists", "#/settings": "settings",
    "#/channels": "channels",
  };
  const active = map[hash] || (hash.startsWith("#/playlist/") ? "playlists" : hash.startsWith("#/hacker-news") || hash.startsWith("#/hn-watch") ? "hacker-news" : "");
  document.querySelectorAll(".side-link[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === active);
  });
  const counts = {
    home: state.meta.total,
    longs: state.longCount,
    liked: state.likes.size,
    history: state.seen.length,
    later: state.saved.size,
    categories: state.meta.topics.length,
    playlists: state.playlists.length,
    channels: state.meta.channels.length,
  };
  document.querySelectorAll("[data-count]").forEach((el) => {
    el.textContent = counts[el.dataset.count] ?? "";
  });
}

/* ---------- Filtering ---------- */

function filterCount() {
  let n = ui.topics.size;
  ["lang", "level", "kind", "duration", "year", "channel"].forEach((k) => { if (ui[k]) n++; });
  return n;
}

function hasFilters() {
  return filterCount() > 0;
}

function resetFilters() {
  ui.topics.clear();
  ui.level = ui.kind = ui.duration = ui.year = ui.channel = ui.lang = "";
  ui.sort = "best";
  ui.limit = pageSize();
}

function filtered(scope) {
  const q = String(scope.q || "").trim();
  // SearchIndex covers the complete catalog; pagination happens only when rendering.
  const source = q && state.searchEngine
    ? state.searchEngine.search(q).map((result) => result.item)
    : state.videos;
  const results = source.filter((v) => {
    if (scope.minDuration && v.duration < scope.minDuration) return false;
    if (scope.channel && v.channel_id !== scope.channel) return false;
    if (scope.kind && v.kind !== scope.kind) return false;
    if (ui.topics.size && !v.topics.some((t) => ui.topics.has(t))) return false;
    if (ui.lang && v.lang !== ui.lang) return false;
    if (ui.level && v.level !== ui.level) return false;
    if (ui.kind && v.kind !== ui.kind) return false;
    if (ui.year && v.year !== Number(ui.year)) return false;
    if (ui.channel && v.channel_id !== ui.channel) return false;
    if (ui.duration) {
      const d = v.duration;
      if (ui.duration === "short" && d >= 300) return false;
      if (ui.duration === "mid" && (d < 300 || d > 1200)) return false;
      if (ui.duration === "long" && (d <= 1200 || d > 3600)) return false;
      if (ui.duration === "xl" && d <= 3600) return false;
    }
    if (state.settings.hideSeen && state.seen.includes(v.id) && scope.type !== "history") return false;
    return true;
  });
  // Keep relevance order for the default "Best" sort. Explicit sort modes still win.
  if (!q || ui.sort !== "best") results.sort(sorter(ui.sort));
  return results;
}

function sorter(sort) {
  if (sort === "newest") return (a, b) => b.year - a.year || b.score - a.score;
  if (sort === "views") return (a, b) => b.views - a.views;
  if (sort === "shortest") return (a, b) => a.duration - b.duration;
  if (sort === "longest") return (a, b) => b.duration - a.duration;
  return (a, b) => b.score - a.score;
}

/* ---------- Feed discovery ---------- */

// Build a local interest profile from explicit actions and recent viewing.
// All signals stay in localStorage; no account or remote tracking is involved.
function buildHomeOrder(videos) {
  const byId = new Map(videos.map((video) => [video.id, video]));
  const topicWeights = new Map();
  const channelWeights = new Map();
  const languageWeights = new Map();
  const signals = new Set();

  function addSignal(id, weight) {
    const video = byId.get(id);
    if (!video) return;
    signals.add(id);
    for (const topic of video.topics || []) {
      topicWeights.set(topic, (topicWeights.get(topic) || 0) + weight);
    }
    channelWeights.set(video.channel_id, (channelWeights.get(video.channel_id) || 0) + weight);
    languageWeights.set(video.lang, (languageWeights.get(video.lang) || 0) + weight);
  }

  for (const id of state.likes) addSignal(id, 3.2);
  for (const id of state.saved) addSignal(id, 1.9);
  for (const playlist of state.playlists) {
    for (const id of playlist.ids) addSignal(id, 2.1);
  }
  const history = state.seen.slice(0, 30);
  history.forEach((id, index) => {
    addSignal(id, 1.25 * (1 - index / Math.max(30, history.length)));
  });

  const maxTopic = Math.max(1, ...topicWeights.values());
  const maxChannel = Math.max(1, ...channelWeights.values());
  const maxLanguage = Math.max(1, ...languageWeights.values());
  const profileStrength = Math.min(1, signals.size / 8);
  const previousHome = new Set(storeGet(STORE.homeRecent, []));
  const recentlyWatched = new Set(history.slice(0, 12));

  // Weighted random sampling preserves discovery while letting quality and
  // local interests influence the odds instead of imposing a rigid ranking.
  const ranked = videos.map((video) => {
    const topicAffinity = Math.min(1.5, (video.topics || []).reduce(
      (sum, topic) => sum + (topicWeights.get(topic) || 0) / maxTopic, 0
    ));
    const channelAffinity = (channelWeights.get(video.channel_id) || 0) / maxChannel;
    const languageAffinity = (languageWeights.get(video.lang) || 0) / maxLanguage;
    const quality = Math.max(0, Number(video.score) || 0);
    const qualityBoost = Math.min(0.7, quality * 0.075);
    const seenPenalty = recentlyWatched.has(video.id) ? 0.48 : 0;
    const repeatPenalty = previousHome.has(video.id) ? 0.42 : 0;
    const interestBoost = profileStrength * (
      topicAffinity * 0.82 + languageAffinity * 0.18 + channelAffinity * 0.1
    );
    const utility = Math.max(-1, Math.min(1.5,
      qualityBoost + interestBoost - seenPenalty - repeatPenalty
    ));
    const weight = Math.exp(utility);
    return {
      video,
      key: -Math.log(Math.max(Math.random(), Number.EPSILON)) / weight,
    };
  }).sort((a, b) => a.key - b.key).map(({ video }) => video);

  // Greedy diversity constraints keep the first screen from being dominated
  // by one creator or topic. Relax them only if the catalog cannot fill it.
  const target = pageSize();
  const firstPage = [];
  const selected = new Set();
  const channelCounts = new Map();
  const topicCounts = new Map();
  const topicLimit = Math.max(5, Math.ceil(target / 4));

  function pick(video, channelLimit, enforceTopicLimit) {
    if (selected.has(video.id)) return false;
    if ((channelCounts.get(video.channel_id) || 0) >= channelLimit) return false;
    const primaryTopic = video.topics?.[0] || "";
    if (enforceTopicLimit && primaryTopic &&
        (topicCounts.get(primaryTopic) || 0) >= topicLimit) return false;
    selected.add(video.id);
    firstPage.push(video);
    channelCounts.set(video.channel_id, (channelCounts.get(video.channel_id) || 0) + 1);
    if (primaryTopic) topicCounts.set(primaryTopic, (topicCounts.get(primaryTopic) || 0) + 1);
    return true;
  }

  for (const video of ranked) {
    if (firstPage.length >= target) break;
    if (previousHome.has(video.id) || recentlyWatched.has(video.id)) continue;
    pick(video, 2, true);
  }
  for (const video of ranked) {
    if (firstPage.length >= target) break;
    pick(video, 2, true);
  }
  for (const video of ranked) {
    if (firstPage.length >= target) break;
    pick(video, 3, false);
  }

  const order = [...firstPage, ...ranked.filter((video) => !selected.has(video.id))];
  storeSet(STORE.homeRecent, firstPage.map((video) => video.id));
  return order;
}

/* ---------- Feed ---------- */

function renderFeed(scope) {
  state.scope = scope;
  if (scope.q !== undefined) $("#q").value = scope.q;
  else if (scope.type !== "search") $("#q").value = "";
  let list = filtered(scope);
  if (scope.type === "all" && ui.sort === "best" && state.homeOrder.length) {
    const rank = new Map(state.homeOrder.map((video, index) => [video.id, index]));
    list = list.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }
  const shown = list.slice(0, ui.limit);
  const title = scope.title || "";
  document.title = title ? `${title} — HackerTube` : "HackerTube";

  view.innerHTML = `<section class="feed">
    <div class="feed-head">
      ${title ? `<h1>${esc(title)}</h1>` : ""}
      <button class="btn filter-btn ${hasFilters() ? "on" : ""}" data-filter-toggle aria-expanded="${ui.open}">
        ${icon("filter")} Filters${hasFilters() ? ` <span class="filter-count">${filterCount()}</span>` : ""}
      </button>
      <span class="count">${videos(list.length)}</span>
    </div>
    ${ui.open ? filtersPanel() : ""}
    ${shown.length ? `<div class="grid">${shown.map((v) => card(v)).join("")}</div>` : emptyState()}
    ${list.length > ui.limit ? `<div class="more"><button class="btn" data-more>Show more (${list.length - ui.limit})</button></div>` : ""}
  </section>`;
  syncSidebar();
}

function filtersPanel() {
  const years = [...new Set(state.videos.map((v) => v.year).filter(Boolean))].sort((a, b) => b - a);
  const topics = state.meta.topics
    .map((t) => `<button class="chip ${ui.topics.has(t.id) ? "on" : ""}" data-topic="${t.id}" aria-pressed="${ui.topics.has(t.id)}">${esc(state.topicLabels[t.id] || t.id)}</button>`)
    .join("");
  const selects = [
    field("channel", "Channel", "All channels", state.meta.channels.map((c) => [c.id, c.name]), ui.channel),
    field("lang", "Language", "All languages", [["ar", "Arabic"], ["en", "English"]], ui.lang),
    field("level", "Level", "All levels", Object.entries(LEVEL_LABELS), ui.level),
    field("kind", "Type", "All types", Object.entries(KIND_LABELS), ui.kind),
    field("duration", "Duration", "Any length", [["short", "Under 5 min"], ["mid", "5–20 min"], ["long", "20–60 min"], ["xl", "Over 1 hour"]], ui.duration),
    field("year", "Year", "Any year", years.map((y) => [y, String(y)]), ui.year),
    field("sort", "Sort", "Best", [["newest", "Newest"], ["views", "Most viewed"], ["longest", "Longest"], ["shortest", "Shortest"]], ui.sort),
  ].join("");
  return `<div class="filters">
    <div class="filter-group">
      <span class="filter-label">Topic</span>
      <div class="chips">
        <button class="chip ${ui.topics.size ? "" : "on"}" data-topic="" aria-pressed="${!ui.topics.size}">All</button>
        ${topics}
      </div>
    </div>
    <div class="filter-grid">${selects}</div>
    <div class="filter-foot">
      <button class="btn" data-clear ${hasFilters() ? "" : "disabled"}>Clear all</button>
      <button class="btn primary" data-filter-close>Done</button>
    </div>
  </div>`;
}

function field(name, label, allLabel, options, current) {
  const cur = String(current);
  const isAll = cur === "" || (name === "sort" && cur === "best");
  const activeOption = options.find(([value]) => String(value) === cur);
  const shown = isAll || !activeOption ? allLabel : activeOption[1];
  const rows = [["", allLabel], ...options]
    .map(([value, text]) => {
      const on = value === "" ? isAll : String(value) === cur;
      return `<button type="button" class="select-opt ${on ? "on" : ""}" role="option" aria-selected="${on}" data-select-opt="${name}" data-value="${esc(value)}">${esc(text)}${on ? icon("check") : ""}</button>`;
    })
    .join("");
  return `<div class="filter-field">
    <span class="filter-label">${esc(label)}</span>
    <div class="select">
      <button type="button" class="select-btn" data-select-toggle="${name}" aria-haspopup="listbox" aria-expanded="false">
        <span>${esc(shown)}</span>${icon("chevron")}
      </button>
      <div class="select-menu" role="listbox" aria-label="${esc(label)}">${rows}</div>
    </div>
  </div>`;
}

function closeSelects() {
  document.querySelectorAll(".select.open").forEach((wrap) => {
    wrap.classList.remove("open");
    wrap.querySelector("[data-select-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function thumbSrc(id) {
  // YouTube exposes three sampled frames (hq1/hq2/hq3); pick one per video, stable across reloads.
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return `https://i.ytimg.com/vi/${id}/hq${(n % 3) + 1}.jpg`;
}

function card(v, opts = {}) {
  const later = state.saved.has(v.id);
  const remove = opts.remove
    ? `<button class="card-x" data-remove="${opts.remove}" data-id="${v.id}"${opts.playlist ? ` data-pl="${opts.playlist}"` : ""} aria-label="Remove">${icon("close")}</button>`
    : "";
  const topic = v.topics[0] ? ` · ${esc(state.topicLabels[v.topics[0]] || v.topics[0])}` : "";
  return `<article class="card">
    <div class="thumb">
      <a class="thumb-link" href="#/watch/${v.id}" aria-label="${esc(v.title)}">
        <img src="${thumbSrc(v.id)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'">
      </a>
      <button class="later-btn ${later ? "on" : ""}" data-later-toggle="${v.id}" aria-pressed="${later}" aria-label="${later ? "Remove from Watch later" : "Add to Watch later"}" title="Watch later">${icon("later")}</button>
      ${remove}
      <span class="dur">${fmtDuration(v.duration)}</span>
    </div>
    <div class="card-info">
      <a class="card-title" href="#/watch/${v.id}">${esc(v.title)}</a>
      <a class="card-sub" href="#/channel/${v.channel_id}">${esc(v.channel)}</a>
      <div class="card-sub">${compact.format(v.views)} views${v.year ? ` · ${v.year}` : ""}${topic}</div>
    </div>
  </article>`;
}

function emptyState() {
  return `<div class="empty">
    <strong>No matches</strong>
    <p>Try a different search or clear the filters.</p>
    ${hasFilters() ? '<button class="btn" data-clear>Clear filters</button>' : state.settings.hideSeen ? '<a class="btn" href="#/settings">Watched videos are hidden</a>' : '<a class="btn" href="#/categories">Browse categories</a>'}
  </div>`;
}

/* ---------- Watch ---------- */

async function renderWatch(id, playlistId = null) {
  const routeHash = location.hash;
  const v = state.byId.get(id);
  if (!v) return renderNotFound();
  state.current = id;
  markSeen(id);

  let queue = [];
  if (playlistId) {
    try {
      if (!state.builtinIds) state.builtinIds = fetchJson("data/playlists.json");
      const playlists = await state.builtinIds;
      const ids = Array.isArray(playlists[playlistId]) ? playlists[playlistId] : [];
      const index = ids.indexOf(id);
      if (index >= 0) queue = ids.slice(index).filter((videoId) => state.byId.has(videoId));
    } catch {
      state.builtinIds = null;
    }
  }
  if (location.hash !== routeHash) return;

  document.title = `${v.title} — HackerTube`;
  const related = state.videos
    .filter((x) => x.id !== v.id && x.topics.some((t) => v.topics.includes(t)))
    .sort((a, b) => shared(b, v) - shared(a, v) || b.score - a.score)
    .slice(0, 8);
  const liked = state.likes.has(id);
  const later = state.saved.has(id);
  const ch = state.channels.get(v.channel_id);
  const playlistPanel = state.playlists.length
    ? state.playlists.map((p) => `<button data-add-playlist="${p.id}">${icon("playlists")}<span>${esc(p.name)}</span><span class="side-count">${p.ids.length}</span></button>`).join("")
    : `<p>No playlists yet.</p><a href="#/playlists">Create one first</a>`;
  const playerMarkup = state.settings.nativePlayer
    ? `<video id="native-video-player" controls playsinline preload="metadata"
        aria-label="${esc(v.title)}"></video><p class="native-player-status" id="native-player-status" role="status">Preparing direct playback…</p>`
    : youtubeIframeMarkup(v.id, v.title, queue.length > 1 ? queue : null);

  view.innerHTML = `<section class="watch">
    <div class="watch-main">
      <div class="player">${playerMarkup}</div>
      <h1 class="watch-title">${esc(v.title)}</h1>
      <div class="watch-bar">
        <a class="watch-channel" id="watch-channel" href="#/channel/${v.channel_id}" title="${esc(v.channel)}">
          <span class="avatar" id="watch-avatar">${esc(v.channel.trim().charAt(0))}</span>
          <span class="watch-channel-text"><b id="watch-channel-name">${esc(v.channel)}</b><small id="watch-channel-count">${ch ? `${videos(ch.count)} indexed` : "Channel"}</small></span>
        </a>
        <div class="actions watch-actions">
          <button class="btn watch-actions-toggle" type="button" data-watch-actions-toggle
            aria-label="More video actions" aria-controls="watchActionItems" aria-expanded="false">
            ${icon("more")} <span>More</span>
          </button>
          <div class="watch-action-items" id="watchActionItems">
            <button class="btn watch-action-item ${liked ? "on" : ""}" id="watch-like" data-act="like" aria-pressed="${liked}">${icon("liked")} <span>${liked ? "Liked" : "Like"}</span></button>
            <button class="btn watch-action-item ${later ? "on" : ""}" id="watch-save" data-act="save" aria-pressed="${later}">${icon("later")} <span>${later ? "Saved" : "Watch later"}</span></button>
            <details class="drop">
              <summary class="btn watch-action-item">${icon("playlists")} <span>Add to playlist</span>${icon("down-small-fill")}</summary>
              <div class="drop-panel">${playlistPanel}</div>
            </details>
            <a class="btn watch-action-item watch-action-item--external watch-youtube" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">${icon("external")} YouTube</a>
          </div>
        </div>
      </div>
      <div class="watch-meta">
        <span>${icon("eye")} ${compact.format(v.views)} views</span>
        ${v.year ? `<span>${icon("calendar")} ${v.year}</span>` : ""}
        <span>${icon("clock")} ${fmtDuration(v.duration)}</span>
        <span>${icon("tag")} ${esc(KIND_LABELS[v.kind] || "Tutorial")}</span>
        <span>${icon("level")} ${esc(LEVEL_LABELS[v.level] || "General")}</span>
      </div>
      <section id="hn-evidence" class="hn-evidence" hidden></section>
    </div>
    <aside class="watch-side">
      <h2 class="section-title">Related videos</h2>
      <div class="related-grid">${related.map((x) => card(x)).join("") || '<p class="count">Nothing related yet.</p>'}</div>
    </aside>
  </section>`;
  syncSidebar();
  renderHNEvidence(id);
  if (state.settings.nativePlayer) startNativePlayer(v, queue, playlistId, routeHash);
  else if (queue.length > 1) startPlaylistPlayer(queue, playlistId, routeHash);
}

function youtubeIframeMarkup(videoId, title, queue = null) {
  const params = new URLSearchParams({ rel: "0", playsinline: "1" });
  if (queue && queue.length > 1) params.set("playlist", queue.slice(1).join(","));
  return `<iframe ${queue && queue.length > 1 ? 'id="youtube-player"' : ""}
    src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}"
    title="${esc(title)}" loading="lazy" allowfullscreen
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

async function startNativePlayer(video, queue, playlistId, routeHash) {
  const player = $("#native-video-player");
  const status = $("#native-player-status");
  if (!player || !status) return;
  if (queue.length > 1) {
    player.addEventListener("ended", () => {
      if (location.hash !== routeHash) return;
      const next = queue[queue.indexOf(video.id) + 1];
      if (next) location.hash = `#/watch/${encodeURIComponent(next)}?list=${encodeURIComponent(playlistId || "")}`;
    });
  }
  try {
    const response = await fetch(`${STREAM_API_BASE_URL}/api/stream/${encodeURIComponent(video.id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url) throw new Error(payload.error || `Stream service returned HTTP ${response.status}`);
    if (location.hash !== routeHash || !$("#native-video-player")) return;
    player.src = payload.url;
    player.load();
    status.remove();
    player.addEventListener("error", () => fallbackToYouTubePlayer(video, queue, playlistId, routeHash), { once: true });
  } catch (error) {
    fallbackToYouTubePlayer(video, queue, playlistId, routeHash, error);
  }
}

function fallbackToYouTubePlayer(video, queue, playlistId, routeHash, error = null) {
  const container = $(".player");
  if (!container || location.hash !== routeHash) return;
  container.innerHTML = youtubeIframeMarkup(video.id, video.title, queue);
  if (queue.length > 1) startPlaylistPlayer(queue, playlistId, routeHash);
  if (error) toast("Direct playback unavailable. Using YouTube player.", "info");
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      youtubeApiPromise = null;
      reject(new Error("Could not load the YouTube player API"));
    };
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

async function startPlaylistPlayer(queue, playlistId, routeHash) {
  const playerFrame = $("#youtube-player");
  if (!playerFrame) return;
  try {
    const YT = await loadYouTubeIframeApi();
    if (location.hash !== routeHash || !$("#youtube-player")) return;
    playlistPlayer = new YT.Player(playerFrame, {
      events: {
        onReady(event) {
          if (location.hash === routeHash) event.target.loadPlaylist(queue, 0, 0);
        },
        onStateChange(event) {
          if (event.data !== YT.PlayerState.PLAYING) return;
          const playingId = event.target.getVideoData()?.video_id;
          if (playingId && playingId !== state.current && queue.includes(playingId)) {
            syncWatchVideo(playingId, playlistId);
          }
        },
      },
    });
  } catch {
    if (location.hash !== routeHash || !$("#youtube-player")) return;
    const params = new URLSearchParams({
      rel: "0",
      autoplay: "1",
      playsinline: "1",
      playlist: queue.slice(1).join(","),
    });
    playerFrame.src = `https://www.youtube-nocookie.com/embed/${queue[0]}?${params}`;
  }
}

function syncWatchVideo(id, playlistId) {
  const video = state.byId.get(id);
  if (!video) return;
  state.current = id;
  markSeen(id);
  document.title = `${video.title} — HackerTube`;

  const channel = state.channels.get(video.channel_id);
  const channelLink = $("#watch-channel");
  const avatar = $("#watch-avatar");
  const channelName = $("#watch-channel-name");
  const channelCount = $("#watch-channel-count");
  if (channelLink) {
    channelLink.href = `#/channel/${video.channel_id}`;
    channelLink.title = video.channel;
  }
  if (avatar) avatar.textContent = video.channel.trim().charAt(0);
  if (channelName) channelName.textContent = video.channel;
  if (channelCount) channelCount.textContent = channel ? `${videos(channel.count)} indexed` : "Channel";

  const title = $(".watch-title");
  if (title) title.textContent = video.title;
  const likeButton = $("#watch-like");
  const saveButton = $("#watch-save");
  const liked = state.likes.has(id);
  const saved = state.saved.has(id);
  if (likeButton) {
    likeButton.classList.toggle("on", liked);
    likeButton.setAttribute("aria-pressed", String(liked));
    likeButton.innerHTML = `${icon("liked")} <span>${liked ? "Liked" : "Like"}</span>`;
  }
  if (saveButton) {
    saveButton.classList.toggle("on", saved);
    saveButton.setAttribute("aria-pressed", String(saved));
    saveButton.innerHTML = `${icon("later")} <span>${saved ? "Saved" : "Watch later"}</span>`;
  }
  const youtubeLink = $(".watch-youtube");
  if (youtubeLink) youtubeLink.href = `https://www.youtube.com/watch?v=${id}`;

  const meta = $(".watch-meta");
  if (meta) {
    meta.innerHTML = `<span>${icon("eye")} ${compact.format(video.views)} views</span>
      ${video.year ? `<span>${icon("calendar")} ${video.year}</span>` : ""}
      <span>${icon("clock")} ${fmtDuration(video.duration)}</span>
      <span>${icon("tag")} ${esc(KIND_LABELS[video.kind] || "Tutorial")}</span>
      <span>${icon("level")} ${esc(LEVEL_LABELS[video.level] || "General")}</span>`;
  }
  const related = state.videos
    .filter((item) => item.id !== video.id && item.topics.some((topic) => video.topics.includes(topic)))
    .sort((a, b) => shared(b, video) - shared(a, video) || b.score - a.score)
    .slice(0, 8);
  const relatedGrid = $(".related-grid");
  if (relatedGrid) {
    relatedGrid.innerHTML = related.map((item) => card(item)).join("")
      || '<p class="count">Nothing related yet.</p>';
  }
  renderHNEvidence(id);
  closeWatchActionMenu(true);
  history.replaceState(null, "", `${location.pathname}${location.search}#/watch/${encodeURIComponent(id)}?list=${encodeURIComponent(playlistId)}`);
}

function shared(a, b) {
  return a.topics.filter((t) => b.topics.includes(t)).length;
}

function markSeen(id) {
  state.seen = [id, ...state.seen.filter((x) => x !== id)].slice(0, 50);
  storeSet(STORE.seen, state.seen);
}

/* ---------- Hacker News recommendations ---------- */

async function loadHNVideos() {
  if (!state.hnVideosPromise) {
    state.hnVideosPromise = fetchJson("data/hacker-news/videos.json").then((records) => {
      state.hnVideos = records;
      state.hnById = new Map(records.map((record) => [record.vid, record]));
      state.hnSearchEngine = new window.HackerTubeSearch.SearchIndex(records, (record) => ({
        title: record.title,
        channel: record.channel,
        summary: record.summary,
        why_hn: record.why_hn,
        primary_topic: record.primary_topic,
        tags: (record.tags || []).join(" "),
        categories: (record.categories || []).map((category) =>
          [category.name, category.id].filter(Boolean).join(" ")
        ).join(" "),
        id: record.vid,
      }));
      return records;
    }).catch((error) => {
      state.hnVideosPromise = null;
      state.hnVideos = null;
      state.hnById = new Map();
      state.hnSearchEngine = null;
      throw error;
    });
  }
  return state.hnVideosPromise;
}

async function loadHNExisting() {
  if (!state.hnExistingPromise) {
    state.hnExistingPromise = fetchJson("data/hacker-news/existing.json").then((records) => {
      state.hnExisting = records;
      return records;
    }).catch((error) => {
      state.hnExistingPromise = null;
      state.hnExisting = null;
      throw error;
    });
  }
  return state.hnExistingPromise;
}

async function loadHNRelated() {
  if (!state.hnRelatedPromise) {
    state.hnRelatedPromise = fetchJson("data/hacker-news/related.json").then((records) => {
      state.hnRelated = records;
      return records;
    }).catch((error) => {
      state.hnRelatedPromise = null;
      state.hnRelated = null;
      throw error;
    });
  }
  return state.hnRelatedPromise;
}

async function loadHNAliases() {
  if (!state.hnAliasesPromise) {
    state.hnAliasesPromise = fetchJson("data/hacker-news/aliases.json").then((records) => {
      state.hnAliases = records;
      return records;
    }).catch((error) => {
      state.hnAliasesPromise = null;
      state.hnAliases = null;
      throw error;
    });
  }
  return state.hnAliasesPromise;
}

function hnAttributionHTML() {
  return `<p class="hn-attribution">
    Dataset: <a href="https://hackertube.org/" target="_blank" rel="noopener noreferrer">HackerTube</a>,
    derived from <a href="https://huggingface.co/datasets/open-index/hacker-news" target="_blank" rel="noopener noreferrer">open-index/hacker-news</a>.
    Licensed under <a href="https://opendatacommons.org/licenses/by/1-0/" target="_blank" rel="noopener noreferrer">ODC-By 1.0</a>.
    Video titles and channel names belong to their creators and are sourced from YouTube; comments remain their authors' work.
  </p>`;
}

async function loadHNMentions(videoId) {
  if (!videoId || !videoId[0]) return [];
  const prefix = videoId[0];
  if (!state.hnMentionPartitions.has(prefix)) {
    const promise = (async () => {
      const response = await fetch(`data/hacker-news/mentions/${encodeURIComponent(prefix)}.json.gz`, { cache: "no-cache" });
      if (response.status === 404) return {};
      if (!response.ok) throw new Error(`Hacker News comments: HTTP ${response.status}`);
      if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser cannot decompress the Hacker News comment data.");
      }
      if (!response.body) throw new Error("Hacker News comments response has no body.");
      const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    })().catch((error) => {
      state.hnMentionPartitions.delete(prefix);
      throw error;
    });
    state.hnMentionPartitions.set(prefix, promise);
  }
  const partition = await state.hnMentionPartitions.get(prefix);
  return partition[videoId] || [];
}

const HN_STANCE_LABELS = {
  strong_rec: "Strong recommendation",
  rec: "Recommendation",
  reference: "Reference",
  joke: "Joke",
  critical: "Critical",
};

function hnCommentsHTML(comments, unavailable = false) {
  if (unavailable) return '<p class="count">Archived Hacker News comments are temporarily unavailable. Reopen this page to retry.</p>';
  if (!comments.length) return '<p class="count">No archived Hacker News comments for this video.</p>';
  return `<div class="hn-comments">${comments.map((comment) => `
    <article class="hn-comment">
      <div class="hn-comment-head">
        <span><b>${esc(comment.author || "Anonymous")}</b> · ${esc(comment.month || "")}</span>
        <span>${esc(HN_STANCE_LABELS[comment.stance] || comment.stance || "Comment")}</span>
      </div>
      ${comment.story_title ? `<div class="hn-story">${esc(comment.story_title)}</div>` : ""}
      <p>${esc(comment.text || "")}</p>
      ${comment.why ? `<div class="hn-why">${esc(comment.why)}</div>` : ""}
      <a class="hn-source-link" href="${esc(comment.hn_url || "#")}" target="_blank" rel="noopener noreferrer">Open Hacker News comment</a>
    </article>`).join("")}</div>`;
}

function hnContextHTML(video, comments, commentsUnavailable = false) {
  const hn = video.hn || {};
  const quote = video.quote?.text
    ? `<blockquote class="hn-quote">“${esc(video.quote.text)}”${video.quote.year ? ` <span>· ${esc(video.quote.year)}</span>` : ""}</blockquote>`
    : "";
  const categories = (video.categories || []).map((category) =>
    `<span class="hn-tag">${esc(category.name)}</span>`).join("");
  const tags = (video.tags || []).map((tag) =>
    `<span class="hn-tag">${esc(tag)}</span>`).join("");
  return `
    <section class="hn-context">
      <h2 class="section-title">Hacker News context</h2>
      ${video.summary ? `<p class="hn-summary">${esc(video.summary)}</p>` : ""}
      ${video.why_hn ? `<p class="hn-why"><b>Why it is recommended:</b> ${esc(video.why_hn)}</p>` : ""}
      <div class="hn-stats">
        <span><b>${Number(hn.recommenders || 0)}</b> recommenders</span>
        <span><b>${Number(hn.rec_months || 0)}</b> recommendation months</span>
        <span><b>${Number(hn.mentions || comments.length || 0)}</b> archived comments</span>
        <span><b>${Number(video.score || 0).toFixed(1)}</b> HN score</span>
      </div>
      ${quote}
      ${categories ? `<div class="hn-tags">${categories}</div>` : ""}
      ${tags ? `<div class="hn-tags">${tags}</div>` : ""}
      ${hnAttributionHTML()}
    </section>
    <section class="hn-discussion">
      <h2 class="section-title">Hacker News comments <span class="count">${comments.length}</span></h2>
      ${hnCommentsHTML(comments, commentsUnavailable)}
    </section>`;
}

async function renderHNEvidence(videoId) {
  const root = $("#hn-evidence");
  if (!root) return;
  root.hidden = true;
  root.innerHTML = "";
  try {
    const existing = await loadHNExisting();
    const video = existing[videoId];
    if (!video || !$("#hn-evidence") || state.current !== videoId) return;
    const comments = await loadHNMentions(videoId).catch(() => null);
    const target = $("#hn-evidence");
    if (!target || state.current !== videoId) return;
    target.hidden = false;
    target.innerHTML = hnContextHTML(video, comments || [], comments === null);
  } catch (error) {
    const target = $("#hn-evidence");
    if (target && state.current === videoId) {
      target.hidden = false;
      target.innerHTML = '<p class="count">Hacker News context could not be loaded.</p>';
    }
  }
}

function hnCard(video) {
  const recommenders = Number(video.hn?.recommenders || 0);
  const recommendationLabel = recommenders ? `${recommenders} recommenders` : "Discussed, not recommended";
  return `<article class="card hn-card">
    <div class="thumb">
      <a class="thumb-link" href="#/hn-watch/${encodeURIComponent(video.vid)}" aria-label="${esc(video.title)}">
        <img src="${thumbSrc(video.vid)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${video.vid}/hqdefault.jpg'">
      </a>
      <span class="dur">HN ${Number(video.score || 0).toFixed(1)}</span>
    </div>
    <div class="card-info">
      <a class="card-title" href="#/hn-watch/${encodeURIComponent(video.vid)}">${esc(video.title)}</a>
      <div class="card-sub">${esc(video.channel || "Unknown channel")}</div>
      <div class="card-sub">${recommendationLabel} · ${esc(video.primary_topic || "Hacker News pick")}</div>
    </div>
  </article>`;
}

async function renderHackerNews(query = "") {
  if (state.hnQuery !== query) {
    state.hnQuery = query;
    state.hnLimit = pageSize();
  }
  $("#q").value = query;
  document.title = "Hacker News recommendations — HackerTube";
  view.innerHTML = '<section><div class="feed-head"><h1>Hacker News</h1><span class="count">Loading recommendations…</span></div></section>';
  try {
    const records = await loadHNVideos();
    if (!(location.hash || "#/").startsWith("#/hacker-news") || state.hnQuery !== query) return;
    const list = query
      ? state.hnSearchEngine.search(query).map((result) => result.item)
      : records;
    const shown = list.slice(0, state.hnLimit);
    view.innerHTML = `<section class="feed">
      <div class="feed-head">
        <div><h1>Hacker News</h1><p class="hn-intro">Videos recommended or discussed in Hacker News comments. Videos already in the main catalog are excluded.</p></div>
        <span class="count">${videos(list.length)}</span>
      </div>
      ${shown.length ? `<div class="grid">${shown.map(hnCard).join("")}</div>` : '<div class="empty"><strong>No matches</strong><p>Try another search phrase.</p></div>'}
      ${list.length > state.hnLimit ? `<div class="more"><button class="btn" data-hn-more>Show more (${list.length - state.hnLimit})</button></div>` : ""}
      ${hnAttributionHTML()}
    </section>`;
    syncSidebar();
  } catch (error) {
    if (!(location.hash || "#/").startsWith("#/hacker-news") || state.hnQuery !== query) return;
    view.innerHTML = `<section class="error"><strong>Could not load Hacker News data.</strong><p>${esc(error.message)}</p></section>`;
  }
}

async function renderHNWatch(requestedVideoId) {
  const requestedRoute = `#/hn-watch/${encodeURIComponent(requestedVideoId)}`;
  document.title = "Hacker News video — HackerTube";
  view.innerHTML = '<section class="watch"><div class="watch-main"><p class="count">Loading video and archived comments…</p></div></section>';
  try {
    const aliases = await loadHNAliases();
    if (location.hash !== requestedRoute) return;
    const videoId = aliases[requestedVideoId] || requestedVideoId;
    const [records, existing, related, commentResult] = await Promise.all([
      loadHNVideos(),
      loadHNExisting(),
      loadHNRelated(),
      loadHNMentions(videoId).catch(() => null),
    ]);
    if (location.hash !== requestedRoute) return;
    const video = state.hnById.get(videoId) || existing[videoId];
    if (!video) return renderNotFound();
    if (requestedVideoId !== videoId) {
      location.hash = `#/hn-watch/${encodeURIComponent(videoId)}`;
      return;
    }
    const commentsUnavailable = commentResult === null;
    const comments = commentResult || [];
    document.title = `${video.title} — HackerTube`;
    const hn = video.hn || {};
    const categories = (video.categories || []).map((category) =>
      `<span class="hn-tag">${esc(category.name)}</span>`).join("");
    const tags = (video.tags || []).map((tag) =>
      `<span class="hn-tag">${esc(tag)}</span>`).join("");
    const quote = video.quote?.text
      ? `<blockquote class="hn-quote">“${esc(video.quote.text)}”${video.quote.year ? ` <span>· ${esc(video.quote.year)}</span>` : ""}</blockquote>`
      : "";
    const relatedCards = (related[videoId] || [])
      .map((item) => state.hnById.get(item.vid) || existing[item.vid])
      .filter(Boolean)
      .slice(0, 8);
    const isRecommended = Number(hn.recommenders || 0) > 0;
    view.innerHTML = `<section class="watch hn-watch">
      <div class="watch-main">
        <div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${video.vid}?rel=0" title="${esc(video.title)}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
        <h1 class="watch-title">${esc(video.title)}</h1>
        <div class="watch-bar">
          <div class="watch-channel"><span class="avatar">${esc((video.channel || "?").trim().charAt(0))}</span><span class="watch-channel-text"><b>${esc(video.channel || "Unknown channel")}</b><small>Referenced on Hacker News</small></span></div>
          <div class="actions"><a class="btn" href="https://www.youtube.com/watch?v=${video.vid}" target="_blank" rel="noopener noreferrer">${icon("external")} YouTube</a></div>
        </div>
        <div class="hn-stats">
          <span><b>${Number(hn.recommenders || 0)}</b> recommenders</span>
          <span><b>${Number(hn.rec_months || 0)}</b> recommendation months</span>
          <span><b>${Number(hn.mentions || comments.length || 0)}</b> archived comments</span>
          <span><b>${Number(video.score || 0).toFixed(1)}</b> HN score</span>
        </div>
        ${video.summary ? `<section class="hn-context"><h2 class="section-title">Summary</h2><p class="hn-summary">${esc(video.summary)}</p></section>` : ""}
        ${video.why_hn ? `<section class="hn-context"><h2 class="section-title">${isRecommended ? "Why Hacker News recommends it" : "Why Hacker News mentioned it"}</h2><p class="hn-summary">${esc(video.why_hn)}</p></section>` : ""}
        ${quote}
        ${categories ? `<div class="hn-tags">${categories}</div>` : ""}
        ${tags ? `<div class="hn-tags">${tags}</div>` : ""}
        <section class="hn-discussion"><h2 class="section-title">Hacker News comments <span class="count">${comments.length}</span></h2>${hnCommentsHTML(comments, commentsUnavailable)}</section>
      </div>
      <aside class="watch-side">
        <h2 class="section-title">Related HackerTube picks</h2>
        <div class="related-grid">${relatedCards.map(hnCard).join("") || '<p class="count">No related videos available.</p>'}</div>
        <h2 class="section-title">Source</h2>
        <a class="btn" href="${esc(comments[0]?.hn_url || "https://news.ycombinator.com/")}" target="_blank" rel="noopener noreferrer">${icon("external")} Hacker News</a>
        ${hnAttributionHTML()}
      </aside>
    </section>`;
    syncSidebar();
  } catch (error) {
    if (location.hash !== requestedRoute) return;
    view.innerHTML = `<section class="error"><strong>Could not load this video.</strong><p>${esc(error.message)}</p></section>`;
  }
}
/* ---------- Collections ---------- */

const COLLECTIONS = {
  liked: { title: "Liked", set: () => state.likes, empty: "No liked videos yet.", hint: "Use the Like button on any video." },
  later: { title: "Watch later", set: () => state.saved, empty: "Watch later is empty.", hint: "Use the clock icon on any card or the Watch later button." },
  history: { title: "History", set: null, empty: "Nothing watched yet.", hint: "Videos you open show up here. The last 50 are kept in your browser." },
};

function renderCollection(kind) {
  const cfg = COLLECTIONS[kind];
  const list = kind === "history"
    ? state.seen.map((id) => state.byId.get(id)).filter(Boolean)
    : state.videos.filter((v) => cfg.set().has(v.id));
  document.title = `${cfg.title} — HackerTube`;
  const clear = list.length ? `<button class="btn" data-clear-collection="${kind}">${icon("trash")} Clear all</button>` : "";
  view.innerHTML = `<section>
    <div class="feed-head"><h1>${cfg.title}</h1><span class="count">${videos(list.length)}</span></div>
    ${clear ? `<div class="head-tools">${clear}</div>` : ""}
    ${list.length
      ? `<div class="grid">${list.map((v) => card(v, { remove: kind })).join("")}</div>`
      : `<div class="empty"><strong>${cfg.empty}</strong><p>${cfg.hint}</p><a class="btn" href="#/">Browse videos</a></div>`}
  </section>`;
  syncSidebar();
}

/* ---------- Categories ---------- */

function renderCategories() {
  document.title = "Categories — HackerTube";
  const topics = [...state.meta.topics].sort((a, b) => b.count - a.count);
  view.innerHTML = `<section>
    <div class="feed-head"><h1>Categories</h1><span class="count">${topics.length} topics</span></div>
    <div class="topic-grid">
      ${topics.map((t) => `<a class="topic-card" href="#/" data-goto-topic="${t.id}">
        <span class="topic-name">${esc(state.topicLabels[t.id] || t.id)}</span>
        <span class="topic-num">${t.count}</span>
        ${icon("arrowRight")}
      </a>`).join("")}
    </div>
  </section>`;
  syncSidebar();
}

/* ---------- Playlists ---------- */

function playlistById(id) {
  return state.playlists.find((p) => p.id === id);
}

function savePlaylists() {
  storeSet(STORE.playlists, state.playlists);
}

function createPlaylist(name) {
  const clean = name.trim().slice(0, 40);
  if (!clean) return null;
  const pl = { id: `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: clean, ids: [] };
  state.playlists.unshift(pl);
  savePlaylists();
  syncSidebar();
  return pl;
}

function addToPlaylist(plId, videoId) {
  const pl = playlistById(plId);
  if (!pl || !videoId) return;
  if (pl.ids.includes(videoId)) {
    toast("Already in this playlist", "playlists");
    return;
  }
  pl.ids.push(videoId);
  savePlaylists();
  toast(`Added to “${pl.name}”`, "playlists");
  syncSidebar();
}

function renderPlaylists() {
  document.title = "Playlists — HackerTube";
  const total = state.builtin.length + state.playlists.length;
  const creators = state.showAllPlaylists ? state.builtin : state.builtin.slice(0, 24);
  view.innerHTML = `<section>
    <div class="feed-head"><h1>Playlists</h1><span class="count">${total} ${total === 1 ? "playlist" : "playlists"}</span></div>
    <form class="create-pl" data-create-playlist>
      <input name="name" placeholder="New playlist name" maxlength="40" required aria-label="New playlist name">
      <button class="btn primary" type="submit">${icon("plus")} Create</button>
    </form>
    ${state.builtin.length ? `<h2 class="section-title">From creators <span class="count">${state.builtin.length}</span></h2>
      <div class="pl-grid">${creators.map(creatorPlaylistCard).join("")}</div>
      ${creators.length < state.builtin.length ? `<div class="more"><button class="btn" data-more-playlists>Show all ${state.builtin.length} playlists</button></div>` : ""}` : ""}
    <h2 class="section-title">Your playlists</h2>
    ${state.playlists.length
      ? `<div class="pl-grid">${state.playlists.map(playlistCard).join("")}</div>`
      : `<div class="empty"><strong>No playlists yet</strong><p>Create one, then add videos from any watch page.</p></div>`}
  </section>`;
  syncSidebar();
}

function creatorPlaylistCard(p) {
  return `<article class="pl-card">
    <a class="pl-cover" href="#/playlist/${p.id}" aria-label="${esc(p.title)}">
      ${p.cover ? `<img src="${thumbSrc(p.cover)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${p.cover}/hqdefault.jpg'">` : icon("playlists")}
      <span>${p.count}</span>
    </a>
    <div class="pl-row">
      <div><a href="#/playlist/${p.id}">${esc(p.title)}</a><small>${esc(p.channel)} · ${videos(p.count)}</small></div>
    </div>
  </article>`;
}

async function renderBuiltinPlaylist(id) {
  const meta = state.builtin.find((p) => p.id === id);
  if (!meta) return renderNotFound();
  document.title = `${meta.title} — HackerTube`;
  let ids = [];
  try {
    if (!state.builtinIds) state.builtinIds = fetchJson("data/playlists.json");
    ids = (await state.builtinIds)[id] || [];
  } catch {
    state.builtinIds = null;
  }
  if (location.hash !== `#/playlist/${id}`) return;
  const list = ids.map((vid) => state.byId.get(vid)).filter(Boolean);
  view.innerHTML = `<section>
    <div class="feed-head"><h1>${esc(meta.title)}</h1><span class="count">${videos(list.length)}</span></div>
    <div class="pl-head">
      ${list.length ? `<a class="btn primary" href="#/watch/${list[0].id}?list=${encodeURIComponent(id)}">${icon("play")} Play all</a>` : ""}
      <a class="btn" href="#/channel/${meta.channel_id}">${icon("channels")} ${esc(meta.channel)}</a>
    </div>
    ${list.length
      ? `<div class="grid">${list.map((v) => card(v)).join("")}</div>`
      : `<div class="empty"><strong>Nothing from this playlist is indexed</strong><p>Its videos may be short, private or outside the current index.</p><a class="btn" href="#/playlists">All playlists</a></div>`}
  </section>`;
  syncSidebar();
}

function playlistCard(p) {
  const first = p.ids.map((id) => state.byId.get(id)).find(Boolean);
  return `<article class="pl-card">
    <a class="pl-cover" href="#/playlist/${p.id}" aria-label="${esc(p.name)}">
      ${first ? `<img src="${thumbSrc(first.id)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${first.id}/hqdefault.jpg'">` : icon("playlists")}
      <span>${p.ids.length}</span>
    </a>
    <div class="pl-row">
      <div><a href="#/playlist/${p.id}">${esc(p.name)}</a><small>${p.ids.length ? videos(p.ids.length) : "Empty"}</small></div>
      <button class="icon-btn" data-delete-playlist="${p.id}" aria-label="Delete playlist">${icon("trash")}</button>
    </div>
  </article>`;
}

function renderPlaylist(id) {
  const pl = playlistById(id);
  if (!pl) return renderNotFound();
  const list = pl.ids.map((vid) => state.byId.get(vid)).filter(Boolean);
  document.title = `${pl.name} — HackerTube`;
  view.innerHTML = `<section>
    <div class="feed-head"><h1>${esc(pl.name)}</h1><span class="count">${videos(list.length)}</span></div>
    <div class="pl-head">
      ${list.length ? `<a class="btn primary" href="#/watch/${list[0].id}">${icon("play")} Play</a>` : ""}
      <button class="btn danger" data-delete-playlist="${pl.id}">${icon("trash")} Delete playlist</button>
    </div>
    ${list.length
      ? `<div class="grid">${list.map((v) => card(v, { remove: "playlist", playlist: pl.id })).join("")}</div>`
      : `<div class="empty"><strong>Playlist is empty</strong><p>Add videos from a watch page with “Add to playlist”.</p><a class="btn" href="#/">Browse videos</a></div>`}
  </section>`;
  syncSidebar();
}

/* ---------- Settings ---------- */

function renderSettings() {
  document.title = "Settings — HackerTube";
  const s = state.settings;
  const seg = [["light", "Light", "sun"], ["dark", "Dark", "moon"], ["system", "System", "monitor"]]
    .map(([value, label, ic]) => `<button data-theme-pref="${value}" class="${state.theme === value ? "active" : ""}" aria-pressed="${state.theme === value}">${icon(ic)} ${label}</button>`)
    .join("");
  view.innerHTML = `<section class="settings">
    <div class="feed-head"><h1>Settings</h1></div>
    <div class="settings-group">
      <h2>${icon("sun")} Appearance</h2>
      <div class="segmented" role="group" aria-label="Theme">${seg}</div>
    </div>
    <div class="settings-group">
      <h2>${icon("eye")} Browsing</h2>
      <label class="setting-row">
        <span class="row-ic">${icon("eye")}</span>
        <span class="setting-text"><b>Hide watched videos</b><small>Keep opened videos out of Home and search.</small></span>
        <input class="switch" type="checkbox" data-setting="hideSeen" ${s.hideSeen ? "checked" : ""}>
      </label>
      <div class="setting-row">
        <span class="row-ic">${icon("categories")}</span>
        <span class="setting-text"><b>Page size</b><small>Videos shown before “Show more”.</small></span>
        <div class="segmented" role="group" aria-label="Page size">
          ${[24, 36, 60].map((n) => `<button data-pagesize="${n}" class="${Number(s.pageSize) === n ? "active" : ""}" aria-pressed="${Number(s.pageSize) === n}">${n}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="settings-group">
      <h2>${icon("play")} Playback</h2>
      <label class="setting-row">
        <span class="row-ic">${icon("play")}</span>
        <span class="setting-text"><b>Direct video playback</b><small>Use yt-dlp to extract a temporary MP4 stream and play it with the browser player. YouTube iframe remains the default.</small></span>
        <input class="switch" type="checkbox" data-setting="nativePlayer" ${s.nativePlayer ? "checked" : ""}>
      </label>
    </div>
    <div class="settings-group">
      <h2>${icon("database")} Data</h2>
      <div class="setting-row">
        <span class="row-ic">${icon("history")}</span>
        <span class="setting-text"><b>History</b><small>${videos(state.seen.length)}</small></span>
        <button class="btn" data-clear-collection="history" ${state.seen.length ? "" : "disabled"}>${icon("trash")} Clear</button>
      </div>
      <div class="setting-row">
        <span class="row-ic">${icon("liked")}</span>
        <span class="setting-text"><b>Liked</b><small>${videos(state.likes.size)}</small></span>
        <button class="btn" data-clear-collection="liked" ${state.likes.size ? "" : "disabled"}>${icon("trash")} Clear</button>
      </div>
      <div class="setting-row">
        <span class="row-ic">${icon("later")}</span>
        <span class="setting-text"><b>Watch later</b><small>${videos(state.saved.size)}</small></span>
        <button class="btn" data-clear-collection="later" ${state.saved.size ? "" : "disabled"}>${icon("trash")} Clear</button>
      </div>
      <div class="setting-row">
        <span class="row-ic">${icon("playlists")}</span>
        <span class="setting-text"><b>Playlists</b><small>${state.playlists.length} saved</small></span>
        <a class="btn" href="#/playlists">Manage ${icon("arrowRight")}</a>
      </div>
      <div class="setting-row">
        <span class="row-ic danger">${icon("trash")}</span>
        <span class="setting-text"><b>Everything</b><small>Delete likes, history, watch later, playlists and settings.</small></span>
        <button class="btn danger" data-reset-all>${icon("trash")} Delete all</button>
      </div>
    </div>
    <p class="settings-note">Stored in this browser only. No account, no tracking.</p>
  </section>`;
  syncSidebar();
}

/* ---------- Channels ---------- */

function renderChannels() {
  document.title = "Channels — HackerTube";
  const cards = state.meta.channels
    .map((c) => `<a class="channel-card" href="#/channel/${c.id}">
      <span class="avatar">${esc(c.name.trim().charAt(0))}</span>
      <span><b>${esc(c.name)}</b><small>${videos(c.count)}</small></span>
    </a>`)
    .join("");
  view.innerHTML = `<section>
    <div class="feed-head"><h1>Channels</h1><span class="count">${state.meta.channels.length} channels</span></div>
    <div class="channel-grid">${cards}</div>
  </section>`;
  syncSidebar();
}

function renderNotFound() {
  document.title = "Not found — HackerTube";
  view.innerHTML = `<div class="empty"><strong>Not found</strong><p>This video or channel is not in the index.</p><a class="btn" href="#/">Back to Home</a></div>`;
  syncSidebar();
}

/* ---------- Events ---------- */

function onViewClick(e) {
  const actionsToggle = e.target.closest("[data-watch-actions-toggle]");
  if (actionsToggle) {
    const actions = actionsToggle.closest(".watch-actions");
    const open = !actions.classList.contains("menu-open");
    actions.classList.toggle("menu-open", open);
    actionsToggle.setAttribute("aria-expanded", String(open));
    return;
  }

  if (e.target.closest(".watch-action-items a")) closeWatchActionMenu(true);

  const goto = e.target.closest("[data-goto-topic]");
  if (goto) {
    pendingTopic = goto.dataset.gotoTopic;
    if (/^#\/(home)?$/.test(location.hash || "#/")) render();
    else location.hash = "#/";
    return;
  }

  if (e.target.closest("[data-filter-toggle]")) {
    ui.open = !ui.open;
    renderFeed(state.scope);
    return;
  }

  if (e.target.closest("[data-filter-close]")) {
    ui.open = false;
    renderFeed(state.scope);
    return;
  }

  const selectToggle = e.target.closest("[data-select-toggle]");
  if (selectToggle) {
    const wrap = selectToggle.closest(".select");
    const wasOpen = wrap.classList.contains("open");
    closeSelects();
    if (!wasOpen) {
      wrap.classList.add("open");
      selectToggle.setAttribute("aria-expanded", "true");
    }
    return;
  }

  const option = e.target.closest("[data-select-opt]");
  if (option) {
    const fieldName = option.dataset.selectOpt;
    const value = option.dataset.value;
    closeSelects();
    ui[fieldName] = fieldName === "sort" && !value ? "best" : value;
    ui.limit = pageSize();
    renderFeed(state.scope);
    return;
  }

  const sizeBtn = e.target.closest("[data-pagesize]");
  if (sizeBtn) {
    state.settings.pageSize = Number(sizeBtn.dataset.pagesize);
    storeSet(STORE.settings, state.settings);
    ui.limit = pageSize();
    renderSettings();
    toast("Saved");
    return;
  }

  const later = e.target.closest("[data-later-toggle]");
  if (later) {
    toggleLater(later.dataset.laterToggle);
    return;
  }

  const topic = e.target.closest("[data-topic]");
  if (topic) {
    const id = topic.dataset.topic;
    if (!id) ui.topics.clear();
    else if (ui.topics.has(id)) ui.topics.delete(id);
    else ui.topics.add(id);
    ui.limit = pageSize();
    renderFeed(state.scope);
    return;
  }

  if (e.target.closest("[data-more-playlists]")) {
    state.showAllPlaylists = true;
    renderPlaylists();
    return;
  }

  if (e.target.closest("[data-more]")) {
    ui.limit += pageSize();
    renderFeed(state.scope);
    return;
  }

  if (e.target.closest("[data-hn-more]")) {
    state.hnLimit += pageSize();
    renderHackerNews(state.hnQuery || "");
    return;
  }

  if (e.target.closest("[data-clear]")) {
    resetFilters();
    renderFeed(state.scope);
    return;
  }

  const add = e.target.closest("[data-add-playlist]");
  if (add) {
    closeWatchActionMenu(true);
    addToPlaylist(add.dataset.addPlaylist, state.current);
    const details = add.closest("details");
    if (details) details.removeAttribute("open");
    return;
  }

  const themePref = e.target.closest("[data-theme-pref]");
  if (themePref) {
    applyTheme(themePref.dataset.themePref);
    renderSettings();
    return;
  }

  const remove = e.target.closest("[data-remove]");
  if (remove) {
    removeItem(remove.dataset.remove, remove.dataset.id, remove.dataset.pl);
    return;
  }

  const clear = e.target.closest("[data-clear-collection]");
  if (clear) {
    clearCollection(clear.dataset.clearCollection);
    return;
  }

  const del = e.target.closest("[data-delete-playlist]");
  if (del) {
    deletePlaylist(del.dataset.deletePlaylist);
    return;
  }

  if (e.target.closest("[data-reset-all]")) {
    resetAll();
    return;
  }

  const act = e.target.closest("[data-act]");
  if (act) {
    closeWatchActionMenu(true);
    toggleAct(act.dataset.act);
  }
}

function closeWatchActionMenu(restoreFocus = false) {
  const actions = document.querySelector(".watch-actions.menu-open");
  if (!actions) return;
  actions.classList.remove("menu-open");
  const toggle = actions.querySelector("[data-watch-actions-toggle]");
  toggle?.setAttribute("aria-expanded", "false");
  if (restoreFocus) toggle?.focus();
}

function onViewChange(e) {
  const setting = e.target.closest("[data-setting]");
  if (setting) {
    const key = setting.dataset.setting;
    state.settings[key] = setting.type === "checkbox" ? setting.checked : Number(setting.value);
    storeSet(STORE.settings, state.settings);
    if (key === "pageSize") ui.limit = pageSize();
    syncSidebar();
    toast("Saved");
    if (key === "nativePlayer" && location.hash.startsWith("#/watch/")) render();
    if (key === "hideSeen" || key === "pageSize") {
      if (/^#\/($|longs|search\/|channel\/)/.test(location.hash || "#/")) renderFeed(state.scope);
    }
    return;
  }
}

function onViewSubmit(e) {
  const form = e.target.closest("[data-create-playlist]");
  if (!form) return;
  e.preventDefault();
  const name = form.elements.name.value.trim();
  if (!name) return;
  createPlaylist(name);
  form.reset();
  renderPlaylists();
  toast(`Created “${name}”`, "plus");
}

function toggleAct(act) {
  const id = state.current;
  if (!id) return;
  const key = act === "like" ? "likes" : "saved";
  const set = state[key];
  const on = !set.has(id);
  if (on) set.add(id);
  else set.delete(id);
  storeSet(act === "like" ? STORE.likes : STORE.later, [...set]);
  document.querySelectorAll(`[data-act="${act}"]`).forEach((b) => {
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    const label = act === "like" ? (on ? "Liked" : "Like") : (on ? "Saved" : "Watch later");
    b.innerHTML = `${icon(act === "like" ? "liked" : "later")} <span>${label}</span>`;
  });
  toast(on ? (act === "like" ? "Liked" : "Added to Watch later") : "Removed", on ? (act === "like" ? "liked" : "later") : "close");
  syncSidebar();
}

function toggleLater(id) {
  const on = !state.saved.has(id);
  if (on) state.saved.add(id);
  else state.saved.delete(id);
  storeSet(STORE.later, [...state.saved]);
  document.querySelectorAll(`[data-later-toggle="${id}"]`).forEach((b) => {
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Remove from Watch later" : "Add to Watch later");
  });
  syncSidebar();
  toast(on ? "Added to Watch later" : "Removed from Watch later", on ? "later" : "close");
  if ((location.hash || "#/") === "#/later") render();
}

function removeItem(kind, id, plId) {
  if (!id) return;
  if (kind === "liked") state.likes.delete(id);
  else if (kind === "later") state.saved.delete(id);
  else if (kind === "history") state.seen = state.seen.filter((x) => x !== id);
  else if (kind === "playlist") {
    const pl = playlistById(plId);
    if (pl) pl.ids = pl.ids.filter((x) => x !== id);
    savePlaylists();
  }
  storeSet(STORE.likes, [...state.likes]);
  storeSet(STORE.later, [...state.saved]);
  storeSet(STORE.seen, state.seen);
  syncSidebar();
  render();
  toast("Removed", "close");
}

function clearCollection(kind) {
  const label = kind === "history" ? "history" : kind === "liked" ? "likes" : "Watch later";
  if (!confirm(`Clear ${label}? This cannot be undone.`)) return;
  if (kind === "history") state.seen = [];
  else if (kind === "liked") state.likes.clear();
  else state.saved.clear();
  storeSet(STORE.seen, state.seen);
  storeSet(STORE.likes, [...state.likes]);
  storeSet(STORE.later, [...state.saved]);
  syncSidebar();
  render();
  toast(`Cleared ${label}`, "trash");
}

function deletePlaylist(id) {
  const pl = playlistById(id);
  if (!pl) return;
  if (!confirm(`Delete playlist “${pl.name}”?`)) return;
  state.playlists = state.playlists.filter((p) => p.id !== id);
  savePlaylists();
  syncSidebar();
  if ((location.hash || "#/").startsWith("#/playlist/")) location.hash = "#/playlists";
  else render();
  toast("Playlist deleted", "trash");
}

function resetAll() {
  if (!confirm("Delete all local data: likes, history, watch later, playlists and settings?")) return;
  Object.values(STORE).forEach((key) => localStorage.removeItem(key));
  state.likes.clear();
  state.saved.clear();
  state.seen = [];
  state.playlists = [];
  state.settings = Object.assign({}, DEFAULTS);
  ui.limit = pageSize();
  applyTheme("dark");
  storeSet(STORE.settings, state.settings);
  storeSet(STORE.theme, state.theme);
  syncSidebar();
  render();
  toast("All data deleted", "trash");
}
