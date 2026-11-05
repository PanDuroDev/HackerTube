"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const i18n = require("../public/i18n.js");

const en = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "i18n", "en.json"), "utf8"));
const ar = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "i18n", "ar.json"), "utf8"));

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? flatten(child, next) : [next];
  });
}

test("Arabic and English dictionaries share the required keys", () => {
  const enKeys = new Set(flatten(en));
  const arKeys = new Set(flatten(ar));
  for (const key of enKeys) assert.ok(arKeys.has(key), `missing Arabic key: ${key}`);
  for (const key of [
    "app.title", "header.language", "nav.home", "nav.hackerNews",
    "filters.button", "filters.forYou", "settings.browsing", "settings.autoplayNext", "settings.language",
    "header.update", "header.updateTo", "settings.version", "settings.checkUpdates", "settings.updateWebReady", "settings.updateFailed",
    "settings.playback", "settings.customPlayer", "settings.customPlayerNote",
    "dialogs.customPlayerTitle", "dialogs.customPlayerMessage", "dialogs.customPlayerEnable",
    "player.play", "player.pause", "player.back10", "player.forward10", "player.fullscreen",
    "player.settings", "player.tabSpeed", "player.speed", "player.quality", "player.captions", "player.off", "player.auto", "player.original", "player.translateTo", "player.searchLanguages", "player.nativeFallback", "player.optionUnavailable", "player.noResults", "player.qualityLoading", "player.captionsHint", "player.noCaptions",
    "watch.like", "watch.share", "watch.resumeAt", "watch.comments", "watch.relatedPicks",
    "watch.continueWatching", "collections.likedEmpty", "collections.historyHint", "collections.browseVideos",
    "playlists.create", "playlists.fromCreators", "playlists.emptyHint", "playlists.playAll", "playlists.delete",
    "toasts.feedRefreshed", "toasts.languageLoadFailed", "watch.addedToWatchLater", "watch.removedFromWatchLater", "skeleton.loading",
    "hn.scope", "hn.contentTypes.comedy", "topics.web", "languages.ar",
    "counts.videos.other",
  ]) {
    assert.ok(enKeys.has(key), `missing required key: ${key}`);
  }
});

test("t() translates, interpolates, and falls back to English", () => {
  i18n.setMessages("ar", ar, en);
  assert.equal(i18n.t("nav.home"), "الرئيسية");
  assert.equal(i18n.t("pages.searchResults", { query: "react" }), "نتائج البحث عن «react»");
  assert.equal(i18n.t("filters.button"), "الفلاتر");
  assert.equal(i18n.t("filters.forYou"), "مخصص لك");
  assert.equal(i18n.t("settings.browsing"), "التصفح");
  assert.equal(i18n.t("settings.playback"), "التشغيل");
  assert.equal(i18n.t("player.play"), "تشغيل");
  assert.equal(i18n.t("dialogs.customPlayerTitle"), "تفعيل أدوات التحكم المخصصة؟");
  assert.equal(i18n.t("hn.scope"), "النطاق");
  assert.equal(i18n.t("topics.web"), "تطوير الويب");
  assert.equal(i18n.t("watch.like"), "إعجاب");
  assert.equal(i18n.t("watch.share"), "مشاركة");
  assert.equal(i18n.t("watch.resumeAt", { time: "2:00" }), "استئناف عند 2:00");
  assert.equal(i18n.t("watch.continueWatching"), "متابعة المشاهدة");
  assert.equal(i18n.t("collections.likedEmpty"), "لا توجد فيديوهات معجب بها بعد.");
  assert.equal(i18n.t("playlists.playAll"), "تشغيل الكل");
  assert.equal(i18n.t("playlists.created", { name: "اختبار" }), "أُنشئت «اختبار»");
  assert.equal(i18n.t("toasts.feedRefreshed"), "تم تحديث التوصيات");
  assert.equal(i18n.t("watch.addedToWatchLater"), "أُضيف إلى المشاهدة لاحقاً");
  i18n.setMessages("ar", { nav: { home: "بيت" } }, en);
  assert.equal(i18n.t("nav.home"), "بيت");
  assert.equal(i18n.t("header.search"), "Search");
});

test("Arabic plural forms and locale metadata are applied", () => {
  i18n.setMessages("ar", ar, en);
  assert.equal(i18n.localeMeta("ar").dir, "rtl");
  assert.equal(i18n.localeMeta("en").dir, "ltr");
  assert.equal(i18n.formatCount("counts.videos", 1), "فيديو واحد");
  assert.equal(i18n.formatCount("counts.videos", 2), "فيديوهان");
  assert.match(i18n.formatCount("counts.videos", 3), /فيديوهات/);
  assert.match(i18n.formatCount("counts.videos", 11), /فيديو/);
  assert.equal(i18n.formatNumber(12096), "12,096");
  assert.match(i18n.formatNumber(49_514_632, { notation: "compact", maximumFractionDigits: 1 }), /مليون/);
});

test("the locale registry is ready for additional dictionaries", () => {
  assert.deepEqual(i18n.locales().map((locale) => locale.code), ["en", "ar"]);
  assert.equal(i18n.hasLocale("ar"), true);
  assert.equal(i18n.hasLocale("fr"), false);
});
