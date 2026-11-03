/* واجهة ثابتة بلا أطر عمل: البيانات من public/data، والحالة كلها في المتصفح. */

const KIND_LABELS = { course: "دورة/سلسلة", tutorial: "شرح", project: "مشروع", talk: "محاضرة", short: "قصير" };
const LEVEL_LABELS = { beginner: "مبتدئ", advanced: "متقدم", any: "عام" };
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
const ui = { topics: new Set(), level: "", kind: "", duration: "", year: "", channel: "", sort: "best", limit: pageSize() };
let pendingTopic = null;

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

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
    state.topicLabels = Object.fromEntries(meta.topics.map((t) => [t.id, t.label]));
    state.longCount = videos.filter((v) => v.duration >= 1200).length;
    renderSidebar();
    addEventListener("hashchange", () => {
      setSidebar(false);
      scrollTo(0, 0);
      render();
    });
    render();
  } catch (err) {
    view.innerHTML = `<div class="error"><strong>تعذّر تحميل البيانات.</strong>
      <p>شغّل الموقع عبر سيرفر محلي: <code dir="ltr">python -m http.server 8080 -d public</code></p>
      <p dir="ltr">${esc(err.message)}</p></div>`;
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

/* ---------- التطبيع والبحث ---------- */

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

/* ---------- التنسيق ---------- */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function arNum(n) {
  if (!n) return "0";
  const fmt = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();
  if (n >= 1e9) return fmt(n / 1e9) + " مليار";
  if (n >= 1e6) return fmt(n / 1e6) + " مليون";
  if (n >= 1e3) return fmt(n / 1e3) + " ألف";
  return String(n);
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
  btn.setAttribute("aria-label", dark ? "المظهر الفاتح" : "المظهر الداكن");
}

function setSidebar(open) {
  if (open) document.body.classList.remove("side-collapsed");
  $("#sidebar").classList.toggle("open", open);
  $("#scrim").hidden = !open;
  $("#menuBtn").setAttribute("aria-expanded", String(open));
}

/* ---------- التنقل ---------- */

function render() {
  const hash = location.hash || "#/";
  const path = hash.replace(/^#\/?/, "");
  const [seg, ...rest] = path.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  state.current = null;

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
    return renderFeed({ type: "longs", title: "فيديوهات طويلة", minDuration: 1200 });
  }
  if (seg === "courses") {
    resetFilters();
    return renderFeed({ type: "courses", kind: "course", title: "الدورات والسلاسل" });
  }
  if (seg === "search") {
    resetFilters();
    return renderFeed({ type: "search", q: arg, title: `نتائج البحث عن «${arg}»` });
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
  if (seg === "about") return renderAbout();
  return renderNotFound();
}

function renderSidebar() {
  const nav = [
    ["home", "#/", "home", "الرئيسية"],
    ["longs", "#/longs", "longs", "فيديوهات طويلة"],
    ["liked", "#/liked", "liked", "أعجبني"],
    ["history", "#/history", "history", "السجل"],
    ["later", "#/later", "later", "المشاهدة لاحقًا"],
    ["categories", "#/categories", "categories", "التصنيفات"],
    ["playlists", "#/playlists", "playlists", "قوائم التشغيل"],
    ["settings", "#/settings", "settings", "الإعدادات"],
  ];
  $("#sidebar").innerHTML = `
    <nav class="side-nav">
      ${nav.map(([key, href, ic, label]) => `<a class="side-link" data-nav="${key}" href="${href}">${icon(ic)}<span>${label}</span><span class="side-count" data-count="${key}"></span></a>`).join("")}
    </nav>
    <div class="side-title">استكشف</div>
    <a class="side-link" data-nav="channels" href="#/channels">${icon("channels")}<span>القنوات</span><span class="side-count" data-count="channels"></span></a>
    <a class="side-link" data-nav="about" href="#/about">${icon("about")}<span>عن الموقع</span></a>
    <p class="side-foot">${state.meta.total} فيديو من ${state.meta.channels.length} قناة.<br>بيانات ثابتة، بلا حسابات ولا تتبع.</p>`;
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
    "#/channels": "channels", "#/about": "about",
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

/* ---------- التصفية ---------- */

function hasFilters() {
  return ui.topics.size > 0 || !!(ui.level || ui.kind || ui.duration || ui.year || ui.channel);
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

/* ---------- العرض ---------- */

function renderFeed(scope) {
  state.scope = scope;
  if (scope.q !== undefined) $("#q").value = scope.q;
  else if (scope.type !== "search") $("#q").value = "";
  const list = filtered(scope);
  const shown = list.slice(0, ui.limit);
  const title = scope.title || "مختارات برمجية عربية";
  const isHome = scope.type === "all" && !hasFilters() && !scope.q;
  document.title = `${title} — هاكرتيوب عربي`;

  view.innerHTML = `<section class="feed">
    ${isHome ? homeHead() : ""}
    ${chipbar()}
    ${isHome ? "" : `<div class="feed-head"><h1>${esc(title)}</h1><span class="count">${list.length} فيديو</span></div>`}
    ${toolbar(scope)}
    ${shown.length ? `<div class="grid">${shown.map((v) => card(v)).join("")}</div>` : emptyState()}
    ${list.length > ui.limit ? `<div class="more"><button class="btn" data-more>عرض المزيد (${list.length - ui.limit})</button></div>` : ""}
  </section>`;
  syncSidebar();
}

function homeHead() {
  const m = state.meta;
  return `<div class="home-head">
    <h1>فيديوهات برمجية عربية، بلا ضوضاء.</h1>
    <p>فهرس من قنوات عربية مختارة: الزيرو، يحيى تك، ذا نيو بغداد، كودزيلا وغيرها. صفِّ حسب الموضوع والمستوى والمدة، وابحث بالعربي حتى لو اختلفت الهمزة أو التاء المربوطة.</p>
    <div class="home-stats">
      <span><b>${m.total}</b> فيديو</span>
      <span><b>${m.channels.length}</b> قناة</span>
      <span><b>${arNum(m.total_hours)}</b> ساعة</span>
      <span><b>${m.topics.length}</b> موضوع</span>
    </div>
  </div>`;
}

function chipbar() {
  const chips = state.meta.topics
    .map((t) => `<button class="chip ${ui.topics.has(t.id) ? "on" : ""}" data-topic="${t.id}" aria-pressed="${ui.topics.has(t.id)}">${esc(t.label)}</button>`)
    .join("");
  return `<div class="chipbar">
    <button class="chip ${ui.topics.size ? "" : "on"}" data-topic="" aria-pressed="${!ui.topics.size}">الكل</button>
    ${chips}
  </div>`;
}

function toolbar(scope) {
  const years = [...new Set(state.videos.map((v) => v.year).filter(Boolean))].sort((a, b) => b - a);
  const selects = [
    !scope.channel ? select("channel", "كل القنوات", state.meta.channels.map((c) => [c.id, c.name]), ui.channel) : "",
    select("level", "كل المستويات", [["beginner", "مبتدئ"], ["advanced", "متقدم"], ["any", "عام"]], ui.level),
    scope.kind ? "" : select("kind", "كل الأنواع", Object.entries(KIND_LABELS), ui.kind),
    select("duration", "أي مدة", [["short", "أقل من 5 د"], ["mid", "5–20 د"], ["long", "20–60 د"], ["xl", "أكثر من ساعة"]], ui.duration),
    select("year", "كل السنوات", years.map((y) => [y, String(y)]), ui.year),
    select("sort", "الترتيب: الأفضل", [["newest", "الأحدث"], ["views", "الأكثر مشاهدة"], ["longest", "الأطول أولًا"], ["shortest", "الأقصر أولًا"]], ui.sort),
  ].join("");
  return `<div class="toolbar">${selects}${hasFilters() ? '<button class="clear-filters" data-clear>مسح الفلاتر</button>' : ""}</div>`;
}

function select(field, allLabel, options, current) {
  const opts = options
    .map(([value, label]) => `<option value="${esc(value)}" ${String(current) === String(value) ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
  return `<select data-f="${field}" aria-label="${esc(allLabel)}"><option value="">${esc(allLabel)}</option>${opts}</select>`;
}

function card(v, opts = {}) {
  const later = state.saved.has(v.id);
  const remove = opts.remove
    ? `<button class="card-x" data-remove="${opts.remove}" data-id="${v.id}"${opts.playlist ? ` data-pl="${opts.playlist}"` : ""} aria-label="إزالة">${icon("close")}</button>`
    : "";
  const topic = v.topics[0] ? ` · ${esc(state.topicLabels[v.topics[0]] || v.topics[0])}` : "";
  return `<article class="card">
    <div class="thumb">
      <a class="thumb-link" href="#/watch/${v.id}" aria-label="${esc(v.title)}">
        <img src="https://i.ytimg.com/vi/${v.id}/hq2.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'">
      </a>
      <button class="later-btn ${later ? "on" : ""}" data-later-toggle="${v.id}" aria-pressed="${later}" aria-label="${later ? "إزالة من المشاهدة لاحقًا" : "إضافة إلى المشاهدة لاحقًا"}" title="المشاهدة لاحقًا">${icon("later")}</button>
      ${remove}
      <span class="dur">${fmtDuration(v.duration)}</span>
    </div>
    <div class="card-info">
      <a class="card-title" href="#/watch/${v.id}">${esc(v.title)}</a>
      <a class="card-sub" href="#/channel/${v.channel_id}">${esc(v.channel)}</a>
      <div class="card-sub">${arNum(v.views)} مشاهدة${v.year ? ` · ${v.year}` : ""}${topic}</div>
    </div>
  </article>`;
}

function emptyState() {
  return `<div class="empty">
    <strong>لا توجد نتائج مطابقة</strong>
    <p>جرّب موضوعًا آخر أو قلّل الفلاتر.</p>
    ${hasFilters() ? '<button class="btn" data-clear>مسح الفلاتر</button>' : state.settings.hideSeen ? '<a class="btn" href="#/settings">إعداد إخفاء المشاهد</a>' : '<a class="btn" href="#/categories">تصفح التصنيفات</a>'}
  </div>`;
}

/* ---------- المشاهدة ---------- */

function renderWatch(id) {
  const v = state.byId.get(id);
  if (!v) return renderNotFound();
  state.current = id;
  document.title = `${v.title} — هاكرتيوب عربي`;
  markSeen(id);

  const related = state.videos
    .filter((x) => x.id !== v.id && x.topics.some((t) => v.topics.includes(t)))
    .sort((a, b) => shared(b, v) - shared(a, v) || b.score - a.score)
    .slice(0, 8);

  const liked = state.likes.has(id);
  const later = state.saved.has(id);
  const playlistPanel = state.playlists.length
    ? state.playlists.map((p) => `<button data-add-playlist="${p.id}">${icon("playlists")}<span>${esc(p.name)}</span><span class="side-count">${p.ids.length}</span></button>`).join("")
    : `<p>لا توجد قوائم تشغيل بعد.</p><a href="#/playlists">أنشئ قائمة أولًا</a>`;

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
      <span>${arNum(v.views)} مشاهدة</span>
      ${v.year ? `<span>${v.year}</span>` : ""}
      <span>${fmtDuration(v.duration)}</span>
      <span>${esc(KIND_LABELS[v.kind] || "شرح")}</span>
      <span>${esc(LEVEL_LABELS[v.level] || "عام")}</span>
    </div>
    <div class="actions">
      <button class="btn ${liked ? "on" : ""}" data-act="like" aria-pressed="${liked}">${icon("liked")} <span>${liked ? "في المفضلة" : "إعجاب"}</span></button>
      <button class="btn ${later ? "on" : ""}" data-act="save" aria-pressed="${later}">${icon("later")} <span>${later ? "في المشاهدة لاحقًا" : "المشاهدة لاحقًا"}</span></button>
      <details class="drop">
        <summary class="btn">${icon("playlists")} أضف إلى قائمة</summary>
        <div class="drop-panel">${playlistPanel}</div>
      </details>
      <a class="btn" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">${icon("external")} يوتيوب</a>
    </div>
    <p class="note">صُنّف هذا الفيديو ضمن <b>${esc(v.topics.map((t) => state.topicLabels[t] || t).join("، "))}</b> من قناة <a href="#/channel/${v.channel_id}">${esc(v.channel)}</a>.
      الموقع لا يستضيف الفيديو؛ التشغيل من youtube-nocookie. <a href="#/about">كيف نختار المحتوى؟</a></p>
    <h2 class="section-title">فيديوهات مشابهة</h2>
    <div class="related-grid">${related.map((x) => card(x)).join("") || '<p class="count">لا توجد فيديوهات مشابهة بعد.</p>'}</div>
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

/* ---------- المجموعات ---------- */

const COLLECTIONS = {
  liked: { title: "أعجبني", set: () => state.likes, empty: "لم تعجب بفيديو بعد.", hint: "اضغط «إعجاب» في صفحة أي فيديو ليظهر هنا." },
  later: { title: "المشاهدة لاحقًا", set: () => state.saved, empty: "قائمة المشاهدة لاحقًا فارغة.", hint: "اضغط أيقونة الساعة على أي فيديو، أو زر «المشاهدة لاحقًا» في صفحة المشاهدة." },
  history: { title: "سجل المشاهدة", set: null, empty: "لم تشاهد أي فيديو بعد.", hint: "افتح أي فيديو وسيظهر هنا. نحتفظ بآخر 50 فيديو فقط، في متصفحك." },
};

function renderCollection(kind) {
  const cfg = COLLECTIONS[kind];
  const list = kind === "history"
    ? state.seen.map((id) => state.byId.get(id)).filter(Boolean)
    : state.videos.filter((v) => cfg.set().has(v.id));
  document.title = `${cfg.title} — هاكرتيوب عربي`;
  const clear = list.length ? `<button class="btn" data-clear-collection="${kind}">${icon("trash")} مسح الكل</button>` : "";
  view.innerHTML = `<section>
    <div class="feed-head"><h1>${cfg.title}</h1><span class="count">${list.length} فيديو</span></div>
    ${clear ? `<div class="head-tools">${clear}</div>` : ""}
    ${list.length
      ? `<div class="grid">${list.map((v) => card(v, { remove: kind })).join("")}</div>`
      : `<div class="empty"><strong>${cfg.empty}</strong><p>${cfg.hint}</p><a class="btn" href="#/">تصفح الفيديوهات</a></div>`}
  </section>`;
  syncSidebar();
}

/* ---------- التصنيفات ---------- */

function renderCategories() {
  document.title = "التصنيفات — هاكرتيوب عربي";
  const topics = [...state.meta.topics].sort((a, b) => b.count - a.count);
  view.innerHTML = `<section>
    <div class="feed-head"><h1>التصنيفات</h1><span class="count">${topics.length} موضوع</span></div>
    <div class="topic-grid">
      ${topics.map((t) => `<a class="topic-card" href="#/" data-goto-topic="${t.id}">
        <span class="topic-name">${esc(t.label)}</span>
        <span class="topic-num">${t.count}</span>
        ${icon("arrowLeft")}
      </a>`).join("")}
    </div>
  </section>`;
  syncSidebar();
}

/* ---------- قوائم التشغيل ---------- */

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
    toast("الفيديو موجود في هذه القائمة");
    return;
  }
  pl.ids.push(videoId);
  savePlaylists();
  toast(`أُضيف إلى «${pl.name}»`);
  syncSidebar();
}

function renderPlaylists() {
  document.title = "قوائم التشغيل — هاكرتيوب عربي";
  view.innerHTML = `<section>
    <div class="feed-head"><h1>قوائم التشغيل</h1><span class="count">${state.playlists.length} قائمة</span></div>
    <form class="create-pl" data-create-playlist>
      <input name="name" placeholder="اسم قائمة جديدة" maxlength="40" required aria-label="اسم قائمة جديدة">
      <button class="btn primary" type="submit">${icon("plus")} إنشاء</button>
    </form>
    ${state.playlists.length
      ? `<div class="pl-grid">${state.playlists.map(playlistCard).join("")}</div>`
      : `<div class="empty"><strong>لا توجد قوائم بعد</strong><p>أنشئ قائمة، ثم أضف إليها فيديوهات من صفحة المشاهدة.</p></div>`}
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
      <div><a href="#/playlist/${p.id}">${esc(p.name)}</a><small>${p.ids.length ? `${p.ids.length} فيديو` : "قائمة فارغة"}</small></div>
      <button class="icon-btn" data-delete-playlist="${p.id}" aria-label="حذف القائمة">${icon("trash")}</button>
    </div>
  </article>`;
}

function renderPlaylist(id) {
  const pl = playlistById(id);
  if (!pl) return renderNotFound();
  const videos = pl.ids.map((vid) => state.byId.get(vid)).filter(Boolean);
  document.title = `${pl.name} — هاكرتيوب عربي`;
  view.innerHTML = `<section>
    <div class="feed-head"><h1>${esc(pl.name)}</h1><span class="count">${videos.length} فيديو</span></div>
    <div class="pl-head">
      ${videos.length ? `<a class="btn primary" href="#/watch/${videos[0].id}">${icon("play")} تشغيل</a>` : ""}
      <button class="btn danger" data-delete-playlist="${pl.id}">${icon("trash")} حذف القائمة</button>
    </div>
    ${videos.length
      ? `<div class="grid">${videos.map((v) => card(v, { remove: "playlist", playlist: pl.id })).join("")}</div>`
      : `<div class="empty"><strong>القائمة فارغة</strong><p>أضف فيديوهات من صفحة المشاهدة عبر «أضف إلى قائمة».</p><a class="btn" href="#/">تصفح الفيديوهات</a></div>`}
  </section>`;
  syncSidebar();
}

/* ---------- الإعدادات ---------- */

function renderSettings() {
  document.title = "الإعدادات — هاكرتيوب عربي";
  const s = state.settings;
  const seg = [["light", "فاتح"], ["dark", "داكن"], ["system", "النظام"]]
    .map(([value, label]) => `<button data-theme-pref="${value}" class="${state.theme === value ? "active" : ""}" aria-pressed="${state.theme === value}">${label}</button>`)
    .join("");
  view.innerHTML = `<section class="settings">
    <h1>الإعدادات</h1>
    <div class="settings-group">
      <h2>المظهر</h2>
      <div class="segmented" role="group" aria-label="المظهر">${seg}</div>
    </div>
    <div class="settings-group">
      <h2>التجربة</h2>
      <label class="setting-row">
        <span><b>إخفاء الفيديوهات المشاهدة</b><small>لا تظهر الفيديوهات التي فتحتها في الرئيسية والبحث.</small></span>
        <input class="switch" type="checkbox" data-setting="hideSeen" ${s.hideSeen ? "checked" : ""}>
      </label>
      <label class="setting-row">
        <span><b>حجم الصفحة</b><small>عدد الفيديوهات قبل زر «عرض المزيد».</small></span>
        <select data-setting="pageSize">
          ${[24, 36, 60].map((n) => `<option value="${n}" ${Number(s.pageSize) === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="settings-group">
      <h2>بياناتك</h2>
      <div class="setting-row"><span><b>سجل المشاهدة</b><small>${state.seen.length} فيديو</small></span><button class="btn" data-clear-collection="history" ${state.seen.length ? "" : "disabled"}>مسح</button></div>
      <div class="setting-row"><span><b>الإعجابات</b><small>${state.likes.size} فيديو</small></span><button class="btn" data-clear-collection="liked" ${state.likes.size ? "" : "disabled"}>مسح</button></div>
      <div class="setting-row"><span><b>المشاهدة لاحقًا</b><small>${state.saved.size} فيديو</small></span><button class="btn" data-clear-collection="later" ${state.saved.size ? "" : "disabled"}>مسح</button></div>
      <div class="setting-row"><span><b>قوائم التشغيل</b><small>${state.playlists.length} قائمة</small></span><a class="btn" href="#/playlists">إدارة</a></div>
      <div class="setting-row"><span><b>كل البيانات</b><small>حذف الإعجابات والسجل والمشاهدة لاحقًا والقوائم والإعدادات.</small></span><button class="btn danger" data-reset-all>حذف الكل</button></div>
    </div>
    <p class="settings-note">كل شيء يعمل محليًا في متصفحك؛ لا حسابات ولا خادم. الموقع مستوحى من <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a> ومحتواه من قنوات برمجية عربية مختارة.</p>
  </section>`;
  syncSidebar();
}

/* ---------- القنوات وعن الموقع ---------- */

function renderChannels() {
  document.title = "القنوات — هاكرتيوب عربي";
  const cards = state.meta.channels
    .map((c) => `<a class="channel-card" href="#/channel/${c.id}">
      <span class="avatar">${esc(c.name.trim().charAt(0))}</span>
      <span><b>${esc(c.name)}</b><small>${c.count} فيديو في الفهرس</small></span>
    </a>`)
    .join("");
  view.innerHTML = `<section>
    <div class="feed-head"><h1>القنوات</h1><span class="count">${state.meta.channels.length} قناة</span></div>
    <div class="channel-grid">${cards}</div>
  </section>`;
  syncSidebar();
}

function renderAbout() {
  document.title = "المنهجية — هاكرتيوب عربي";
  view.innerHTML = `<section class="about">
    <h1>كيف يعمل الموقع؟</h1>
    <p>فهرس لفيديوهات برمجية عربية من قنوات مختارة، بفلترة وبحث محليين. لا حسابات، ولا تتبع، ولا خادم تطبيق: ملفات ثابتة تحمّلها في متصفحك.</p>
    <h2>كيف نختار المحتوى؟</h2>
    <ul>
      <li>قائمة قنوات عربية ثابتة في <code>pipeline/config.py</code> (الزيرو، يحيى تك، ذا نيو بغداد، كودزيلا، وغيرها).</li>
      <li>نجلب أحدث 300 فيديو لكل قناة عبر yt-dlp: العنوان والمدة والمشاهدات وتاريخ تقريبي.</li>
      <li>نستبعد القصير جدًا (&lt; دقيقة) وما لا يطابق موضوعًا برمجيًا في العنوان.</li>
      <li>نصنّف الموضوع والمستوى والنوع بقواعد كلمات مفتاحية عربية وإنجليزية، ثم نرتّب بدرجة تجمع المشاهدات والحداثة ونوع المحتوى.</li>
    </ul>
    <h2>ما المختلف عن HackerTube؟</h2>
    <p>HackerTube يبني فهرسه من توصيات Hacker News بالإنجليزية. هنا المحتوى عربي برمجي، والتركيز على التصفية: موضوع، مستوى، نوع، مدة، سنة، قناة، وبحث يطبّع الهمزات (أ/إ/آ ← ا) والتاء المربوطة (ة ← ه) والألف المقصورة (ى ← ي) والتشكيل، فتجد «برمجه» عند البحث عن «برمجة».</p>
    <h2>ما الذي تضيفه الصفحات؟</h2>
    <ul>
      <li><b>فيديوهات طويلة:</b> كل ما يتجاوز 20 دقيقة، للدورات والجلسات الطويلة.</li>
      <li><b>أعجبني والسجل والمشاهدة لاحقًا:</b> تُحفظ في متصفحك، ويمكن مسحها من الإعدادات.</li>
      <li><b>التصنيفات:</b> 20 موضوعًا مع عدد الفيديوهات في كل موضوع.</li>
      <li><b>قوائم التشغيل:</b> أنشئ قوائمك وأضف إليها من صفحة المشاهدة.</li>
    </ul>
    <h2>القيود</h2>
    <ul>
      <li>التصنيف من العنوان فقط، بلا وصف أو نموذج لغوي؛ لذلك قد تفوت بعض الفيديوهات أو تُصنّف بحلقة من سلسلة حسب موضوع قناتها الغالب.</li>
      <li>أحدث 300 فيديو لكل قناة فقط، لا كل أرشيفها.</li>
      <li>تاريخ النشر تقريبي، وقد يكون سنة فقط.</li>
      <li>الحقوق لأصحاب القنوات على يوتيوب؛ المشروع للفهرسة ولا يستضيف الفيديو.</li>
    </ul>
  </section>`;
  syncSidebar();
}

function renderNotFound() {
  document.title = "غير موجود — هاكرتيوب عربي";
  view.innerHTML = `<div class="empty"><strong>الصفحة غير موجودة</strong><p>قد يكون الفيديو أو القناة خارج الفهرس.</p><a class="btn" href="#/">العودة للرئيسية</a></div>`;
  syncSidebar();
}

/* ---------- الأحداث ---------- */

function onViewClick(e) {
  const goto = e.target.closest("[data-goto-topic]");
  if (goto) {
    pendingTopic = goto.dataset.gotoTopic;
    if (/^#\/(home)?$/.test(location.hash || "#/")) render();
    else location.hash = "#/";
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
    toast("حُفظ الإعداد");
    if (key === "hideSeen" || key === "pageSize") {
      if (/^#\/($|longs|search\/|channel\/|courses)/.test(location.hash || "#/")) renderFeed(state.scope);
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
  toast(`أُنشئت قائمة «${name}»`);
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
    const label = act === "like" ? (on ? "في المفضلة" : "إعجاب") : (on ? "في المشاهدة لاحقًا" : "المشاهدة لاحقًا");
    b.innerHTML = `${icon(act === "like" ? "liked" : "later")} <span>${label}</span>`;
  });
  toast(on ? (act === "like" ? "تم الإعجاب" : "أُضيف إلى المشاهدة لاحقًا") : "أُزيل");
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
    b.setAttribute("aria-label", on ? "إزالة من المشاهدة لاحقًا" : "إضافة إلى المشاهدة لاحقًا");
  });
  syncSidebar();
  toast(on ? "أُضيف إلى المشاهدة لاحقًا" : "أُزيل من المشاهدة لاحقًا");
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
  toast("أُزيل");
}

function clearCollection(kind) {
  const label = kind === "history" ? "سجل المشاهدة" : kind === "liked" ? "الإعجابات" : "المشاهدة لاحقًا";
  if (!confirm(`مسح ${label}؟ لا يمكن التراجع.`)) return;
  if (kind === "history") state.seen = [];
  else if (kind === "liked") state.likes.clear();
  else state.saved.clear();
  storeSet(STORE.seen, state.seen);
  storeSet(STORE.likes, [...state.likes]);
  storeSet(STORE.later, [...state.saved]);
  syncSidebar();
  render();
  toast(`تم مسح ${label}`);
}

function deletePlaylist(id) {
  const pl = playlistById(id);
  if (!pl) return;
  if (!confirm(`حذف قائمة «${pl.name}»؟`)) return;
  state.playlists = state.playlists.filter((p) => p.id !== id);
  savePlaylists();
  syncSidebar();
  if ((location.hash || "#/").startsWith("#/playlist/")) location.hash = "#/playlists";
  else render();
  toast("حُذفت القائمة");
}

function resetAll() {
  if (!confirm("حذف كل بياناتك المحلية: الإعجابات، السجل، المشاهدة لاحقًا، القوائم والإعدادات؟")) return;
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
  toast("أُعيد ضبط كل البيانات");
}
