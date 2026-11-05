/* Shared catalog search fields so the web index, tests, and Go backend stay aligned. */
(function (root) {
  "use strict";

  const TOPIC_LABELS = {
    python: "Python", javascript: "JavaScript", web: "Web Development", php: "PHP",
    java: "Java", cpp: "C++", rust: "Rust", csharp: "C#", mobile: "Mobile", database: "Databases",
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

  function mainSearchFields(video) {
    return {
      title: video.title,
      channel: video.channel,
      topics: (video.topics || []).map((topic) => [
        topic,
        TOPIC_LABELS[topic] || topic,
        TOPIC_SEARCH_ALIASES[topic] || "",
      ].join(" ")).join(" "),
    };
  }

  function searchDedupeKey(item) {
    const channel = item.channel_id || item.channel || "";
    return `${String(channel).trim().toLowerCase()}|${String(item.title || "").trim().toLowerCase()}`;
  }

  function mainSearchOptions() {
    return {
      getRank: (video) => Math.min(1, Math.max(0, Number(video.score) || 0) / 10),
      getGroup: (video) => video.channel_id || video.channel,
      getDedupeKey: searchDedupeKey,
      groupLimit: 2,
      diversityLimit: 36,
    };
  }

  const api = { TOPIC_LABELS, TOPIC_SEARCH_ALIASES, mainSearchFields, mainSearchOptions, searchDedupeKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HackerTubeSearchFields = api;
})(typeof window !== "undefined" ? window : globalThis);
