const test = require("node:test");
const assert = require("node:assert/strict");
const { SearchIndex, normalize } = require("../public/search.js");

function makeIndex() {
  const videos = [
    { id: "python", title: "Python for Beginners", channel: "Code Academy", topics: "python", metadata: "Course Beginner" },
    { id: "channel", title: "A Complete Programming Guide", channel: "Python Academy", topics: "programming", metadata: "Tutorial" },
    { id: "structures", title: "Algorithms and Data Structures", channel: "Computer Science", topics: "algorithms", metadata: "Advanced" },
    { id: "javascript", title: "JavaScript Async Patterns", channel: "Web School", topics: "javascript", metadata: "Tutorial" },
    { id: "summary", title: "Inside a New Runtime", channel: "Engineering", summary: "How Python handles memory and execution", tags: "python runtime" },
    { id: "cpp", title: "C++ Templates", channel: "Compiler Lab", topics: "cpp C++", metadata: "Advanced" },
  ];
  return new SearchIndex(videos, (video) => video);
}

test("normalization handles Arabic variants and keeps programming symbols", () => {
  assert.equal(normalize("إِبْرَامَجَةٌ C++"), "ابرامجه c++");
});

test("exact title matches rank above a channel-only match", () => {
  const results = makeIndex().search("python");
  assert.equal(results[0].item.id, "python");
  assert.ok(results.some((result) => result.item.id === "channel"));
});

test("topic aliases find records through their topic metadata", () => {
  const index = makeIndex();
  assert.equal(index.search("data structures")[0].item.id, "structures");
  assert.equal(index.search("هياكل البيانات")[0].item.id, "structures");
  assert.equal(index.search("بايثون")[0].item.id, "python");
  assert.equal(index.search("c plus plus")[0].item.id, "cpp");
});

test("prefix matching finds an unfinished final word", () => {
  const results = makeIndex().search("javascr");
  assert.ok(results.some((result) => result.item.id === "javascript"));
});

test("one-character typo is tolerated", () => {
  const results = makeIndex().search("pythn");
  assert.ok(results.some((result) => result.item.id === "python"));
});

test("search indexes contextual fields, not only titles", () => {
  const results = makeIndex().search("python memory");
  assert.equal(results[0].item.id, "summary");
});

test("query terms can match across title and channel fields", () => {
  const results = makeIndex().search("complete academy");
  assert.equal(results[0].item.id, "channel");
});

test("an empty query never returns the entire catalog", () => {
  assert.deepEqual(makeIndex().search("   "), []);
});


test("the index searches records beyond the initial display page", () => {
  const records = Array.from({ length: 90 }, (_, index) => ({
    id: String(index),
    title: index === 89 ? "DeepSearchTarget record" : "Ordinary programming video",
  }));
  const results = new SearchIndex(records, (record) => record).search("DeepSearchTarget");
  assert.equal(results[0].item.id, "89");
});

test("exact token matches outrank longer words that only share a prefix", () => {
  const videos = [
    { id: "reacting", title: "Reacting to Database Events", channel: "DB Talks" },
    { id: "react", title: "React Crash Course", channel: "Frontend School" },
  ];
  const results = new SearchIndex(videos, (video) => video).search("react");
  assert.equal(results[0].item.id, "react");
});

test("quality rank breaks relevance ties toward stronger results", () => {
  const videos = [
    { id: "low", title: "Python Basics", channel: "A" },
    { id: "high", title: "Python Guide", channel: "B" },
  ];
  const index = new SearchIndex(videos, (video) => video, {
    getRank: (video) => (video.id === "high" ? 1 : 0),
  });
  assert.equal(index.search("python")[0].item.id, "high");
});

test("search diversifies channels in the first result page", () => {
  const videos = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `a${index}`,
      title: `Python lesson ${index}`,
      channel: "Channel A",
    })),
    ...["B", "C", "D", "E"].map((channel) => ({
      id: channel.toLowerCase(),
      title: `Python guide ${channel}`,
      channel: `Channel ${channel}`,
    })),
  ];
  const index = new SearchIndex(videos, (video) => video, {
    getGroup: (video) => video.channel,
    groupLimit: 2,
    diversityLimit: 6,
  });
  const firstPage = index.search("python").slice(0, 6);
  const counts = new Map();
  for (const result of firstPage) {
    counts.set(result.item.channel, (counts.get(result.item.channel) || 0) + 1);
  }
  assert.equal(firstPage.length, 6);
  assert.ok([...counts.values()].every((count) => count <= 2));
});

test("an index can be built incrementally", () => {
  const videos = [
    { id: "python", title: "Python for Beginners", channel: "Code Academy" },
    { id: "rust", title: "Rust Ownership", channel: "Systems Lab" },
  ];
  const index = new SearchIndex(videos, (video) => video, { defer: true });
  index.addRange(0, 1);
  index.addRange(1, videos.length);
  index.finish();
  assert.equal(index.search("python")[0].item.id, "python");
  assert.equal(index.search("rust")[0].item.id, "rust");
});

test("search collapses exact duplicate title and channel results", () => {
  const videos = [
    { id: "a", title: "Python Guide", channel: "Channel C" },
    { id: "b", title: "Python Guide", channel: "Channel C" },
    { id: "c", title: "Python Basics", channel: "Channel D" },
  ];
  const index = new SearchIndex(videos, (video) => video, {
    getDedupeKey: (video) => `${video.channel}|${video.title}`,
  });
  const results = index.search("python");
  assert.equal(results.filter((result) => result.item.channel === "Channel C").length, 1);
});
