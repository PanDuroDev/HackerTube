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
const DEFAULTS = { pageSize: 36, hideSeen: false };
const STORE = { likes: "ht_likes", later: "ht_saved", seen: "ht_seen", playlists: "ht_playlists", settings: "ht_settings", theme: "ht_theme" };

const state = {
  videos: [],
  meta: null,
  byId: new Map(),
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
};
const ui = { topics: new Set(), level: "", kind: "", duration: "", year: "", channel: "", sort: "best", limit: pageSize(), open: false };
let pendingTopic = null;

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const videos = (n) => `${n} ${n === 1 ? "video" : "videos"}`;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

init();

async function init() {
  applyTheme(state.theme);
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
    const next = q ? `#/search/${encodeURIComponent(q)}` : "#/";
    if (location.hash === next) render();
    else location.hash = next;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#q").focus();
    }
    if (e.key === "Escape") setSidebar(false);
  });
  addEventListener("resize", () => {
    if (!matchMedia("(max-width: 980px)").matches) setSidebar(false);
  });
  if (matchMedia("(prefers-color-scheme: dark)").addEventListener) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.theme === "system") applyTheme("system");
    });
  }

  view.addEventListener("click", onViewClick);
  view.addEventListener("change", onViewChange);
  view.addEventListener("submit", onViewSubmit);

  try {
    const [videos, meta] = await Promise.all([
      fetchJson("data/videos.json"),
      fetchJson("data/meta.json"),
    ]);
    state.videos = videos;
    state.meta = meta;
    state.byId = new Map(videos.map((v) => [v.id, v]));
    state.channels = new Map(meta.channels.map((c) => [c.id, c]));
    state.topicLabels = Object.fromEntries(meta.topics.map((t) => [t.id, TOPIC_LABELS[t.id] || t.label]));
    state.longCount = videos.filter((v) => v.duration >= 1200).length;
    renderSidebar();
    addEventListener("hashchange", () => {
      setSidebar(false);
      scrollTo(0, 0);
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
  return fetch(url).then((r) => {
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

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 1900);
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
  if (open) document.body.classList.remove("side-collapsed");
  $("#sidebar").classList.toggle("open", open);
  $("#scrim").hidden = !open;
  $("#menuBtn").setAttribute("aria-expanded", String(open));
}

/* ---------- Routing ---------- */

function render() {
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
  if (seg === "playlists") return renderPlaylists();
  if (seg === "playlist") return renderPlaylist(arg);
  if (seg === "settings") return renderSettings();
  if (seg === "watch") return renderWatch(arg);
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
    ["settings", "#/settings", "settings", "Settings"],
  ];
  $("#sidebar").innerHTML = `
    <nav class="side-nav">
      ${nav.map(([key, href, ic, label]) => `<a class="side-link" data-nav="${key}" href="${href}">${icon(ic)}<span>${label}</span><span class="side-count" data-count="${key}"></span></a>`).join("")}
    </nav>
    <div class="side-title">Explore</div>
    <a class="side-link" data-nav="channels" href="#/channels">${icon("channels")}<span>Channels</span><span class="side-count" data-count="channels"></span></a>
    <p class="side-foot">${videos(state.meta.total)} · ${state.meta.channels.length} channels</p>`;
  syncSidebar();
  $("#sidebar").addEventListener("click", (e) => {
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
  const active = map[hash] || (hash.startsWith("#/playlist/") ? "playlists" : "");
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
  ["level", "kind", "duration", "year", "channel"].forEach((k) => { if (ui[k]) n++; });
  return n;
}

function hasFilters() {
  return filterCount() > 0;
}

function resetFilters() {
  ui.topics.clear();
  ui.level = ui.kind = ui.duration = ui.year = ui.channel = "";
  ui.sort = "best";
  ui.limit = pageSize();
}

function filtered(scope) {
  const q = normalizeAr(scope.q || "");
  const tokens = q ? q.split(" ") : [];
  return state.videos
    .filter((v) => {
      if (scope.minDuration && v.duration < scope.minDuration) return false;
      if (scope.channel && v.channel_id !== scope.channel) return false;
      if (scope.kind && v.kind !== scope.kind) return false;
      if (tokens.length && !tokens.every((t) => v.search.includes(t))) return false;
      if (ui.topics.size && !v.topics.some((t) => ui.topics.has(t))) return false;
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
    })
    .sort(sorter(ui.sort));
}

function sorter(sort) {
  if (sort === "newest") return (a, b) => b.year - a.year || b.score - a.score;
  if (sort === "views") return (a, b) => b.views - a.views;
  if (sort === "shortest") return (a, b) => a.duration - b.duration;
  if (sort === "longest") return (a, b) => b.duration - a.duration;
  return (a, b) => b.score - a.score;
}

/* ---------- Feed ---------- */

function renderFeed(scope) {
  state.scope = scope;
  if (scope.q !== undefined) $("#q").value = scope.q;
  else if (scope.type !== "search") $("#q").value = "";
  const list = filtered(scope);
  const shown = list.slice(0, ui.limit);
  const title = scope.title || "";
  document.title = title ? `${title} — HackerTube` : "HackerTube";

  view.innerHTML = `<section class="feed">
    <div class="feed-head">
      ${title ? `<h1>${esc(title)}</h1>` : ""}
      <span class="count">${videos(list.length)}</span>
      <button class="btn filter-btn ${hasFilters() ? "on" : ""}" data-filter-toggle aria-expanded="${ui.open}">
        ${icon("filter")} Filters${hasFilters() ? ` <span class="filter-count">${filterCount()}</span>` : ""}
      </button>
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
  const opts = options
    .map(([value, text]) => `<option value="${esc(value)}" ${String(current) === String(value) ? "selected" : ""}>${esc(text)}</option>`)
    .join("");
  return `<label class="filter-field"><span class="filter-label">${esc(label)}</span>
    <select data-f="${name}"><option value="">${esc(allLabel)}</option>${opts}</select></label>`;
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
        <img src="https://i.ytimg.com/vi/${v.id}/hq2.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'">
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

function renderWatch(id) {
  const v = state.byId.get(id);
  if (!v) return renderNotFound();
  state.current = id;
  document.title = `${v.title} — HackerTube`;
  markSeen(id);

  const related = state.videos
    .filter((x) => x.id !== v.id && x.topics.some((t) => v.topics.includes(t)))
    .sort((a, b) => shared(b, v) - shared(a, v) || b.score - a.score)
    .slice(0, 8);

  const liked = state.likes.has(id);
  const later = state.saved.has(id);
  const playlistPanel = state.playlists.length
    ? state.playlists.map((p) => `<button data-add-playlist="${p.id}">${icon("playlists")}<span>${esc(p.name)}</span><span class="side-count">${p.ids.length}</span></button>`).join("")
    : `<p>No playlists yet.</p><a href="#/playlists">Create one first</a>`;

  view.innerHTML = `<section class="watch">
    <div class="player">
      <iframe src="https://www.youtube-nocookie.com/embed/${v.id}?rel=0"
        title="${esc(v.title)}" loading="lazy" allowfullscreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
    <h1 class="watch-title">${esc(v.title)}</h1>
    <div class="watch-meta">
      <a href="#/channel/${v.channel_id}">${esc(v.channel)}</a>
      <span>${compact.format(v.views)} views</span>
      ${v.year ? `<span>${v.year}</span>` : ""}
      <span>${fmtDuration(v.duration)}</span>
      <span>${esc(KIND_LABELS[v.kind] || "Tutorial")}</span>
      <span>${esc(LEVEL_LABELS[v.level] || "General")}</span>
    </div>
    <div class="actions">
      <button class="btn ${liked ? "on" : ""}" data-act="like" aria-pressed="${liked}">${icon("liked")} <span>${liked ? "Liked" : "Like"}</span></button>
      <button class="btn ${later ? "on" : ""}" data-act="save" aria-pressed="${later}">${icon("later")} <span>${later ? "Saved" : "Watch later"}</span></button>
      <details class="drop">
        <summary class="btn">${icon("playlists")} Add to playlist</summary>
        <div class="drop-panel">${playlistPanel}</div>
      </details>
      <a class="btn" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">${icon("external")} YouTube</a>
    </div>
    <h2 class="section-title">Related videos</h2>
    <div class="related-grid">${related.map((x) => card(x)).join("") || '<p class="count">Nothing related yet.</p>'}</div>
  </section>`;
  syncSidebar();
}

function shared(a, b) {
  return a.topics.filter((t) => b.topics.includes(t)).length;
}

function markSeen(id) {
  state.seen = [id, ...state.seen.filter((x) => x !== id)].slice(0, 50);
  storeSet(STORE.seen, state.seen);
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
    toast("Already in this playlist");
    return;
  }
  pl.ids.push(videoId);
  savePlaylists();
  toast(`Added to “${pl.name}”`);
  syncSidebar();
}

function renderPlaylists() {
  document.title = "Playlists — HackerTube";
  view.innerHTML = `<section>
    <div class="feed-head"><h1>Playlists</h1><span class="count">${state.playlists.length} ${state.playlists.length === 1 ? "playlist" : "playlists"}</span></div>
    <form class="create-pl" data-create-playlist>
      <input name="name" placeholder="New playlist name" maxlength="40" required aria-label="New playlist name">
      <button class="btn primary" type="submit">${icon("plus")} Create</button>
    </form>
    ${state.playlists.length
      ? `<div class="pl-grid">${state.playlists.map(playlistCard).join("")}</div>`
      : `<div class="empty"><strong>No playlists yet</strong><p>Create one, then add videos from any watch page.</p></div>`}
  </section>`;
  syncSidebar();
}

function playlistCard(p) {
  const first = p.ids.map((id) => state.byId.get(id)).find(Boolean);
  return `<article class="pl-card">
    <a class="pl-cover" href="#/playlist/${p.id}" aria-label="${esc(p.name)}">
      ${first ? `<img src="https://i.ytimg.com/vi/${first.id}/hq2.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${first.id}/hqdefault.jpg'">` : icon("playlists")}
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
  const seg = [["light", "Light"], ["dark", "Dark"], ["system", "System"]]
    .map(([value, label]) => `<button data-theme-pref="${value}" class="${state.theme === value ? "active" : ""}" aria-pressed="${state.theme === value}">${label}</button>`)
    .join("");
  view.innerHTML = `<section class="settings">
    <h1>Settings</h1>
    <div class="settings-group">
      <h2>Appearance</h2>
      <div class="segmented" role="group" aria-label="Theme">${seg}</div>
    </div>
    <div class="settings-group">
      <h2>Browsing</h2>
      <label class="setting-row">
        <span><b>Hide watched videos</b><small>Keep opened videos out of Home and search.</small></span>
        <input class="switch" type="checkbox" data-setting="hideSeen" ${s.hideSeen ? "checked" : ""}>
      </label>
      <label class="setting-row">
        <span><b>Page size</b><small>Videos shown before “Show more”.</small></span>
        <select data-setting="pageSize">
          ${[24, 36, 60].map((n) => `<option value="${n}" ${Number(s.pageSize) === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="settings-group">
      <h2>Data</h2>
      <div class="setting-row"><span><b>History</b><small>${videos(state.seen.length)}</small></span><button class="btn" data-clear-collection="history" ${state.seen.length ? "" : "disabled"}>Clear</button></div>
      <div class="setting-row"><span><b>Liked</b><small>${videos(state.likes.size)}</small></span><button class="btn" data-clear-collection="liked" ${state.likes.size ? "" : "disabled"}>Clear</button></div>
      <div class="setting-row"><span><b>Watch later</b><small>${videos(state.saved.size)}</small></span><button class="btn" data-clear-collection="later" ${state.saved.size ? "" : "disabled"}>Clear</button></div>
      <div class="setting-row"><span><b>Playlists</b><small>${state.playlists.length} saved</small></span><a class="btn" href="#/playlists">Manage</a></div>
      <div class="setting-row"><span><b>Everything</b><small>Delete likes, history, watch later, playlists and settings.</small></span><button class="btn danger" data-reset-all>Delete all</button></div>
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

  if (e.target.closest("[data-more]")) {
    ui.limit += pageSize();
    renderFeed(state.scope);
    return;
  }

  if (e.target.closest("[data-clear]")) {
    resetFilters();
    renderFeed(state.scope);
    return;
  }

  const add = e.target.closest("[data-add-playlist]");
  if (add) {
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
  if (act) toggleAct(act.dataset.act);
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

  const sel = e.target.closest("select[data-f]");
  if (!sel) return;
  ui[sel.dataset.f] = sel.value;
  ui.limit = pageSize();
  renderFeed(state.scope);
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
  toast(`Created “${name}”`);
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
  toast(on ? (act === "like" ? "Liked" : "Added to Watch later") : "Removed");
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
  toast(on ? "Added to Watch later" : "Removed from Watch later");
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
  toast("Removed");
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
  toast(`Cleared ${label}`);
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
  toast("Playlist deleted");
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
  toast("All data deleted");
}
