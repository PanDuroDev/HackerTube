/* Shared client-side search engine for the main catalog and Hacker News catalog. */
(function (root) {
  "use strict";

  const FIELD_WEIGHTS = Object.freeze({
    title: 12, channel: 8, topics: 7, topic: 7, primary_topic: 7,
    categories: 6, tags: 6, metadata: 2, id: 2, summary: 4, why_hn: 3,
  });

  const STOP_WORDS = new Set([
    "a", "an", "and", "are", "at", "for", "from", "how", "in", "is", "of",
    "on", "or", "the", "to", "what", "when", "where", "which", "why", "with",
    "الى", "الي", "عن", "علي", "في", "ما", "ماذا", "مع", "من", "هو", "هي", "و", "او", "كيف",
  ]);

  const PHRASE_ALIASES = [
    ["c plus plus", "cpp"], ["c sharp", "csharp"],
    ["جافا سكريبت", "javascript"], ["جافاسكربت", "javascript"],
    ["داتا ستركتشر", "algorithms"], ["هياكل البيانات", "algorithms"],
    ["داتا ستركتشر", "algorithms"], ["هياكل البيانات", "algorithms"],
    ["تعلم الاله", "ai"], ["الذكاء الاصطناعي", "ai"],
    ["امن سيبراني", "security"], ["قواعد البيانات", "database"],
    ["داتا بيز", "database"], ["تطوير الويب", "web"],
    ["علوم الحاسب", "cs"], ["علوم الحاسوب", "cs"],
  ].map(function (pair) { return [normalize(pair[0]), pair[1]]; });

  const TOKEN_ALIASES = Object.freeze({
    py: "python", بايثون: "python", js: "javascript", جافاسكربت: "javascript",
    nodejs: "javascript", cpp: "cpp", "c++": "cpp", سيبلس: "cpp",
    csharp: "csharp", "c#": "csharp", dotnet: "csharp", ".net": "csharp",
    db: "database", sql: "database", هاكر: "security", هكر: "security",
    ai: "ai", ml: "ai",
  });

  function normalize(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
      .replace(/\u0640/g, "")
      .replace(/[إأآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[^\w\u0600-\u06ff+#.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalQuery(value) {
    let query = normalize(value);
    for (const pair of PHRASE_ALIASES) {
      const padded = " " + query + " ";
      query = padded.split(" " + pair[0] + " ").join(" " + pair[1] + " ").trim();
    }
    return query;
  }

  function tokenize(value) {
    const matches = normalize(value).match(/[\p{L}\p{N}_+#.]+/gu) || [];
    const tokens = [];
    for (const match of matches) {
      tokens.push(match);
      if (match.includes(".") && !match.startsWith(".")) {
        for (const part of match.split(".").filter(Boolean)) {
          if (part.length > 1) tokens.push(part);
        }
      }
    }
    return tokens;
  }

  function queryTokens(value) {
    const tokens = tokenize(canonicalQuery(value)).map(function (token) {
      return TOKEN_ALIASES[token] || token;
    });
    return Array.from(new Set(tokens.filter(function (token) {
      return token.length > 0 && !STOP_WORDS.has(token);
    })));
  }

  function editDistanceAtMostOne(left, right) {
    const a = Array.from(left);
    const b = Array.from(right);
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      edits++;
      if (edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    if (i < a.length || j < b.length) edits++;
    return edits <= 1;
  }

  class SearchIndex {
    constructor(items, getFields) {
      this.items = Array.isArray(items) ? items : [];
      this.getFields = typeof getFields === "function" ? getFields : function (item) { return item || {}; };
      this.documents = [];
      this.postings = new Map();
      this.terms = [];

      this.items.forEach((item, index) => {
        const source = this.getFields(item) || {};
        const fields = [];
        const weights = new Map();
        for (const [name, value] of Object.entries(source)) {
          if (value == null || value === "") continue;
          const text = normalize(Array.isArray(value) ? value.join(" ") : value);
          if (!text) continue;
          fields.push({ name: name, text: text });
          const weight = FIELD_WEIGHTS[name] || 2;
          for (const token of new Set(tokenize(text))) {
            weights.set(token, (weights.get(token) || 0) + weight);
          }
        }
        this.documents.push({ item: item, fields: fields, index: index });
        for (const [token, weight] of weights) {
          let posting = this.postings.get(token);
          if (!posting) { posting = new Map(); this.postings.set(token, posting); }
          posting.set(index, weight);
        }
      });
      this.terms = Array.from(this.postings.keys());
    }

    matchingTerms(token, isLast) {
      const matches = new Map();
      if (this.postings.has(token)) matches.set(token, 1);
      if (isLast && token.length >= 2) {
        let added = 0;
        for (const term of this.terms) {
          if (term !== token && term.startsWith(token)) {
            matches.set(term, 0.72);
            if (++added >= 16) break;
          }
        }
      }
      if (!matches.size && token.length >= 4) {
        let added = 0;
        for (const term of this.terms) {
          if (editDistanceAtMostOne(token, term)) {
            matches.set(term, 0.58);
            if (++added >= 8) break;
          }
        }
      }
      return matches;
    }

    search(query) {
      const rawQuery = normalize(query);
      const tokens = queryTokens(query);
      if (!tokens.length) return [];

      const scores = new Map();
      tokens.forEach((token, tokenIndex) => {
        const termMatches = this.matchingTerms(token, tokenIndex === tokens.length - 1);
        const perDocument = new Map();
        for (const [term, quality] of termMatches) {
          const posting = this.postings.get(term);
          if (!posting) continue;
          const inverseFrequency = 1 + Math.log1p(this.documents.length / (posting.size + 1));
          for (const [documentIndex, weight] of posting) {
            const value = weight * quality * inverseFrequency;
            perDocument.set(documentIndex, Math.max(perDocument.get(documentIndex) || 0, value));
          }
        }
        for (const [documentIndex, value] of perDocument) {
          let result = scores.get(documentIndex);
          if (!result) { result = { score: 0, matched: 0 }; scores.set(documentIndex, result); }
          result.score += value;
          result.matched++;
        }
      });

      if (!scores.size) return [];
      const complete = Array.from(scores.entries()).filter((entry) => entry[1].matched === tokens.length);
      const minimumMatches = tokens.length === 1 ? 1 : Math.ceil(tokens.length / 2);
      const selected = complete.length
        ? complete
        : Array.from(scores.entries()).filter((entry) => entry[1].matched >= minimumMatches);

      const ranked = selected.map(([documentIndex, result]) => {
        const document = this.documents[documentIndex];
        let phraseBonus = 0;
        for (const field of document.fields) {
          if (field.text.includes(rawQuery) && rawQuery.length >= 2) {
            phraseBonus += field.name === "title" ? 42
              : field.name === "channel" ? 24
              : (FIELD_WEIGHTS[field.name] || 2) * 2;
          }
        }
        const coverage = result.matched / tokens.length;
        return {
          item: document.item,
          score: (result.score + phraseBonus) * (0.55 + 0.45 * coverage),
          matchedTokens: result.matched,
          totalTokens: tokens.length,
          index: document.index,
        };
      });
      ranked.sort((a, b) => b.score - a.score || a.index - b.index);
      return ranked;
    }
  }

  const api = { SearchIndex: SearchIndex, normalize: normalize, tokenize: tokenize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HackerTubeSearch = api;
})(typeof window !== "undefined" ? window : globalThis);
