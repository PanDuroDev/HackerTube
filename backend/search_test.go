package main

import (
	"os"
	"path/filepath"
	"testing"
)

func fixtureIndex() *SearchIndex {
	return NewSearchIndex([]Video{
		{ID: "python", Title: "Python for Beginners", Channel: "Code Academy", Topics: []string{"python"}},
		{ID: "channel", Title: "A Complete Programming Guide", Channel: "Python Academy"},
		{ID: "structures", Title: "Algorithms and Data Structures", Channel: "Computer Science", Topics: []string{"algorithms"}},
		{ID: "javascript", Title: "JavaScript Async Patterns", Channel: "Web School", Topics: []string{"javascript"}},
		{ID: "cpp", Title: "C++ Templates", Channel: "Compiler Lab", Topics: []string{"cpp"}},
	})
}

func ids(indexes []int, index *SearchIndex) []string {
	values := make([]string, len(indexes))
	for position, value := range indexes {
		values[position] = index.documents[value].ID
	}
	return values
}

func TestNormalizeArabicVariantsAndSymbols(t *testing.T) {
	if got := normalize("إِبْرَامَجَةٌ C++"); got != "ابرامجه c++" {
		t.Fatalf("normalize returned %q", got)
	}
}

func TestExactTitleOutranksChannelOnlyMatch(t *testing.T) {
	index := fixtureIndex()
	results := ids(index.Search("python", 20), index)
	if len(results) == 0 || results[0] != "python" {
		t.Fatalf("expected python first, got %v", results)
	}
	found := false
	for _, result := range results {
		if result == "channel" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected channel match, got %v", results)
	}
}

func TestTopicAliases(t *testing.T) {
	index := fixtureIndex()
	cases := map[string]string{
		"data structures": "structures",
		"هياكل البيانات":  "structures",
		"بايثون":          "python",
		"c plus plus":     "cpp",
	}
	for query, expected := range cases {
		results := ids(index.Search(query, 20), index)
		if len(results) == 0 || results[0] != expected {
			t.Fatalf("%q: expected %s first, got %v", query, expected, results)
		}
	}
}

func TestPrefixAndTypoMatching(t *testing.T) {
	index := fixtureIndex()
	if results := ids(index.Search("javascr", 20), index); len(results) == 0 || results[0] != "javascript" {
		t.Fatalf("prefix search failed: %v", results)
	}
	if results := ids(index.Search("pythn", 20), index); len(results) == 0 || results[0] != "python" {
		t.Fatalf("typo search failed: %v", results)
	}
}

func TestDedupeAndChannelDiversity(t *testing.T) {
	videos := make([]Video, 0, 10)
	for position := 0; position < 6; position++ {
		videos = append(videos, Video{ID: "a", Title: "Python lesson " + string(rune('A'+position)), Channel: "Channel A"})
	}
	for _, channel := range []string{"B", "C", "D", "E"} {
		videos = append(videos, Video{ID: channel, Title: "Python guide " + channel, Channel: "Channel " + channel})
	}
	index := NewSearchIndex(videos)
	results := ids(index.Search("python", 6), index)
	if len(results) != 6 {
		t.Fatalf("expected 6 results, got %v", results)
	}
	channelA := 0
	for _, result := range results {
		if result == "a" {
			channelA++
		}
	}
	if channelA > groupLimit {
		t.Fatalf("channel diversity was not applied: %v", results)
	}
}

func TestDuplicateTitleAndChannelIsCollapsed(t *testing.T) {
	index := NewSearchIndex([]Video{
		{ID: "a", Title: "Python Guide", Channel: "Channel C"},
		{ID: "b", Title: "Python Guide", Channel: "Channel C"},
		{ID: "c", Title: "Python Basics", Channel: "Channel D"},
	})
	results := ids(index.Search("python", 20), index)
	if len(results) != 2 {
		t.Fatalf("expected duplicate to collapse, got %v", results)
	}
}

func TestEmptyQueryReturnsNoResults(t *testing.T) {
	if results := fixtureIndex().Search("   ", 20); len(results) != 0 {
		t.Fatalf("expected no results, got %v", results)
	}
}

func BenchmarkSearchFullCatalog(b *testing.B) {
	path := filepath.Join("..", "public", "data", "videos.json")
	if _, err := os.Stat(path); err != nil {
		b.Skip("catalog data is not available")
	}
	videos, err := loadCatalog(path)
	if err != nil {
		b.Fatal(err)
	}
	index := NewSearchIndex(videos)
	queries := []string{
		"python", "javascript", "react", "machine learning", "data structures",
		"بايثون", "هياكل البيانات", "c++", "linux docker", "rust ownership",
	}
	b.ResetTimer()
	for round := 0; round < b.N; round++ {
		index.Search(queries[round%len(queries)], 20000)
	}
}
