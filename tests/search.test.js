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
