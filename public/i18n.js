/* Small runtime for UI locale strings, directions, numbers, and plural forms. */
(function (root) {
  "use strict";

  const LOCALES = Object.freeze({
    en: { name: "English", lang: "en", dir: "ltr", numberLocale: "en" },
    ar: { name: "العربية", lang: "ar", dir: "rtl", numberLocale: "ar-u-nu-latn" },
  });

  const cache = new Map();
  let current = "en";
  let messages = {};
  let fallback = {};

  function localeMeta(code) {
    return LOCALES[code] || LOCALES.en;
  }

  function hasLocale(code) {
    return Object.prototype.hasOwnProperty.call(LOCALES, code);
  }

  function lookup(source, key) {
    if (!source) return undefined;
    let value = source;
    for (const part of String(key).split(".")) {
      if (value == null || typeof value !== "object" || !(part in value)) return undefined;
      value = value[part];
    }
    return typeof value === "string" ? value : undefined;
  }

  function interpolate(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, key) => (
      params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
    ));
  }

  async function fetchMessages(code) {
    const response = await fetch(`i18n/${code}.json`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`i18n/${code}.json: HTTP ${response.status}`);
    return response.json();
  }

  async function loadLocale(code) {
    const target = hasLocale(code) ? code : "en";
    if (!cache.has("en")) cache.set("en", await fetchMessages("en"));
    fallback = cache.get("en");
    if (!cache.has(target)) cache.set(target, await fetchMessages(target));
    current = target;
    messages = target === "en" ? fallback : cache.get(target);
    return current;
  }

  function t(key, params) {
    const value = lookup(messages, key) ?? lookup(fallback, key) ?? key;
    return interpolate(value, params);
  }

  function pluralForm(count) {
    try {
      return new Intl.PluralRules(localeMeta(current).numberLocale || current).select(count);
    } catch {
      return count === 1 ? "one" : "other";
    }
  }

  function formatCount(key, count, params) {
    const form = pluralForm(count);
    const value = lookup(messages, `${key}.${form}`)
      ?? lookup(fallback, `${key}.${form}`)
      ?? lookup(messages, `${key}.other`)
      ?? lookup(fallback, `${key}.other`)
      ?? key;
    return interpolate(value, { ...params, count: params?.count ?? count });
  }

  function formatNumber(value, options) {
    try {
      return new Intl.NumberFormat(localeMeta(current).numberLocale || current, options).format(value);
    } catch {
      return String(value);
    }
  }

  function applyStaticTranslations(doc) {
    if (!doc) return;
    doc.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.getAttribute("data-i18n"));
    });
    doc.querySelectorAll("[data-i18n-attr]").forEach((element) => {
      const specs = element.getAttribute("data-i18n-attr").split(",");
      for (const spec of specs) {
        const [attribute, key] = spec.split(":").map((part) => part.trim());
        if (attribute && key) element.setAttribute(attribute, t(key));
      }
    });
  }

  function locales() {
    return Object.entries(LOCALES).map(([code, meta]) => ({ code, ...meta }));
  }

  function setMessages(code, nextMessages, nextFallback) {
    if (hasLocale(code)) cache.set(code, nextMessages || {});
    current = hasLocale(code) ? code : "en";
    messages = cache.get(current) || {};
    fallback = nextFallback || cache.get("en") || {};
  }

  const api = {
    LOCALES,
    loadLocale,
    t,
    formatCount,
    formatNumber,
    applyStaticTranslations,
    localeMeta,
    locales,
    hasLocale,
    setMessages,
    get current() { return current; },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HackerTubeI18n = api;
})(typeof window !== "undefined" ? window : globalThis);
