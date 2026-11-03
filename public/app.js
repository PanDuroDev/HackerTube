/* واجهة ثابتة بلا أطر عمل: البيانات من public/data، والحالة كلها في المتصفح. */

const KIND_LABELS = { course: "دورة/سلسلة", tutorial: "شرح", project: "مشروع", talk: "محاضرة", short: "قصير" };
const LEVEL_LABELS = { beginner: "مبتدئ", advanced: "متقدم", any: "عام" };
const PAGE = 36;

const state = {
  videos: [],
  meta: null,
  byId: new Map(),
  topicLabels: {},
  channels: new Map(),
  likes: new Set(storeGet("ht_likes", [])),
  saved: new Set(storeGet("ht_saved", [])),
  seen: storeGet("ht_seen", []),
  scope: { type: "all" },
  current: null,
};
const ui = { topics: new Set(), level: "", kind: "", duration: "", year: "", channel: "", sort: "best", limit: PAGE };

const $ = (sel) => document.querySelector(sel);
const view = $("#view");

init();

async function init() {
  setTheme(storeGet("ht_theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#menuBtn").addEventListener("click", () => {
    const open = $("#sidebar").classList.toggle("open");
    $("#menuBtn").setAttribute("aria-expanded", String(open));
  });
  $("#themeBtn").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q").value.trim();
    location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#q").focus();
    }
    if (e.key === "Escape") closeSidebar();
  });
  view.addEventListener("click", onViewClick);
  view.addEventListener("change", onViewChange);

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
    renderSidebar();
    window.addEventListener("hashchange", () => {
      closeSidebar();
      window.scrollTo(0, 0);
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
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storeSet("ht_theme", theme);
  $("#themeBtn").textContent = theme === "dark" ? "☀️" : "🌙";
  $("#themeBtn").setAttribute("aria-label", theme === "dark" ? "المظهر الفاتح" : "المظهر الداكن");
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#menuBtn").setAttribute("aria-expanded", "false");
}

/* ---------- التنقل ---------- */

function render() {
  const hash = location.hash || "#/";
  const path = hash.replace(/^#\/?/, "");
  const [seg, ...rest] = path.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  state.current = null;

  if (!seg || seg === "home") return renderFeed({ type: "all" });
  if (seg === "courses") return renderFeed({ type: "courses", kind: "course", title: "الدورات والسلاسل" });
  if (seg === "search") return renderFeed({ type: "search", q: arg, title: `نتائج البحث عن «${arg}»` });
  if (seg === "channel") {
    const ch = state.channels.get(arg);
    if (!ch) return renderNotFound();
    return renderFeed({ type: "channel", channel: arg, title: ch.name });
  }
  if (seg === "watch") return renderWatch(arg);
  if (seg === "channels") return renderChannels();
  if (seg === "saved") return renderSaved();
  if (seg === "about") return renderAbout();
  return renderNotFound();
}

function renderSidebar() {
  const topics = state.meta.topics
    .map((t) => `<button class="side-link" data-side-topic="${t.id}">${esc(t.label)}<span>${t.count}</span></button>`)
    .join("");
  $("#sidebar").innerHTML = `
    <a class="side-link" data-nav="home" href="#/">الرئيسية</a>
    <a class="side-link" data-nav="courses" href="#/courses">الدورات والسلاسل</a>
    <a class="side-link" data-nav="channels" href="#/channels">القنوات</a>
    <a class="side-link" data-nav="saved" href="#/saved">المحفوظات<span id="savedCount"></span></a>
    <div class="side-title">المواضيع</div>
    ${topics}
    <div class="side-title">عن الموقع</div>
    <a class="side-link" data-nav="about" href="#/about">المنهجية والقيود</a>`;
  $("#sidebar").addEventListener("click", (e) => {
    const topic = e.target.closest("[data-side-topic]");
    if (!topic) return;
    ui.topics = new Set([topic.dataset.sideTopic]);
    ui.limit = PAGE;
    if (location.hash && location.hash !== "#/") location.hash = "#/";
    else renderFeed({ type: "all" });
  });
  syncSidebar();
}

function syncSidebar() {
  const hash = location.hash || "#/";
  document.querySelectorAll(".side-link[data-nav]").forEach((a) => {
    const active = a.getAttribute("href") === hash && !(a.dataset.nav === "home" && ui.topics.size);
    a.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-side-topic]").forEach((b) => {
    b.classList.toggle("active", ui.topics.size === 1 && ui.topics.has(b.dataset.sideTopic));
  });
  const savedCount = $("#savedCount");
  if (savedCount) savedCount.textContent = state.saved.size ? state.saved.size : "";
}

/* ---------- التصفية ---------- */

function hasFilters() {
  return ui.topics.size > 0 || !!(ui.level || ui.kind || ui.duration || ui.year || ui.channel);
}

function resetFilters() {
  ui.topics.clear();
  ui.level = ui.kind = ui.duration = ui.year = ui.channel = "";
  ui.sort = "best";
  ui.limit = PAGE;
}

function filtered(scope) {
  const q = normalizeAr(scope.q || "");
  const tokens = q ? q.split(" ") : [];
  return state.videos
    .filter((v) => {
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
      return true;
    })
    .sort(sorter(ui.sort));
}

function sorter(sort) {
  if (sort === "newest") return (a, b) => b.year - a.year || b.score - a.score;
  if (sort === "views") return (a, b) => b.views - a.views;
  if (sort === "shortest") return (a, b) => a.duration - b.duration;
  return (a, b) => b.score - a.score;
}

/* ---------- العرض ---------- */

function renderFeed(scope) {
  state.scope = scope;
  if (scope.q) $("#q").value = scope.q;
  const list = filtered(scope);
  const shown = list.slice(0, ui.limit);
  const title = scope.title || "مختارات برمجية عربية";
  const isHome = scope.type === "all" && !hasFilters() && !scope.q;
  document.title = `${title} — هاكر تيوب عربي`;

  view.innerHTML = `
    <section class="feed">
      ${isHome ? hero() : ""}
      <div class="feed-head">
        <h1>${esc(title)}</h1>
        <span class="count">${list.length} فيديو</span>
      </div>
      ${filterBar(scope)}
      ${shown.length ? `<div class="grid">${shown.map(card).join("")}</div>` : emptyState()}
      ${list.length > ui.limit ? `<div class="more"><button class="btn" data-more>عرض المزيد (${list.length - ui.limit})</button></div>` : ""}
    </section>`;
  syncSidebar();
}

function hero() {
  const m = state.meta;
  return `<div class="hero">
    <h1>فيديوهات برمجية عربية، بلا ضوضاء</h1>
    <p>فهرس من قنوات عربية مختارة: الزيرو، يحيى تك، ذا نيو بغداد، كودزيلا، وغيرها. صفِّ حسب الموضوع والمستوى والنوع والمدة، وابحث بالعربي حتى لو كتبت الهمزة أو التاء المربوطة مختلفتين.</p>
    <div class="stats">
      <span>${m.total} فيديو</span>
      <span>${m.channels.length} قناة</span>
      <span>${arNum(m.total_hours)} ساعة</span>
      <span>${m.topics.length} موضوع</span>
    </div>
  </div>`;
}

function filterBar(scope) {
  const chips = state.meta.topics
    .map((t) => `<button class="chip ${ui.topics.has(t.id) ? "on" : ""}" data-topic="${t.id}" aria-pressed="${ui.topics.has(t.id)}">${esc(t.label)}</button>`)
    .join("");
  const years = [...new Set(state.videos.map((v) => v.year).filter(Boolean))].sort((a, b) => b - a);
  const selects = [
    !scope.channel ? select("channel", "كل القنوات", state.meta.channels.map((c) => [c.id, c.name]), ui.channel) : "",
    select("level", "كل المستويات", [["beginner", "مبتدئ"], ["advanced", "متقدم"]], ui.level),
    scope.kind ? "" : select("kind", "كل الأنواع", Object.entries(KIND_LABELS), ui.kind),
    select("duration", "أي مدة", [["short", "أقل من 5 د"], ["mid", "5–20 د"], ["long", "20–60 د"], ["xl", "أكثر من ساعة"]], ui.duration),
    select("year", "كل السنوات", years.map((y) => [y, String(y)]), ui.year),
    select("sort", "الترتيب: الأفضل", [["newest", "الأحدث"], ["views", "الأكثر مشاهدة"], ["shortest", "الأقصر أولًا"]], ui.sort),
  ].join("");
  return `<div class="filters">
    <div class="chips">${chips}</div>
    <div class="selects">${selects}${hasFilters() ? '<button class="clear-filters" data-clear>مسح الفلاتر</button>' : ""}</div>
  </div>`;
}

function select(field, allLabel, options, current) {
  const opts = options
    .map(([value, label]) => `<option value="${esc(value)}" ${String(current) === String(value) ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
  return `<select data-f="${field}" aria-label="${esc(allLabel)}"><option value="">${esc(allLabel)}</option>${opts}</select>`;
}

function card(v) {
  const tags = v.topics
    .slice(0, 2)
    .map((t) => `<button class="tag" data-topic="${t}">${esc(state.topicLabels[t] || t)}</button>`)
    .join("");
  return `<article class="card">
    <a class="thumb" href="#/watch/${v.id}" tabindex="-1" aria-hidden="true">
      <img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">
      <span class="dur">${fmtDuration(v.duration)}</span>
    </a>
    <div class="card-body">
      <a class="card-title" href="#/watch/${v.id}">${esc(v.title)}</a>
      <a class="card-ch" href="#/channel/${v.channel_id}">${esc(v.channel)}</a>
      <div class="card-meta">${arNum(v.views)} مشاهدة${v.year ? ` · ${v.year}` : ""}</div>
      <div class="tags">${tags}</div>
    </div>
  </article>`;
}

function emptyState() {
  return `<div class="empty">
    <strong>لا توجد نتائج مطابقة</strong>
    <p>جرّب موضوعًا آخر أو قلّل الفلاتر.</p>
    ${hasFilters() ? '<button class="btn" data-clear>مسح الفلاتر</button>' : ""}
  </div>`;
}

/* ---------- صفحة المشاهدة ---------- */

function renderWatch(id) {
  const v = state.byId.get(id);
  if (!v) return renderNotFound();
  state.current = id;
  document.title = `${v.title} — هاكر تيوب عربي`;
  markSeen(id);

  const topics = v.topics.map((t) => state.topicLabels[t] || t).join("، ");
  const related = state.videos
    .filter((x) => x.id !== v.id && x.topics.some((t) => v.topics.includes(t)))
    .sort((a, b) => shared(b, v) - shared(a, v) || b.score - a.score)
    .slice(0, 8);

  const labelFor = (set, key, onText, offText) =>
    `<button class="btn ${set.has(id) ? "on" : ""}" data-act="${key}" aria-pressed="${set.has(id)}">${set.has(id) ? onText : offText}</button>`;

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
      ${labelFor(state.likes, "like", "👍 أعجبني", "👍 أعجبني")}
      ${labelFor(state.saved, "save", "🔖 محفوظ", "🔖 حفظ")}
      <a class="btn" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">فتح على يوتيوب ↗</a>
    </div>
    <p class="note">صُنّف هذا الفيديو ضمن <b>${esc(topics)}</b> من قناة <a href="#/channel/${v.channel_id}">${esc(v.channel)}</a>.
      الموقع لا يستضيف الفيديو ولا يتبع يوتيوب؛ التشغيل من youtube-nocookie.
      <a href="#/about">كيف نختار المحتوى؟</a></p>
    <h2 class="section-title">فيديوهات مشابهة</h2>
    <div class="related-grid">${related.map(card).join("") || '<p class="count">لا توجد فيديوهات مشابهة بعد.</p>'}</div>
  </section>`;
  syncSidebar();
}

function shared(a, b) {
  return a.topics.filter((t) => b.topics.includes(t)).length;
}

function markSeen(id) {
  state.seen = [id, ...state.seen.filter((x) => x !== id)].slice(0, 50);
  storeSet("ht_seen", state.seen);
}

/* ---------- صفحات أخرى ---------- */

function renderChannels() {
  document.title = "القنوات — هاكر تيوب عربي";
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

function renderSaved() {
  document.title = "المحفوظات — هاكر تيوب عربي";
  const list = state.videos.filter((v) => state.saved.has(v.id));
  view.innerHTML = `<section>
    <div class="feed-head"><h1>المحفوظات</h1><span class="count">${list.length} فيديو</span></div>
    ${list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<div class="empty"><strong>لم تحفظ شيئًا بعد</strong><p>اضغط «حفظ» في أي صفحة مشاهدة.</p><a class="btn" href="#/">تصفح الفيديوهات</a></div>`}
  </section>`;
  syncSidebar();
}

function renderAbout() {
  document.title = "المنهجية — هاكر تيوب عربي";
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
  document.title = "غير موجود — هاكر تيوب عربي";
  view.innerHTML = `<div class="empty"><strong>الصفحة غير موجودة</strong><p>قد يكون الفيديو أو القناة خارج الفهرس.</p><a class="btn" href="#/">العودة للرئيسية</a></div>`;
  syncSidebar();
}

/* ---------- الأحداث ---------- */

function onViewClick(e) {
  const topic = e.target.closest("[data-topic]");
  if (topic) {
    const id = topic.dataset.topic;
    if (ui.topics.has(id)) ui.topics.delete(id);
    else ui.topics.add(id);
    ui.limit = PAGE;
    renderFeed(state.scope);
    return;
  }
  if (e.target.closest("[data-more]")) {
    ui.limit += PAGE;
    renderFeed(state.scope);
    return;
  }
  if (e.target.closest("[data-clear]")) {
    resetFilters();
    renderFeed(state.scope);
    return;
  }
  const act = e.target.closest("[data-act]");
  if (act) toggleAct(act.dataset.act);
}

function onViewChange(e) {
  const sel = e.target.closest("select[data-f]");
  if (!sel) return;
  ui[sel.dataset.f] = sel.value;
  ui.limit = PAGE;
  renderFeed(state.scope);
}

function toggleAct(act) {
  const id = state.current;
  if (!id) return;
  const set = act === "like" ? state.likes : state.saved;
  const on = !set.has(id);
  if (on) set.add(id);
  else set.delete(id);
  storeSet(act === "like" ? "ht_likes" : "ht_saved", [...set]);
  document.querySelectorAll(`[data-act="${act}"]`).forEach((b) => {
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  if (act === "save") {
    const b = document.querySelector('[data-act="save"]');
    if (b) b.textContent = on ? "🔖 محفوظ" : "🔖 حفظ";
  }
  toast(on ? (act === "like" ? "تم الإعجاب" : "حُفظ في المحفوظات") : "أُزيل");
  syncSidebar();
}
