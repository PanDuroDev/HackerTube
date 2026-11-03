/* Static UI, no frameworks: data from public/data, all state in the browser. */

const KIND_LABELS = { course: "Course", tutorial: "Tutorial", project: "Project", talk: "Talk", short: "Short" };
const LEVEL_LABELS = { beginner: "Beginner", advanced: "Advanced", any: "General", unknown: "Unspecified" };
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
const DEFAULTS = { pageSize: 36, hideSeen: false, autoplayNext: false };
const HN_DEFAULTS = { scope: "programming", recommendation: "", contentType: "", level: "", shelfLife: "", area: "", sort: "best" };
const SITE_URL = "https://pandurodev.github.io/HackerTube/";
const SORT_VALUES = new Set(["foryou", "best", "newest", "views", "longest", "shortest"]);
const STORE = { likes: "ht_likes", later: "ht_saved", seen: "ht_seen", playlists: "ht_playlists", settings: "ht_settings", theme: "ht_theme", homeRecent: "ht_home_recent", progress: "ht_progress" };

const state = {
  videos: [],
  meta: null,
  byId: new Map(),
  searchEngine: null,
  hnVideos: null,
  hnVideosPromise: null,
  hnPreview: null,
  hnPreviewPromise: null,
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
  hnFilters: Object.assign({}, HN_DEFAULTS),
  hnUiOpen: false,
  hnTotal: 0,
  topicLabels: {},
  channels: new Map(),
  likes: new Set(storeGet(STORE.likes, [])),
  saved: new Set(storeGet(STORE.later, [])),
  seen: storeGet(STORE.seen, []),
  progress: storeGet(STORE.progress, {}),
  pendingResume: null,
  playlists: storeGet(STORE.playlists, []).filter((p) => p && p.id && Array.isArray(p.ids)),
  settings: Object.assign({}, DEFAULTS, storeGet(STORE.settings, {})),
  theme: storeGet(STORE.theme, "dark"),
  longCount: 0,
  scope: { type: "all" },
  current: null,
  homeOrder: [],
  homeStale: false,
  builtin: [],
  builtinIds: null,
  playlistQuery: "",
  playlistChannel: "",
  playlistLimit: 24,
};

const ui = { topics: new Set(), lang: "", level: "", kind: "", duration: "", year: "", channel: "", sort: "best", limit: pageSize(), open: false };
let playlistPlayer = null;
let progressPoll = null;
let youtubeApiPromise = null;
let isMobileLayout = matchMedia("(max-width: 980px)").matches;
let themeChangeVersion = 0;
let confirmationResolver = null;


const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const videos = (n) => `${n} ${n === 1 ? "video" : "videos"}`;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

init();

function searchDedupeKey(item) {
  const channel = item.channel_id || item.channel || "";
  return `${String(channel).trim().toLowerCase()}|${String(item.title || "").trim().toLowerCase()}`;
}

function ensureMainSearchIndex() {
  if (state.searchEngine) return state.searchEngine;
  state.searchEngine = new window.HackerTubeSearch.SearchIndex(state.videos, (video) => ({
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
    description: video.description || "",
    tags: (video.tags || []).join(" "),
    id: video.id,
  }), {
    getRank: (video) => Math.min(1, Math.max(0, Number(video.score) || 0) / 10),
    getGroup: (video) => video.channel_id || video.channel,
    getDedupeKey: searchDedupeKey,
    groupLimit: 2,
    diversityLimit: 36,
  });
  return state.searchEngine;
}

function warmSearchIndex() {
  if (state.searchEngine || !state.videos.length) return;
  const build = () => { try { ensureMainSearchIndex(); } catch { /* Build on first search instead. */ } };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(build, { timeout: 3000 });
  } else {
    setTimeout(build, 1200);
  }
}

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
  addEventListener("beforeunload", saveCurrentProgress);
  $(".skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    view.focus();
    view.scrollIntoView({ block: "start" });
  });
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
    if ($("#confirmDialog")?.open) return;

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
  view.addEventListener("keydown", onViewKeydown);
  view.addEventListener("change", onViewChange);
  view.addEventListener("submit", onViewSubmit);

  const confirmDialog = $("#confirmDialog");
  $("#confirmAccept").addEventListener("click", () => confirmDialog.close("confirm"));
  $("#confirmCancel").addEventListener("click", () => confirmDialog.close("cancel"));
  confirmDialog.addEventListener("click", (event) => {
    if (event.target === confirmDialog) confirmDialog.close("cancel");
  });
  confirmDialog.addEventListener("close", () => {
    const resolve = confirmationResolver;
    confirmationResolver = null;
    resolve?.(confirmDialog.returnValue === "confirm");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".select")) closeSelects();
    if (!e.target.closest(".watch-actions")) closeWatchActionMenu();
  });

  try {
    const [videos, meta, hnMeta] = await Promise.all([
      fetchJson("data/videos.json"),
      fetchJson("data/meta.json"),
      fetchJson("data/hacker-news/meta.json").catch(() => null),
    ]);
    state.videos = videos;
    state.meta = meta;
    state.hnTotal = Number(hnMeta?.imported_videos) || 0;
    state.builtin = meta.playlists || [];
    state.homeOrder = buildHomeOrder(videos);
    state.byId = new Map(videos.map((v) => [v.id, v]));
    state.channels = new Map(meta.channels.map((c) => [c.id, c]));
    state.topicLabels = Object.fromEntries(meta.topics.map((t) => [t.id, TOPIC_LABELS[t.id] || t.label]));
    state.longCount = videos.filter((v) => v.duration >= 1200).length;
    renderSidebar();
    addEventListener("hashchange", () => {
      setSidebar(false);
      scrollTo({ top: 0, left: 0, behavior: "instant" });
      render();
    });
    render();
    warmSearchIndex();
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

function textLang(value) {
  const text = String(value || "");
  const letters = text.match(/[A-Za-z\u0600-\u06FF]/g) || [];
  if (!letters.length) return "";
  const arabic = letters.filter((char) => /[\u0600-\u06FF]/.test(char)).length;
  return arabic / letters.length >= 0.3 ? "ar" : "en";
}

function langAttrs(value) {
  const lang = textLang(value);
  return lang ? ` lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"` : "";
}

function applyTextLang(element, value) {
  if (!element) return;
  const lang = textLang(value);
  if (lang) {
    element.lang = lang;
    element.dir = lang === "ar" ? "rtl" : "ltr";
  } else {
    element.removeAttribute("lang");
    element.removeAttribute("dir");
  }
}

function setPageMeta({ title, description = "", canonical = "", image = "", type = "website" }) {
  document.title = title;
  const setContent = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.setAttribute("content", value);
  };
  setContent('meta[name="description"]', description);
  setContent('meta[property="og:title"]', title);
  setContent('meta[property="og:description"]', description);
  setContent('meta[property="og:type"]', type);
  setContent('meta[property="og:url"]', canonical);
  setContent('meta[property="og:image"]', image);
  setContent('meta[name="twitter:title"]', title);
  setContent('meta[name="twitter:description"]', description);
  setContent('meta[name="twitter:image"]', image);
  setContent('meta[name="twitter:card"]', image ? "summary_large_image" : "summary");
  const canonicalElement = document.querySelector('link[rel="canonical"]');
  if (canonicalElement) canonicalElement.setAttribute("href", canonical);
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

function confirmAction({ title, message, confirmLabel = "Delete" }) {
  const dialog = $("#confirmDialog");
  if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve(false);

  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  $("#confirmAccept").textContent = confirmLabel;
  dialog.returnValue = "cancel";

  return new Promise((resolve) => {
    confirmationResolver = resolve;
    dialog.showModal();
  });
}

function applyTheme(pref) {
  const root = document.documentElement;
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const nextTheme = dark ? "dark" : "light";
  const themeChanged = root.dataset.theme !== nextTheme;

  state.theme = pref;
  if (themeChanged) {
    // Stop hover/focus transitions from animating every control during a theme swap.
    root.dataset.themeChanging = "true";
    root.dataset.theme = nextTheme;

    const version = ++themeChangeVersion;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (version === themeChangeVersion) {
          delete root.dataset.themeChanging;
        }
      });
    });
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0f0f0f" : "#ffffff";
  const btn = $("#themeBtn");
  btn.innerHTML = icon(dark ? "sun" : "moon");
  btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  storeSet(STORE.theme, pref);
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
    saveCurrentProgress();
    stopProgressPoll();
    playlistPlayer.destroy();
    playlistPlayer = null;
  }
  const hash = location.hash || "#/";
  const raw = hash.replace(/^#\/?/, "");
  const queryIndex = raw.indexOf("?");
  const path = queryIndex < 0 ? raw : raw.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex < 0 ? "" : raw.slice(queryIndex + 1));
  const [seg, ...rest] = path.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  state.current = null;
  ui.open = false;

  if (!seg || seg === "home") {
    resetFilters("foryou");
    applyFeedParams(params);
    return renderFeed({ type: "all" });
  }
  if (seg === "longs") {
    resetFilters();
    applyFeedParams(params);
    return renderFeed({ type: "longs", title: "Long videos", minDuration: 1200 });
  }
  if (seg === "search") {
    resetFilters();
    applyFeedParams(params);
    return renderFeed({ type: "search", q: arg, title: `Results for “${arg}”` });
  }
  if (seg === "channel") {
    const ch = state.channels.get(arg);
    if (!ch) return renderNotFound();
    resetFilters();
    applyFeedParams(params);
    return renderFeed({ type: "channel", channel: arg, title: ch.name });
  }
  if (seg === "liked") return renderCollection("liked");
  if (seg === "later" || seg === "saved") return renderCollection("later");
  if (seg === "history") return renderCollection("history");
  if (seg === "categories") return renderCategories();
  if (seg === "hacker-news") return renderHackerNews(arg, params);
  if (seg === "hn-watch") {
    return renderHNWatch(arg, params.get("list"), params.get("autoplay") === "1");
  }
  if (seg === "playlists") return renderPlaylists();
  if (seg === "playlist") return arg.startsWith("pl_") ? renderPlaylist(arg) : renderBuiltinPlaylist(arg);
  if (seg === "settings") return renderSettings();
  if (seg === "watch") {
    return renderWatch(arg, params.get("list"), params.get("autoplay") === "1");
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
  const active = map[hash]
    || (hash.startsWith("#/playlist/") ? "playlists"
      : hash.startsWith("#/hacker-news") || hash.startsWith("#/hn-watch") ? "hacker-news"
      : hash.startsWith("#/watch/") || hash.startsWith("#/search/") || hash.startsWith("#/channel/") ? "home"
      : "");
  document.querySelectorAll(".side-link[data-nav]").forEach((a) => {
    const isActive = a.dataset.nav === active;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
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
    "hacker-news": state.hnTotal || "",
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

function resetFilters(sort = "best") {
  ui.topics.clear();
  ui.level = ui.kind = ui.duration = ui.year = ui.channel = ui.lang = "";
  ui.sort = sort;
  ui.limit = pageSize();
}

const FEED_FILTER_KEYS = ["lang", "level", "kind", "duration", "year", "channel"];

function applyFeedParams(params) {
  const topics = params.get("topics");
  if (topics) {
    const valid = new Set((state.meta?.topics || []).map((topic) => topic.id));
    ui.topics = new Set(topics.split(",").filter((topic) => valid.has(topic)));
  }
  for (const key of FEED_FILTER_KEYS) {
    const value = params.get(key);
    if (value) ui[key] = value;
  }
  const sort = params.get("sort");
  if (SORT_VALUES.has(sort)) ui.sort = sort;
}

function defaultFeedSort(scope = state.scope) {
  return scope?.type === "all" ? "foryou" : "best";
}

function feedHashFromState() {
  const scope = state.scope || { type: "all" };
  const params = new URLSearchParams();
  if (ui.topics.size) params.set("topics", [...ui.topics].join(","));
  for (const key of FEED_FILTER_KEYS) {
    if (ui[key]) params.set(key, ui[key]);
  }
  if (ui.sort !== defaultFeedSort(scope)) params.set("sort", ui.sort);
  let path = "#/";
  if (scope.type === "search") path = `#/search/${encodeURIComponent(scope.q || "")}`;
  else if (scope.type === "channel") path = `#/channel/${encodeURIComponent(scope.channel || "")}`;
  else if (scope.type === "longs") path = "#/longs";
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function syncFeedUrl() {
  const hash = feedHashFromState();
  if ((location.hash || "#/") !== hash && typeof history !== "undefined" && history.replaceState) {
    history.replaceState(null, "", hash);
  }
}

function filtered(scope) {
  const q = String(scope.q || "").trim();
  // SearchIndex covers the complete catalog; pagination happens only when rendering.
  const source = q
    ? ensureMainSearchIndex().search(q).map((result) => result.item)
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
function buildHomeOrder(videos, random = Math.random) {
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
      key: -Math.log(Math.max(random(), Number.EPSILON)) / weight,
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

function ensureHomeOrder() {
  if (!state.homeOrder.length || state.homeStale) {
    state.homeOrder = buildHomeOrder(state.videos);
    state.homeStale = false;
  }
  return state.homeOrder;
}

function invalidateHomeOrder() {
  state.homeStale = true;
}

/* ---------- Feed ---------- */

function renderFeed(scope) {
  state.scope = scope;
  if (scope.q !== undefined) $("#q").value = scope.q;
  else if (scope.type !== "search") $("#q").value = "";
  let list = filtered(scope);
  if (scope.type === "all" && ui.sort === "foryou") {
    const order = ensureHomeOrder();
    const rank = new Map(order.map((video, index) => [video.id, index]));
    list = list.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }
  const shown = list.slice(0, ui.limit);
  const title = scope.title || "";
  const pageTitle = title ? `${title} — HackerTube` : "HackerTube";
  const description = title
    ? `${videos(list.length)} in ${title} on HackerTube.`
    : `An index of ${videos(state.meta?.total || list.length)} programming videos in Arabic and English.`;
  setPageMeta({ title: pageTitle, description, canonical: SITE_URL + feedHashFromState() });

  view.innerHTML = `<section class="feed">
    <div class="feed-head">
      ${title ? `<h1>${esc(title)}</h1>` : ""}
      ${scope.type === "all" ? `<button class="btn refresh-btn" data-refresh-home>${icon("refresh")} Refresh</button>` : ""}
      <button class="btn filter-btn ${hasFilters() ? "on" : ""}" data-filter-toggle aria-expanded="${ui.open}">
        ${icon("filter")} Filters${hasFilters() ? ` <span class="filter-count">${filterCount()}</span>` : ""}
      </button>
      <span class="count">${videos(list.length)}</span>
    </div>
    ${ui.open ? filtersPanel() : ""}
    ${shown.length ? `<div class="grid">${shown.map((v) => card(v)).join("")}</div>` : emptyState()}
    ${list.length > ui.limit ? `<div class="more"><button class="btn" data-more>Show more (${list.length - ui.limit})</button></div>` : ""}
  </section>`;
  syncFeedUrl();
  syncSidebar();
}

function filtersPanel() {
  const years = [...new Set(state.videos.map((v) => v.year).filter(Boolean))].sort((a, b) => b - a);
  const topics = state.meta.topics
    .map((t) => `<button class="chip ${ui.topics.has(t.id) ? "on" : ""}" data-topic="${t.id}" aria-pressed="${ui.topics.has(t.id)}">${esc(state.topicLabels[t.id] || t.id)}</button>`)
    .join("");
  const sortOptions = [
    ["newest", "Newest"],
    ["views", "Most viewed"],
    ["longest", "Longest"],
    ["shortest", "Shortest"],
  ];
  if (state.scope?.type === "all") sortOptions.unshift(["foryou", "For you"]);
  const selects = [
    field("channel", "Channel", "All channels", state.meta.channels.map((c) => [c.id, c.name]), ui.channel),
    field("lang", "Language", "All languages", [["ar", "Arabic"], ["en", "English"]], ui.lang),
    field("level", "Level", "All levels", Object.entries(LEVEL_LABELS), ui.level),
    field("kind", "Type", "All types", Object.entries(KIND_LABELS), ui.kind),
    field("duration", "Duration", "Any length", [["short", "Under 5 min"], ["mid", "5–20 min"], ["long", "20–60 min"], ["xl", "Over 1 hour"]], ui.duration),
    field("year", "Year", "Any year", years.map((y) => [y, String(y)]), ui.year),
    field("sort", "Sort", "Best", sortOptions, ui.sort),
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

function field(name, label, allLabel, options, current, group = "ui") {
  const cur = String(current);
  const isAll = cur === "" || (name === "sort" && cur === "best");
  const activeOption = options.find(([value]) => String(value) === cur);
  const shown = isAll || !activeOption ? allLabel : activeOption[1];
  const menuId = `select-${group}-${name}`;
  const rows = [["", allLabel], ...options]
    .map(([value, text]) => {
      const on = value === "" ? isAll : String(value) === cur;
      return `<button type="button" class="select-opt ${on ? "on" : ""}" role="option" tabindex="-1" aria-selected="${on}" data-select-opt="${name}" data-select-group="${group}" data-value="${esc(value)}">${esc(text)}${on ? icon("check") : ""}</button>`;
    })
    .join("");
  return `<div class="filter-field">
    <span class="filter-label">${esc(label)}</span>
    <div class="select">
      <button type="button" class="select-btn" data-select-toggle="${name}" data-select-group="${group}" aria-haspopup="listbox" aria-controls="${menuId}" aria-expanded="false">
        <span>${esc(shown)}</span>${icon("chevron")}
      </button>
      <div class="select-menu" id="${menuId}" role="listbox" aria-label="${esc(label)}">${rows}</div>
    </div>
  </div>`;
}

function closeSelects() {
  document.querySelectorAll(".select.open").forEach((wrap) => {
    wrap.classList.remove("open");
    wrap.querySelector("[data-select-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function focusSelectOption(toggle, fromEnd = false) {
  const wrap = toggle.closest(".select");
  const options = [...(wrap?.querySelectorAll("[data-select-opt]") || [])];
  if (!options.length) return;
  const selected = options.find((option) => option.classList.contains("on"));
  (selected || (fromEnd ? options[options.length - 1] : options[0])).focus();
}

function onViewKeydown(event) {
  const option = event.target.closest("[data-select-opt]");
  if (option) {
    const menu = option.closest('[role="listbox"]');
    const options = menu ? [...menu.querySelectorAll("[data-select-opt]")] : [];
    const index = options.indexOf(option);
    const toggle = option.closest(".select")?.querySelector("[data-select-toggle]");
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!options.length) return;
      let next = index;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else if (event.key === "ArrowDown") next = Math.min(options.length - 1, index + 1);
      else next = Math.max(0, index - 1);
      options[next]?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSelects();
      toggle?.focus();
    }
    return;
  }

  const toggle = event.target.closest("[data-select-toggle]");
  if (!toggle) return;
  const wrap = toggle.closest(".select");
  if (!wrap) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    closeSelects();
    wrap.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    focusSelectOption(toggle, event.key === "ArrowUp");
    return;
  }
  if (event.key === "Escape") {
    closeSelects();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    setTimeout(() => {
      if (wrap.classList.contains("open")) focusSelectOption(toggle);
    }, 0);
  }
}

function thumbSrc(id) {
  // YouTube exposes three sampled frames (hq1/hq2/hq3); pick one per video, stable across reloads.
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return `https://i.ytimg.com/vi/${id}/hq${(n % 3) + 1}.jpg`;
}

function videoWatchHref(video) {
  return video.id
    ? `#/watch/${video.id}`
    : `#/hn-watch/${encodeURIComponent(video.vid)}`;
}

function card(v, opts = {}) {
  const id = v.id || v.vid;
  const hn = opts.hn || (!v.id && v.vid ? v : null);
  const later = state.saved.has(id);
  const remove = opts.remove
    ? `<button class="card-x" data-remove="${opts.remove}" data-id="${id}"${opts.playlist ? ` data-pl="${opts.playlist}"` : ""} aria-label="Remove">${icon("close")}</button>`
    : "";
  const topicId = v.topics?.[0];
  const topic = topicId ? ` · ${esc(state.topicLabels[topicId] || topicId)}` : "";
  const channel = v.channel || "Unknown channel";
  const channelHTML = v.channel_id
    ? `<a class="card-sub" href="#/channel/${v.channel_id}"${langAttrs(channel)}>${esc(channel)}</a>`
    : `<div class="card-sub"${langAttrs(channel)}>${esc(channel)}</div>`;
  const hnRecommenders = Number(hn?.hn?.recommenders || hn?.recommenders || 0);
  const hnScore = Number(hn?.score || 0);
  const progress = progressFor(id);
  const hnMeta = hn
    ? `${hnRecommenders ? `${hnRecommenders} recommenders` : "Discussed, not recommended"} · ${esc(hn.primary_topic || "Hacker News pick")}`
    : `${compact.format(v.views || 0)} views${v.year ? ` · ${v.year}` : ""}${topic}`;
  const badge = hn
    ? (hnScore > 0 || hnRecommenders > 0 ? `HN ${hnScore.toFixed(1)}` : "Discussed")
    : fmtDuration(v.duration);
  const badgeTitle = hn
    ? (hnScore > 0 || hnRecommenders > 0 ? `Hacker News score ${hnScore.toFixed(1)} · ${hnRecommenders} recommenders` : "Discussed on Hacker News, not recommended")
    : "";
  const watchHref = videoWatchHref(v);
  return `<article class="card">
    <div class="thumb">
      <a class="thumb-link" href="${watchHref}" aria-label="${esc(v.title)}">
        <img src="${thumbSrc(id)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${id}/hqdefault.jpg'">
      </a>
      <button class="later-btn ${later ? "on" : ""}" data-later-toggle="${id}" aria-pressed="${later}" aria-label="${later ? "Remove from Watch later" : "Add to Watch later"}" title="Watch later">${icon("later")}</button>
      ${remove}
      <span class="dur"${badgeTitle ? ` title="${esc(badgeTitle)}"` : ""}>${badge}</span>
      ${progress ? `<span class="card-progress" title="Resume at ${fmtDuration(progress.position)}"><i style="width:${Math.round(progress.ratio * 100)}%"></i></span>` : ""}
    </div>
    <div class="card-info">
      <a class="card-title" href="${watchHref}"${langAttrs(v.title)}>${esc(v.title)}</a>
      ${channelHTML}
      <div class="card-sub">${hnMeta}</div>
    </div>
  </article>`;
}

function playlistPlaybackHref(video, playlistId, autoplay = true) {
  const params = new URLSearchParams();
  if (playlistId) params.set("list", playlistId);
  if (autoplay) params.set("autoplay", "1");
  const query = params.toString();
  const route = videoWatchHref(video);
  return query ? route + "?" + query : route;
}
function watchActionsHTML(videoId) {
  const liked = state.likes.has(videoId);
  const later = state.saved.has(videoId);
  const progress = progressFor(videoId);
  const resume = progress
    ? `<button class="btn resume-btn" type="button" data-resume="${esc(videoId)}">${icon("play")} Resume at ${fmtDuration(progress.position)}</button>`
    : "";
  const playlistPanel = state.playlists.length
    ? state.playlists.map((p) => `<button data-add-playlist="${p.id}">${icon("playlists")}<span>${esc(p.name)}</span><span class="side-count">${p.ids.length}</span></button>`).join("")
    : `<p>No playlists yet.</p><a href="#/playlists">Create one first</a>`;
  return `<div class="actions watch-actions">
    ${resume}
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
      <button class="btn watch-action-item" type="button" data-share>${icon("share")} <span>Share</span></button>
      <a class="btn watch-action-item watch-action-item--external watch-youtube" href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener">${icon("external")} YouTube</a>
    </div>
  </div>`;
}

function emptyState() {
  return `<div class="empty">
    <strong>No matches</strong>
    <p>Try a different search or clear the filters.</p>
    ${hasFilters() ? '<button class="btn" data-clear>Clear filters</button>' : state.settings.hideSeen ? '<a class="btn" href="#/settings">Watched videos are hidden</a>' : '<a class="btn" href="#/categories">Browse categories</a>'}
  </div>`;
}

/* ---------- Watch ---------- */

async function renderWatch(id, playlistId = null, autoplay = false) {
  const routeHash = location.hash;
  const v = state.byId.get(id);
  if (!v) return renderNotFound();
  state.current = id;
  markSeen(id);

  let queue = [];
  if (playlistId) {
    try {
      let ids = [];
      if (playlistId.startsWith("pl_")) {
        const playlist = playlistById(playlistId);
        ids = Array.isArray(playlist?.ids) ? playlist.ids : [];
      } else {
        if (!state.builtinIds) state.builtinIds = fetchJson("data/playlists.json");
        const playlists = await state.builtinIds;
        ids = Array.isArray(playlists[playlistId]) ? playlists[playlistId] : [];
      }
      if (ids.some((videoId) => !state.byId.has(videoId) && !state.hnById.has(videoId) && !state.hnExisting?.[videoId])) {
        await Promise.all([
          loadHNVideos().catch(() => null),
          loadHNExisting().catch(() => null),
        ]);
      }
      const index = ids.indexOf(id);
      if (index >= 0) {
        queue = ids.slice(index).filter((videoId) => Boolean(videoById(videoId)));
      }
    } catch {
      state.builtinIds = null;
    }
  }
  if (location.hash !== routeHash) return;

  document.title = `${v.title} — HackerTube`;
  setPageMeta({
    title: document.title,
    description: `${v.channel} · ${compact.format(v.views)} views${v.year ? ` · ${v.year}` : ""}. Topics: ${(v.topics || []).map((topic) => state.topicLabels[topic] || topic).join(", ")}.`,
    canonical: `${SITE_URL}#/watch/${encodeURIComponent(v.id)}`,
    image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    type: "video.other",
  });
  const related = state.videos
    .filter((x) => x.id !== v.id && x.topics.some((t) => v.topics.includes(t)))
    .sort((a, b) => shared(b, v) - shared(a, v) || b.score - a.score)
    .slice(0, 8);
  const ch = state.channels.get(v.channel_id);
  const playerMarkup = youtubeIframeMarkup(v.id, v.title, queue.length > 1 ? queue : null, autoplay);

  view.innerHTML = `<section class="watch">
    <div class="watch-main">
      <div class="player">${playerMarkup}</div>
      <h1 class="watch-title"${langAttrs(v.title)}>${esc(v.title)}</h1>
      <div class="watch-bar">
        <a class="watch-channel" id="watch-channel" href="#/channel/${v.channel_id}" title="${esc(v.channel)}">
          <span class="avatar" id="watch-avatar">${esc(v.channel.trim().charAt(0))}</span>
          <span class="watch-channel-text"><b id="watch-channel-name"${langAttrs(v.channel)}>${esc(v.channel)}</b><small id="watch-channel-count">${ch ? `${videos(ch.count)} indexed` : "Channel"}</small></span>
        </a>
        ${watchActionsHTML(id)}
      </div>
      <div class="watch-meta">
        <span>${icon("eye")} ${compact.format(v.views)} views</span>
        ${v.year ? `<span>${icon("calendar")} ${v.year}</span>` : ""}
        <span>${icon("clock")} ${fmtDuration(v.duration)}</span>
        <span>${icon("tag")} ${esc(KIND_LABELS[v.kind] || "Tutorial")}</span>
        <span>${icon("level")} ${esc(LEVEL_LABELS[v.level] || "General")}</span>
      </div>
      <p id="watch-description" class="watch-description"${v.description ? langAttrs(v.description) : " hidden"}>${esc(v.description || "")}</p>
      <section id="hn-evidence" class="hn-evidence" hidden></section>
    </div>
    <aside class="watch-side">
      <h2 class="section-title">Related videos</h2>
      <div class="related-grid">${related.map((x) => card(x)).join("") || '<p class="count">Nothing related yet.</p>'}</div>
    </aside>
  </section>`;
  syncSidebar();
  renderHNEvidence(id);
  startYouTubePlayer(v.id, queue, playlistId, routeHash, autoplay);
}

function youtubeIframeMarkup(videoId, title, queue = null, autoplay = false) {
  const needsApi = true;
  const params = new URLSearchParams({
    controls: "1",
    disablekb: "0",
    enablejsapi: "1",
    fs: "1",
    iv_load_policy: "1",
    origin: location.origin,
    rel: "0",
    playsinline: "1",
  });
  if (queue && queue.length > 1) params.set("playlist", queue.slice(1).join(","));
  if (autoplay) params.set("autoplay", "1");

  return `<iframe ${needsApi ? 'id="youtube-player"' : ""}
    src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}"
    title="${esc(title)}" loading="lazy" allowfullscreen
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const readinessTimeout = setTimeout(() => {
      youtubeApiPromise = null;
      reject(new Error("The YouTube player API did not become ready in time"));
    }, 35000);

    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(readinessTimeout);
      resolve(window.YT);
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      clearTimeout(readinessTimeout);
      youtubeApiPromise = null;
      reject(new Error("Could not load the YouTube player API"));
    };
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

async function startYouTubePlayer(videoId, queue, playlistId, routeHash, autoplay = false) {
  const playerFrame = $("#youtube-player");
  if (!playerFrame) return;
  try {
    const YT = await loadYouTubeIframeApi();
    if (location.hash !== routeHash || !playerFrame.isConnected) return;
    playlistPlayer = new YT.Player(playerFrame, {
      events: {
        onReady(event) {
          if (location.hash !== routeHash) return;
          stopProgressPoll();
          progressPoll = setInterval(saveCurrentProgress, 5000);
          const pending = state.pendingResume;
          if (pending && pending.id === videoId) {
            event.target.seekTo(pending.position, true);
            event.target.playVideo();
            state.pendingResume = null;
          } else if (queue && queue.length > 1) event.target.loadPlaylist(queue, 0, 0);
          else if (autoplay) event.target.playVideo();
        },
        onStateChange(event) {
          if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
            saveCurrentProgress();
          }
          if (event.data === YT.PlayerState.ENDED && (!queue || queue.length <= 1) && state.settings.autoplayNext) {
            const currentId = event.target.getVideoData()?.video_id || videoId;
            const next = nextRelatedVideo(currentId);
            if (next) location.hash = videoWatchHref(next);
            else {
              const related = state.hnRelated?.[currentId]?.[0];
              if (related?.vid) location.hash = `#/hn-watch/${encodeURIComponent(related.vid)}`;
            }
          }
          if (event.data !== YT.PlayerState.PLAYING) return;
          const playingId = event.target.getVideoData()?.video_id;
          if (playingId && playingId !== state.current && queue?.includes(playingId)) {
            syncWatchVideo(playingId, playlistId);
          }
        },
      },
    });
  } catch {
    // The embedded player keeps working with its native controls if the API fails.
  }
}

function syncWatchVideo(id, playlistId) {
  const video = videoById(id);
  if (!video) return;
  if (!state.byId.has(id) || location.hash.startsWith("#/hn-watch/")) {
    location.hash = playlistPlaybackHref(video, playlistId, true);
    return;
  }
  state.current = id;
  markSeen(id);
  document.title = `${video.title} — HackerTube`;
  setPageMeta({
    title: document.title,
    description: `${video.channel} · ${compact.format(video.views)} views${video.year ? ` · ${video.year}` : ""}. Topics: ${(video.topics || []).map((topic) => state.topicLabels[topic] || topic).join(", ")}.`,
    canonical: `${SITE_URL}#/watch/${encodeURIComponent(id)}`,
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    type: "video.other",
  });

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
  if (title) {
    title.textContent = video.title;
    applyTextLang(title, video.title);
  }
  if (channelName) {
    channelName.textContent = video.channel;
    applyTextLang(channelName, video.channel);
  }
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
  const description = $("#watch-description");
  if (description) {
    description.textContent = video.description || "";
    description.hidden = !video.description;
    applyTextLang(description, video.description || "");
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
  history.replaceState(null, "", `${location.pathname}${location.search}${playlistPlaybackHref(video, playlistId, true)}`);
}

function shared(a, b) {
  return a.topics.filter((t) => b.topics.includes(t)).length;
}

function nextRelatedVideo(id) {
  const video = state.byId.get(id);
  if (!video) return null;
  return state.videos
    .filter((item) => item.id !== id && item.topics.some((topic) => video.topics.includes(topic)))
    .sort((a, b) => shared(b, video) - shared(a, video) || b.score - a.score)[0] || null;
}

function markSeen(id) {
  state.seen = [id, ...state.seen.filter((x) => x !== id)].slice(0, 50);
  storeSet(STORE.seen, state.seen);
  invalidateHomeOrder();
}

function progressFor(id) {
  const progress = state.progress?.[id];
  if (!progress || !Number.isFinite(progress.duration) || progress.duration <= 0) return null;
  if (!Number.isFinite(progress.position) || progress.position < 5) return null;
  const ratio = progress.position / progress.duration;
  if (ratio >= 0.95) return null;
  return { ...progress, ratio };
}

function saveProgress(id, position, duration) {
  if (!id || !Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
  if (!state.progress || typeof state.progress !== "object") state.progress = {};
  if (position < 5 || position > duration - 15) {
    delete state.progress[id];
  } else {
    state.progress[id] = { position, duration, updatedAt: Date.now() };
    const entries = Object.entries(state.progress)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, 100);
    state.progress = Object.fromEntries(entries);
  }
  storeSet(STORE.progress, state.progress);
}

function stopProgressPoll() {
  clearInterval(progressPoll);
  progressPoll = null;
}

function saveCurrentProgress() {
  const player = playlistPlayer;
  if (!player || typeof player.getCurrentTime !== "function") return;
  try {
    const position = Number(player.getCurrentTime());
    if (!Number.isFinite(position) || position <= 0) return;
    const id = player.getVideoData?.()?.video_id || state.current;
    saveProgress(id, position, Number(player.getDuration()));
  } catch {
    // The iframe may be navigating between playlist videos.
  }
}

/* ---------- Hacker News recommendations ---------- */

async function loadHNPreview() {
  if (state.hnPreview) return state.hnPreview;
  if (!state.hnPreviewPromise) {
    state.hnPreviewPromise = fetchJson("data/hacker-news/videos-preview.json").then((records) => {
      state.hnPreview = records;
      return records;
    }).catch((error) => {
      state.hnPreviewPromise = null;
      throw error;
    });
  }
  return state.hnPreviewPromise;
}

async function loadHNVideos() {
  if (!state.hnVideosPromise) {
    state.hnVideosPromise = fetchJson("data/hacker-news/videos.json").then((records) => {
      state.hnVideos = records;
      state.hnById = new Map(records.map((record) => [record.vid, record]));
      state.hnSearchEngine = null;
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
  const prefix = videoId[0].toLowerCase();
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
        <span><b${langAttrs(comment.author || "")}>${esc(comment.author || "Anonymous")}</b> · ${esc(comment.month || "")}</span>
        <span>${esc(HN_STANCE_LABELS[comment.stance] || comment.stance || "Comment")}</span>
      </div>
      ${comment.story_title ? `<div class="hn-story"${langAttrs(comment.story_title)}>${esc(comment.story_title)}</div>` : ""}
      <p${langAttrs(comment.text || "")}>${esc(comment.text || "")}</p>
      ${comment.why ? `<div class="hn-why"${langAttrs(comment.why)}>${esc(comment.why)}</div>` : ""}
      <a class="hn-source-link" href="${esc(comment.hn_url || "#")}" target="_blank" rel="noopener noreferrer">Open Hacker News comment</a>
    </article>`).join("")}</div>`;
}

function hnDescriptionHTML(video, mainVideo = null) {
  const hn = video.hn || {};
  const metadata = [];
  const views = Number(mainVideo?.views);
  const year = Number(mainVideo?.year);

  if (Number.isFinite(views) && views > 0) {
    metadata.push(`${compact.format(views)} views`);
  }
  if (Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear()) {
    const yearsAgo = new Date().getFullYear() - year;
    metadata.push(yearsAgo === 0 ? "this year" : `${yearsAgo} ${yearsAgo === 1 ? "year" : "years"} ago`);
  }
  if (!(Number.isFinite(views) && views > 0) && Number(hn.mentions) > 0) {
    metadata.push(`${Number(hn.mentions)} HN mentions`);
  }
  if (Number(hn.recommenders) > 0) {
    metadata.push(`${Number(hn.recommenders)} recommenders`);
  }

  const contentType = String(video.content_type || (mainVideo?.kind ? KIND_LABELS[mainVideo.kind] || mainVideo.kind : "")).trim();
  if (contentType) metadata.push(contentType.toLowerCase());
  if (video.shelf_life) metadata.push(String(video.shelf_life).toLowerCase());

  const categories = (video.categories || []).map((category) => {
    const label = String(category.name || category.id || "").trim();
    if (!label) return "";
    const query = category.name || category.id || label;
    return `<a class="hn-tag hn-tag-category"${langAttrs(label)} href="#/hacker-news/${esc(encodeURIComponent(query))}">${esc(label)}</a>`;
  }).join("");
  const tags = (video.tags || []).map((tag) => {
    const label = String(tag || "").replace(/^#+/, "").trim();
    if (!label) return "";
    return `<a class="hn-tag hn-tag-topic"${langAttrs(label)} href="#/hacker-news/${esc(encodeURIComponent(label))}">#${esc(label)}</a>`;
  }).join("");
  const tagLinks = categories + tags;

  return `<div class="hn-desc">
    ${metadata.length ? `<div class="hn-top-line">${metadata.map(esc).join(" · ")}</div>` : ""}
    ${video.summary ? `<p${langAttrs(video.summary)}>${esc(video.summary)}</p>` : ""}
    ${video.why_hn ? `<p class="hn-desc-why"${langAttrs(video.why_hn)}>${esc(video.why_hn)}</p>` : ""}
    ${tagLinks ? `<div class="hn-desc-tags">${tagLinks}</div>` : ""}
  </div>`;
}

function hnContextHTML(video, comments, commentsUnavailable = false, mainVideo = null) {
  const quote = video.quote?.text
    ? `<blockquote class="hn-quote">“${esc(video.quote.text)}”${video.quote.year ? ` <span>· ${esc(video.quote.year)}</span>` : ""}</blockquote>`
    : "";
  return `
    <section class="hn-context">
      ${hnDescriptionHTML(video, mainVideo)}
      ${quote}
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
    target.innerHTML = hnContextHTML(video, comments || [], comments === null, state.byId.get(videoId));
  } catch (error) {
    const target = $("#hn-evidence");
    if (target && state.current === videoId) {
      target.hidden = false;
      target.innerHTML = '<p class="count">Hacker News context could not be loaded.</p>';
    }
  }
}

function hnCard(video) {
  const mainVideo = state.byId.get(video.vid);
  return card(mainVideo || video, { hn: video });
}

const HN_PROGRAMMING_AREAS = new Set([
  "software",
  "systems-security",
  "ai-data",
  "math-theory",
  "hardware",
  "computing-history-culture",
  "design-graphics-media",
  "games",
]);

function hnLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function hnOptionMap(records, key) {
  const options = new Map();
  for (const record of records) {
    const value = record[key];
    if (value) options.set(String(value), hnLabel(value));
  }
  return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function hnAreaOptions(records) {
  const options = new Map();
  for (const record of records) {
    for (const category of record.categories || []) {
      if (category?.area) options.set(category.area, category.area_name || hnLabel(category.area));
    }
  }
  return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function hnInProgrammingScope(record) {
  return (record.categories || []).some((category) => HN_PROGRAMMING_AREAS.has(category.area));
}

function hnIsRecommended(record) {
  return Number(record.hn?.recommenders || record.recommenders || 0) > 0 || Number(record.score || 0) > 0;
}

function hnMatchesFilters(record) {
  const filters = state.hnFilters;
  if (filters.scope === "programming" && !hnInProgrammingScope(record)) return false;
  if (filters.recommendation === "recommended" && !hnIsRecommended(record)) return false;
  if (filters.recommendation === "discussed" && hnIsRecommended(record)) return false;
  if (filters.contentType && record.content_type !== filters.contentType) return false;
  if (filters.level && record.level !== filters.level) return false;
  if (filters.shelfLife && record.shelf_life !== filters.shelfLife) return false;
  if (filters.area && !(record.categories || []).some((category) => category.area === filters.area)) return false;
  return true;
}

function hnFilterCount() {
  const filters = state.hnFilters;
  let count = filters.scope !== HN_DEFAULTS.scope ? 1 : 0;
  for (const key of ["recommendation", "contentType", "level", "shelfLife", "area"]) {
    if (filters[key]) count++;
  }
  if (filters.sort !== HN_DEFAULTS.sort) count++;
  return count;
}

const HN_FILTER_PARAMS = {
  hnScope: "scope",
  hnRecommendation: "recommendation",
  hnType: "contentType",
  hnLevel: "level",
  hnShelf: "shelfLife",
  hnArea: "area",
  hnSort: "sort",
};

function applyHNFilterParams(params) {
  for (const [param, key] of Object.entries(HN_FILTER_PARAMS)) {
    const value = params.get(param);
    if (value) state.hnFilters[key] = value;
  }
}

function hnHashFromState(query = "") {
  const params = new URLSearchParams();
  const filters = state.hnFilters;
  if (filters.scope !== HN_DEFAULTS.scope) params.set("hnScope", filters.scope);
  for (const [param, key] of Object.entries(HN_FILTER_PARAMS)) {
    if (key !== "scope" && key !== "sort" && filters[key]) params.set(param, filters[key]);
  }
  if (filters.sort !== HN_DEFAULTS.sort) params.set("hnSort", filters.sort);
  const path = query ? `#/hacker-news/${encodeURIComponent(query)}` : "#/hacker-news";
  const value = params.toString();
  return value ? `${path}?${value}` : path;
}

function syncHNUrl(query = "") {
  const hash = hnHashFromState(query);
  if ((location.hash || "#/") !== hash && typeof history !== "undefined" && history.replaceState) {
    history.replaceState(null, "", hash);
  }
}

function hnComparator() {
  const sort = state.hnFilters.sort === "best" ? "score" : state.hnFilters.sort;
  const value = (record) => {
    if (sort === "recommenders") return Number(record.hn?.recommenders || 0);
    if (sort === "mentions") return Number(record.hn?.mentions || 0);
    return Number(record.score || 0);
  };
  return (a, b) => value(b) - value(a)
    || String(a.title || "").localeCompare(String(b.title || ""));
}

function hnFiltersPanel(records) {
  const filters = state.hnFilters;
  const contentTypes = hnOptionMap(records, "content_type");
  const levels = hnOptionMap(records, "level");
  const shelfLives = hnOptionMap(records, "shelf_life");
  const areas = hnAreaOptions(records);
  return `<div class="filters hn-filters">
    <div class="filter-group">
      <span class="filter-label">Scope</span>
      <div class="segmented hn-scope" role="group" aria-label="Hacker News scope">
        <button type="button" data-hn-scope="programming" title="Software, systems, AI, math, hardware, computing culture, design, and games" class="${filters.scope === "programming" ? "active" : ""}" aria-pressed="${filters.scope === "programming"}">Programming</button>
        <button type="button" data-hn-scope="all" class="${filters.scope === "all" ? "active" : ""}" aria-pressed="${filters.scope === "all"}">All HN</button>
      </div>
    </div>
    <div class="filter-grid">
      ${field("recommendation", "Recommendation", "All videos", [["recommended", "Recommended only"], ["discussed", "Discussed only"]], filters.recommendation, "hn")}
      ${field("contentType", "Type", "All types", contentTypes, filters.contentType, "hn")}
      ${field("level", "Level", "All levels", levels, filters.level, "hn")}
      ${field("shelfLife", "Shelf life", "All shelf lives", shelfLives, filters.shelfLife, "hn")}
      ${field("area", "Area", "All areas", areas, filters.area, "hn")}
      ${field("sort", "Sort", "Best match", [["score", "HN score"], ["recommenders", "Most recommenders"], ["mentions", "Most mentions"]], filters.sort, "hn")}
    </div>
    <div class="filter-foot">
      <button class="btn" data-hn-clear ${hnFilterCount() ? "" : "disabled"}>Clear all</button>
      <button class="btn primary" data-hn-close>Done</button>
    </div>
  </div>`;
}

function ensureHNSearchIndex() {
  if (state.hnSearchEngine) return state.hnSearchEngine;
  state.hnSearchEngine = new window.HackerTubeSearch.SearchIndex(state.hnVideos || [], (record) => ({
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
  }), {
    getRank: (record) => Math.min(1, Math.max(0, Number(record.score) || 0) / 25),
    getGroup: (record) => record.channel,
    getDedupeKey: searchDedupeKey,
    groupLimit: 2,
    diversityLimit: 36,
  });
  return state.hnSearchEngine;
}

function hnListMarkup(source, total, { query = "", partial = false } = {}) {
  let list = source.filter(hnMatchesFilters);
  if (state.hnFilters.sort !== "best" || !query) list = [...list].sort(hnComparator());
  const shown = list.slice(0, state.hnLimit);
  const activeFilters = hnFilterCount();
  const count = partial
    ? `${videos(list.length)} · loading full catalog…`
    : `${videos(list.length)}${list.length !== total ? ` · ${total} total` : ""}`;
  return `<section class="feed">
    <div class="feed-head">
      <div><h1>Hacker News</h1><p class="hn-intro">Videos recommended or discussed in Hacker News comments. Main-catalog videos are excluded. The default scope is programming; switch to All HN for every topic.</p></div>
      <button class="btn filter-btn ${activeFilters ? "on" : ""}" data-hn-filter-toggle aria-expanded="${state.hnUiOpen}">
        ${icon("filter")} Filters${activeFilters ? ` <span class="filter-count">${activeFilters}</span>` : ""}
      </button>
      <span class="count">${count}</span>
    </div>
    ${state.hnUiOpen ? hnFiltersPanel(source) : ""}
    ${shown.length ? `<div class="grid">${shown.map(hnCard).join("")}</div>` : `<div class="empty"><strong>No matches</strong><p>Try another search or adjust the Hacker News filters.</p>${activeFilters ? '<button class="btn" data-hn-clear>Clear filters</button>' : ""}</div>`}
    ${list.length > state.hnLimit ? `<div class="more"><button class="btn" data-hn-more>Show more (${list.length - state.hnLimit})</button></div>` : ""}
    ${hnAttributionHTML()}
  </section>`;
}

async function renderHackerNews(query = "", params = null) {
  if (params) {
    state.hnFilters = Object.assign({}, HN_DEFAULTS);
    applyHNFilterParams(params);
  }
  if (state.hnQuery !== query) {
    state.hnQuery = query;
    state.hnLimit = pageSize();
  }
  $("#q").value = query;
  document.title = "Hacker News recommendations — HackerTube";
  setPageMeta({
    title: document.title,
    description: "Programming videos recommended and discussed in Hacker News comments, with archived discussion context.",
    canonical: `${SITE_URL}${hnHashFromState(query)}`,
  });
  view.innerHTML = '<section><div class="feed-head"><h1>Hacker News</h1><span class="count">Loading recommendations…</span></div></section>';
  try {
    if (!query && !state.hnVideos) {
      const preview = await loadHNPreview().catch(() => null);
      if (preview && !state.hnVideos && (location.hash || "#/").startsWith("#/hacker-news") && state.hnQuery === query) {
        view.innerHTML = hnListMarkup(preview, state.hnTotal || preview.length, { partial: true });
        syncSidebar();
        syncHNUrl(query);
      }
    }
    const records = await loadHNVideos();
    if (!(location.hash || "#/").startsWith("#/hacker-news") || state.hnQuery !== query) return;
    state.hnTotal = records.length;
    const source = query
      ? ensureHNSearchIndex().search(query).map((result) => result.item)
      : records;
    view.innerHTML = hnListMarkup(source, records.length, { query });
    syncSidebar();
    syncHNUrl(query);
  } catch (error) {
    if (!(location.hash || "#/").startsWith("#/hacker-news") || state.hnQuery !== query) return;
    view.innerHTML = `<section class="error"><strong>Could not load Hacker News data.</strong><p>${esc(error.message)}</p></section>`;
  }
}

async function renderHNWatch(requestedVideoId, playlistId = null, autoplay = false) {
  const routeHash = location.hash;
  const routeParams = new URLSearchParams();
  if (playlistId) routeParams.set("list", playlistId);
  if (autoplay) routeParams.set("autoplay", "1");
  const routeQuery = routeParams.toString();
  const requestedRoute = "#/hn-watch/" + encodeURIComponent(requestedVideoId) + (routeQuery ? "?" + routeQuery : "");
  document.title = "Hacker News video — HackerTube";
  view.innerHTML = '<section class="watch"><div class="watch-main"><p class="count">Loading video and archived comments…</p></div></section>';
  try {
    const aliases = await loadHNAliases();
    if (location.hash !== routeHash) return;
    const videoId = aliases[requestedVideoId] || requestedVideoId;
    const [, existing, related, commentResult] = await Promise.all([
      loadHNVideos(),
      loadHNExisting(),
      loadHNRelated(),
      loadHNMentions(videoId).catch(() => null),
    ]);
    if (location.hash !== routeHash) return;
    const video = state.hnById.get(videoId) || existing[videoId];
    if (!video) return renderNotFound();
    if (requestedVideoId !== videoId) {
      location.hash = "#/hn-watch/" + encodeURIComponent(videoId) + (routeQuery ? "?" + routeQuery : "");
      return;
    }
    state.current = videoId;
    markSeen(videoId);
    let queue = [];
    if (playlistId) {
      try {
        let ids = [];
        if (playlistId.startsWith("pl_")) {
          const playlist = playlistById(playlistId);
          ids = Array.isArray(playlist?.ids) ? playlist.ids : [];
        } else {
          if (!state.builtinIds) state.builtinIds = fetchJson("data/playlists.json");
          const playlists = await state.builtinIds;
          ids = Array.isArray(playlists[playlistId]) ? playlists[playlistId] : [];
        }
        const index = ids.indexOf(videoId);
        if (index >= 0) queue = ids.slice(index).filter((nextId) => Boolean(videoById(nextId)));
      } catch {
        state.builtinIds = null;
      }
    }
    if (location.hash !== routeHash) return;
    const commentsUnavailable = commentResult === null;
    const comments = commentResult || [];
    document.title = `${video.title} — HackerTube`;
    setPageMeta({
      title: document.title,
      description: video.summary || `${video.channel} · referenced on Hacker News.`,
      canonical: `${SITE_URL}#/hn-watch/${encodeURIComponent(videoId)}`,
      image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      type: "video.other",
    });
    const mainVideo = state.byId.get(videoId);
    const quote = video.quote?.text
      ? `<blockquote class="hn-quote">“${esc(video.quote.text)}”${video.quote.year ? ` <span>· ${esc(video.quote.year)}</span>` : ""}</blockquote>`
      : "";
    const relatedCards = (related[videoId] || [])
      .map((item) => state.hnById.get(item.vid) || existing[item.vid])
      .filter(Boolean)
      .slice(0, 8);
    view.innerHTML = `<section class="watch hn-watch">
      <div class="watch-main">
        <div class="player">${youtubeIframeMarkup(video.vid, video.title, queue.length > 1 ? queue : null, autoplay && queue.length <= 1)}</div>
        <h1 class="watch-title"${langAttrs(video.title)}>${esc(video.title)}</h1>
        <div class="watch-bar">
          <div class="watch-channel"><span class="avatar">${esc((video.channel || "?").trim().charAt(0))}</span><span class="watch-channel-text"><b${langAttrs(video.channel || "")}>${esc(video.channel || "Unknown channel")}</b><small>Referenced on Hacker News</small></span></div>
          ${watchActionsHTML(videoId)}
        </div>
        ${hnDescriptionHTML(video, mainVideo)}
        ${quote}
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
    startYouTubePlayer(video.vid, queue, playlistId, routeHash, autoplay && queue.length <= 1);
  } catch (error) {
    if (location.hash !== routeHash) return;
    view.innerHTML = `<section class="error"><strong>Could not load this video.</strong><p>${esc(error.message)}</p></section>`;
  }
}
/* ---------- Collections ---------- */

const COLLECTIONS = {
  liked: { title: "Liked", set: () => state.likes, empty: "No liked videos yet.", hint: "Use the Like button on any video." },
  later: { title: "Watch later", set: () => state.saved, empty: "Watch later is empty.", hint: "Use the clock icon on any card or the Watch later button." },
  history: { title: "History", set: null, empty: "Nothing watched yet.", hint: "Videos you open show up here. The last 50 are kept in your browser." },
};

async function renderCollection(kind) {
  const cfg = COLLECTIONS[kind];
  const routeHash = location.hash;
  let ids = kind === "history" ? [...state.seen] : [...cfg.set()];
  if (ids.some((id) => !state.byId.has(id) && !state.hnById.has(id) && !state.hnExisting?.[id])) {
    try { await Promise.all([loadHNVideos(), loadHNExisting()]); } catch { /* Render any records that were available. */ }
  }
  if (location.hash !== routeHash) return;
  // Read the collection again after async loading so changes made while loading are not lost.
  ids = kind === "history" ? [...state.seen] : [...cfg.set()];
  const list = kind === "history"
    ? ids.map(videoById).filter(Boolean)
    : [
        ...state.videos.filter((video) => cfg.set().has(video.id)),
        ...ids.filter((id) => !state.byId.has(id)).map(videoById).filter(Boolean),
      ];
  document.title = `${cfg.title} — HackerTube`;
  const continueList = kind === "history"
    ? ids.map(videoById).filter((video) => video && progressFor(video.id || video.vid)).slice(0, 6)
    : [];
  const clear = list.length ? `<button class="btn" data-clear-collection="${kind}">${icon("trash")} Clear all</button>` : "";
  view.innerHTML = `<section>
    <div class="feed-head"><h1>${cfg.title}</h1><span class="count">${videos(list.length)}</span></div>
    ${continueList.length ? `<section class="continue-watching"><h2 class="section-title">Continue watching</h2><div class="grid">${continueList.map((video) => card(video)).join("")}</div></section>` : ""}
    ${clear ? `<div class="head-tools">${clear}</div>` : ""}
    ${list.length
      ? `<div class="grid">${list.map((video) => card(video, { remove: kind })).join("")}</div>`
      : `<div class="empty"><strong>${cfg.empty}</strong><p>${cfg.hint}</p><a class="btn" href="#/">Browse videos</a></div>`}
  </section>`;
  syncSidebar();
}

function videoById(id) {
  return state.byId.get(id) || state.hnById.get(id) || state.hnExisting?.[id] || null;
}

/* ---------- Categories ---------- */

function renderCategories() {
  document.title = "Categories — HackerTube";
  setPageMeta({
    title: document.title,
    description: `Browse ${state.meta.topics.length} programming topics across the HackerTube catalog.`,
    canonical: `${SITE_URL}#/categories`,
  });
  const topics = [...state.meta.topics].sort((a, b) => b.count - a.count);
  view.innerHTML = `<section>
    <div class="feed-head"><h1>Categories</h1><span class="count">${topics.length} topics</span></div>
    <div class="topic-grid">
      ${topics.map((t) => `<a class="topic-card" href="#/?topics=${encodeURIComponent(t.id)}" data-goto-topic="${t.id}">
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
  invalidateHomeOrder();
  toast(`Added to “${pl.name}”`, "playlists");
  syncSidebar();
}

function diverseCreatorPlaylists(playlists, limit = 24) {
  const groups = new Map();
  for (const playlist of playlists) {
    const key = playlist.channel_id || playlist.channel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(playlist);
  }
  const buckets = [...groups.values()];
  const result = [];
  let added = true;
  while (result.length < limit && added) {
    added = false;
    for (const bucket of buckets) {
      if (result.length >= limit) break;
      if (bucket.length) {
        result.push(bucket.shift());
        added = true;
      }
    }
  }
  return result;
}

function filteredCreatorPlaylists() {
  const query = state.playlistQuery.trim().toLowerCase();
  return state.builtin.filter((playlist) => {
    if (state.playlistChannel && playlist.channel_id !== state.playlistChannel) return false;
    if (!query) return true;
    return `${playlist.title || ""} ${playlist.channel || ""}`.toLowerCase().includes(query);
  });
}

async function renderPlaylists() {
  const routeHash = location.hash;
  const hasUnresolvedVideos = state.playlists.some((playlist) =>
    playlist.ids.some((id) => !state.byId.has(id) && !state.hnById.has(id) && !state.hnExisting?.[id])
  );
  if (hasUnresolvedVideos) {
    try { await Promise.all([loadHNVideos(), loadHNExisting()]); } catch { /* Render available playlist data even if a source fails. */ }
  }
  if (location.hash !== routeHash) return;
  document.title = "Playlists — HackerTube";
  setPageMeta({
    title: document.title,
    description: `Browse ${state.builtin.length} creator playlists and your own saved playlists.`,
    canonical: `${SITE_URL}#/playlists`,
  });
  const total = state.builtin.length + state.playlists.length;
  const filtered = filteredCreatorPlaylists();
  const creators = diverseCreatorPlaylists(filtered, state.playlistLimit);
  const channels = [...new Map(state.builtin
    .filter((playlist) => playlist.channel_id)
    .map((playlist) => [playlist.channel_id, playlist.channel])).entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { numeric: true }));
  const isFiltered = Boolean(state.playlistQuery.trim() || state.playlistChannel);
  view.innerHTML = `<section>
    <div class="feed-head"><h1>Playlists</h1><span class="count">${total} ${total === 1 ? "playlist" : "playlists"}</span></div>
    <form class="create-pl" data-create-playlist>
      <input name="name" placeholder="New playlist name" maxlength="40" required aria-label="New playlist name">
      <button class="btn primary" type="submit">${icon("plus")} Create</button>
    </form>
    ${state.builtin.length ? `<h2 class="section-title">From creators <span class="count">${filtered.length}${isFiltered ? ` of ${state.builtin.length}` : ""}</span></h2>
      <form class="pl-filter" data-playlist-filter>
        <input name="q" value="${esc(state.playlistQuery)}" placeholder="Search creator playlists" aria-label="Search creator playlists">
        <select name="channel" aria-label="Filter creator playlists by channel">
          <option value="">All channels</option>
          ${channels.map(([id, name]) => `<option value="${esc(id)}" ${state.playlistChannel === id ? "selected" : ""}>${esc(name)}</option>`).join("")}
        </select>
        <button class="btn" type="submit">${icon("search")} Search</button>
        ${isFiltered ? '<button class="btn" type="button" data-playlist-clear>Clear</button>' : ""}
      </form>
      ${creators.length
        ? `<div class="pl-grid">${creators.map(creatorPlaylistCard).join("")}</div>`
        : '<div class="empty"><strong>No creator playlists match</strong><p>Try a different title or channel.</p><button class="btn" data-playlist-clear>Clear filters</button></div>'}
      ${creators.length < filtered.length ? `<div class="more"><button class="btn" data-more-playlists>Show more (${filtered.length - creators.length})</button></div>` : ""}` : ""}
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
      <div><a href="#/playlist/${p.id}"${langAttrs(p.title)}>${esc(p.title)}</a><small${langAttrs(p.channel)}>${esc(p.channel)} · ${videos(p.count)}</small></div>
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
      ${list.length ? `<a class="btn primary" href="#/watch/${list[0].id}?list=${encodeURIComponent(id)}&autoplay=1">${icon("play")} Play all</a>` : ""}
      <a class="btn" href="#/channel/${meta.channel_id}">${icon("channels")} ${esc(meta.channel)}</a>
    </div>
    ${list.length
      ? `<div class="grid">${list.map((v) => card(v)).join("")}</div>`
      : `<div class="empty"><strong>Nothing from this playlist is indexed</strong><p>Its videos may be short, private or outside the current index.</p><a class="btn" href="#/playlists">All playlists</a></div>`}
  </section>`;
  syncSidebar();
}

function playlistCard(p) {
  const first = p.ids.map(videoById).find(Boolean);
  const firstId = first?.id || first?.vid;
  return `<article class="pl-card">
    <a class="pl-cover" href="#/playlist/${p.id}" aria-label="${esc(p.name)}">
      ${first ? `<img src="${thumbSrc(firstId)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${firstId}/hqdefault.jpg'">` : icon("playlists")}
      <span>${p.ids.length}</span>
    </a>
    <div class="pl-row">
      <div><a href="#/playlist/${p.id}"${langAttrs(p.name)}>${esc(p.name)}</a><small>${p.ids.length ? videos(p.ids.length) : "Empty"}</small></div>
      <button class="icon-btn" data-delete-playlist="${p.id}" aria-label="Delete playlist">${icon("trash")}</button>
    </div>
  </article>`;
}

async function renderPlaylist(id) {
  const pl = playlistById(id);
  if (!pl) return renderNotFound();
  const routeHash = location.hash;
  if (pl.ids.some((videoId) => !state.byId.has(videoId) && !state.hnById.has(videoId) && !state.hnExisting?.[videoId])) {
    try { await Promise.all([loadHNVideos(), loadHNExisting()]); } catch { /* Keep any resolvable videos visible. */ }
  }
  if (location.hash !== routeHash) return;
  const list = pl.ids.map(videoById).filter(Boolean);
  document.title = `${pl.name} — HackerTube`;
  view.innerHTML = `<section>
    <div class="feed-head"><h1>${esc(pl.name)}</h1><span class="count">${videos(list.length)}</span></div>
    <div class="pl-head">
      ${list.length ? `<a class="btn primary" href="${playlistPlaybackHref(list[0], pl.id, true)}">${icon("play")} Play</a>` : ""}
      <button class="btn danger" data-delete-playlist="${pl.id}">${icon("trash")} Delete playlist</button>
    </div>
    ${list.length
      ? `<div class="grid">${list.map((video) => card(video, { remove: "playlist", playlist: pl.id })).join("")}</div>`
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
      <label class="setting-row">
        <span class="row-ic">${icon("play")}</span>
        <span class="setting-text"><b>Autoplay next</b><small>Play the next related video when a single video ends.</small></span>
        <input class="switch" type="checkbox" data-setting="autoplayNext" ${s.autoplayNext ? "checked" : ""}>
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
      <span><b${langAttrs(c.name)}>${esc(c.name)}</b><small>${videos(c.count)}</small></span>
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
    e.preventDefault();
    const target = `#/?topics=${encodeURIComponent(goto.dataset.gotoTopic)}`;
    if ((location.hash || "#/") === target) render();
    else location.hash = target;
    return;
  }

  if (e.target.closest("[data-refresh-home]")) {
    state.homeOrder = buildHomeOrder(state.videos);
    state.homeStale = false;
    renderFeed(state.scope);
    toast("Feed refreshed");
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

  if (e.target.closest("[data-hn-filter-toggle]")) {
    state.hnUiOpen = !state.hnUiOpen;
    renderHackerNews(state.hnQuery || "");
    return;
  }

  if (e.target.closest("[data-hn-close]")) {
    state.hnUiOpen = false;
    renderHackerNews(state.hnQuery || "");
    return;
  }

  const hnScope = e.target.closest("[data-hn-scope]");
  if (hnScope) {
    state.hnFilters.scope = hnScope.dataset.hnScope;
    state.hnLimit = pageSize();
    renderHackerNews(state.hnQuery || "");
    return;
  }

  if (e.target.closest("[data-hn-clear]")) {
    state.hnFilters = Object.assign({}, HN_DEFAULTS);
    state.hnLimit = pageSize();
    renderHackerNews(state.hnQuery || "");
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
    const group = option.dataset.selectGroup || "ui";
    closeSelects();
    if (group === "hn") {
      state.hnFilters[fieldName] = fieldName === "sort" && !value ? "best" : value;
      state.hnLimit = pageSize();
      renderHackerNews(state.hnQuery || "");
    } else {
      ui[fieldName] = fieldName === "sort" && !value ? "best" : value;
      ui.limit = pageSize();
      renderFeed(state.scope);
    }
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
    state.playlistLimit += 24;
    renderPlaylists();
    return;
  }

  if (e.target.closest("[data-playlist-clear]")) {
    state.playlistQuery = "";
    state.playlistChannel = "";
    state.playlistLimit = 24;
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
    resetFilters(state.scope.type === "all" ? "foryou" : "best");
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

  const resume = e.target.closest("[data-resume]");
  if (resume) {
    const id = resume.dataset.resume;
    const progress = progressFor(id);
    if (!progress) return;
    if (playlistPlayer && typeof playlistPlayer.seekTo === "function") {
      playlistPlayer.seekTo(progress.position, true);
      playlistPlayer.playVideo();
      toast(`Resumed at ${fmtDuration(progress.position)}`);
    } else {
      state.pendingResume = { id, position: progress.position };
      toast("Player is loading; resuming shortly.");
    }
    return;
  }

  const act = e.target.closest("[data-act]");
  if (act) {
    closeWatchActionMenu(true);
    toggleAct(act.dataset.act);
    return;
  }

  if (e.target.closest("[data-share]")) {
    closeWatchActionMenu(true);
    shareCurrentPage();
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

async function shareCurrentPage() {
  const url = location.href;
  const title = document.title;
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return;
    } catch {
      // The user may have cancelled the native share sheet.
    }
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement("textarea");
      input.value = url;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    toast("Link copied");
  } catch {
    toast("Could not copy the link.", "info");
  }
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
    if (key === "hideSeen" || key === "pageSize") {
      if (/^#\/($|longs|search\/|channel\/)/.test(location.hash || "#/")) renderFeed(state.scope);
    }
    return;
  }
}

function onViewSubmit(e) {
  const filterForm = e.target.closest("[data-playlist-filter]");
  if (filterForm) {
    e.preventDefault();
    state.playlistQuery = filterForm.elements.q.value.trim();
    state.playlistChannel = filterForm.elements.channel.value;
    state.playlistLimit = 24;
    renderPlaylists();
    return;
  }

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
  invalidateHomeOrder();
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
  invalidateHomeOrder();
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
  if (kind === "history" && state.progress[id]) {
    delete state.progress[id];
    storeSet(STORE.progress, state.progress);
  }
  storeSet(STORE.likes, [...state.likes]);
  storeSet(STORE.later, [...state.saved]);
  storeSet(STORE.seen, state.seen);
  invalidateHomeOrder();
  syncSidebar();
  render();
  toast("Removed", "close");
}

async function clearCollection(kind) {
  const label = kind === "history" ? "history" : kind === "liked" ? "likes" : "Watch later";
  const confirmed = await confirmAction({
    title: `Clear ${label}?`,
    message: `This will permanently remove ${label} from this browser. This cannot be undone.`,
    confirmLabel: "Clear",
  });
  if (!confirmed) return;

  if (kind === "history") {
    state.seen = [];
    state.progress = {};
  } else if (kind === "liked") state.likes.clear();
  else state.saved.clear();
  storeSet(STORE.seen, state.seen);
  storeSet(STORE.likes, [...state.likes]);
  storeSet(STORE.later, [...state.saved]);
  storeSet(STORE.progress, state.progress);
  invalidateHomeOrder();
  syncSidebar();
  render();
  toast(`Cleared ${label}`, "trash");
}

async function deletePlaylist(id) {
  const pl = playlistById(id);
  if (!pl) return;
  const confirmed = await confirmAction({
    title: "Delete playlist?",
    message: `“${pl.name}” and its saved video list will be removed from this browser. This cannot be undone.`,
    confirmLabel: "Delete",
  });
  if (!confirmed) return;

  state.playlists = state.playlists.filter((p) => p.id !== id);
  savePlaylists();
  invalidateHomeOrder();
  syncSidebar();
  if ((location.hash || "#/").startsWith("#/playlist/")) location.hash = "#/playlists";
  else render();
  toast("Playlist deleted", "trash");
}

async function resetAll() {
  const confirmed = await confirmAction({
    title: "Delete all local data?",
    message: "This will permanently delete likes, history, watch later, playlists and settings from this browser. This cannot be undone.",
    confirmLabel: "Delete all",
  });
  if (!confirmed) return;

  Object.values(STORE).forEach((key) => localStorage.removeItem(key));
  state.likes.clear();
  state.saved.clear();
  state.seen = [];
  state.progress = {};
  state.pendingResume = null;
  state.playlists = [];
  state.settings = Object.assign({}, DEFAULTS);
  state.homeOrder = [];
  state.homeStale = true;
  ui.limit = pageSize();
  applyTheme("dark");
  storeSet(STORE.settings, state.settings);
  storeSet(STORE.theme, state.theme);
  syncSidebar();
  render();
  toast("All data deleted", "trash");
}
