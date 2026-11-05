package main

import (
	"math"
	"sort"
	"strings"
)

const (
	groupLimit     = 2
	diversityLimit = 36
	defaultLimit   = 20000
	maxLimit       = 20000
)

var stopWords = map[string]struct{}{
	"a": {}, "an": {}, "and": {}, "are": {}, "at": {}, "for": {}, "from": {}, "how": {}, "in": {}, "is": {}, "of": {},
	"on": {}, "or": {}, "the": {}, "to": {}, "what": {}, "when": {}, "where": {}, "which": {}, "why": {}, "with": {},
	"الى": {}, "الي": {}, "عن": {}, "علي": {}, "في": {}, "ما": {}, "ماذا": {}, "مع": {}, "من": {}, "هو": {}, "هي": {}, "و": {}, "او": {}, "كيف": {},
}

var tokenAliases = map[string]string{
	"py": "python", "بايثون": "python", "js": "javascript", "جافاسكربت": "javascript",
	"nodejs": "javascript", "cpp": "cpp", "c++": "cpp", "سيبلس": "cpp",
	"csharp": "csharp", "c#": "csharp", "dotnet": "csharp", ".net": "csharp",
	"db": "database", "sql": "database", "هاكر": "security", "هكر": "security",
	"ai": "ai", "ml": "ai",
}

var phraseAliases = buildPhraseAliases([][2]string{
	{"c plus plus", "cpp"}, {"c sharp", "csharp"},
	{"جافا سكريبت", "javascript"}, {"جافاسكربت", "javascript"},
	{"داتا ستركتشر", "algorithms"}, {"هياكل البيانات", "algorithms"},
	{"تعلم الاله", "ai"}, {"الذكاء الاصطناعي", "ai"},
	{"امن سيبراني", "security"}, {"قواعد البيانات", "database"},
	{"داتا بيز", "database"}, {"تطوير الويب", "web"},
	{"علوم الحاسب", "cs"}, {"علوم الحاسوب", "cs"},
})

type phraseAlias struct {
	from string
	to   string
}

func buildPhraseAliases(pairs [][2]string) []phraseAlias {
	aliases := make([]phraseAlias, 0, len(pairs))
	for _, pair := range pairs {
		aliases = append(aliases, phraseAlias{from: normalize(pair[0]), to: pair[1]})
	}
	return aliases
}

type posting struct {
	doc    int32
	weight int32
}

type SearchIndex struct {
	videos    []Video
	documents []Document
	postings  map[string][]posting
	terms     []string
}

func NewSearchIndex(videos []Video) *SearchIndex {
	index := &SearchIndex{
		videos:    videos,
		documents: make([]Document, 0, len(videos)),
		postings:  make(map[string][]posting, len(videos)*4),
		terms:     make([]string, 0, len(videos)*4),
	}
	for position, video := range videos {
		index.add(position, video)
	}
	return index
}

func (index *SearchIndex) add(position int, video Video) {
	fields := searchFields(video)
	document := Document{
		Index:   position,
		Title:   strings.ToLower(strings.TrimSpace(video.Title)),
		Channel: strings.TrimSpace(video.ChannelID),
		Fields:  make([]Field, 0, len(fields)),
	}
	if document.Channel == "" {
		document.Channel = strings.TrimSpace(video.Channel)
	}
	document.Channel = strings.ToLower(document.Channel)
	weights := make(map[string]int, 32)
	order := make([]string, 0, 32)
	for _, field := range fields {
		text := normalize(field.Text)
		if text == "" {
			continue
		}
		document.Fields = append(document.Fields, Field{Name: field.Name, Text: text})
		weight := fieldWeightTopics
		switch field.Name {
		case "title":
			weight = fieldWeightTitle
		case "channel":
			weight = fieldWeightChannel
		}
		seen := make(map[string]struct{}, 8)
		for _, token := range tokenizeNormalized(text) {
			if _, ok := seen[token]; ok {
				continue
			}
			seen[token] = struct{}{}
			if _, ok := weights[token]; !ok {
				order = append(order, token)
			}
			weights[token] += weight
		}
	}
	for _, token := range order {
		list, ok := index.postings[token]
		if !ok {
			index.terms = append(index.terms, token)
		}
		index.postings[token] = append(list, posting{doc: int32(position), weight: int32(weights[token])})
	}
	index.documents = append(index.documents, document)
}

func canonicalQuery(value string) string {
	query := normalize(value)
	for _, alias := range phraseAliases {
		padded := " " + query + " "
		query = strings.TrimSpace(strings.ReplaceAll(padded, " "+alias.from+" ", " "+alias.to+" "))
	}
	return query
}

func queryTokens(value string) []string {
	raw := tokenizeNormalized(canonicalQuery(value))
	tokens := make([]string, 0, len(raw))
	seen := make(map[string]struct{}, len(raw))
	for _, token := range raw {
		if alias, ok := tokenAliases[token]; ok {
			token = alias
		}
		if token == "" {
			continue
		}
		if _, stop := stopWords[token]; stop {
			continue
		}
		if _, duplicate := seen[token]; duplicate {
			continue
		}
		seen[token] = struct{}{}
		tokens = append(tokens, token)
	}
	return tokens
}

func editDistanceAtMostOne(left, right string) bool {
	a := []rune(left)
	b := []rune(right)
	if abs(len(a)-len(b)) > 1 {
		return false
	}
	i, j, edits := 0, 0, 0
	for i < len(a) && j < len(b) {
		if a[i] == b[j] {
			i++
			j++
			continue
		}
		edits++
		if edits > 1 {
			return false
		}
		if len(a) > len(b) {
			i++
		} else if len(b) > len(a) {
			j++
		} else {
			i++
			j++
		}
	}
	if i < len(a) || j < len(b) {
		edits++
	}
	return edits <= 1
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

type termMatch struct {
	term    string
	quality float64
}

func (index *SearchIndex) matchingTerms(token string, isLast bool) []termMatch {
	matches := make([]termMatch, 0, 4)
	found := make(map[string]struct{}, 4)
	if _, ok := index.postings[token]; ok {
		matches = append(matches, termMatch{term: token, quality: 1})
		found[token] = struct{}{}
	}
	if isLast && len([]rune(token)) >= 2 {
		added := 0
		for _, term := range index.terms {
			if term == token || !strings.HasPrefix(term, token) {
				continue
			}
			if _, duplicate := found[term]; duplicate {
				continue
			}
			matches = append(matches, termMatch{term: term, quality: 0.72})
			found[term] = struct{}{}
			added++
			if added >= 16 {
				break
			}
		}
	}
	if len(matches) == 0 && len([]rune(token)) >= 4 {
		added := 0
		for _, term := range index.terms {
			if !editDistanceAtMostOne(token, term) {
				continue
			}
			if _, duplicate := found[term]; duplicate {
				continue
			}
			matches = append(matches, termMatch{term: term, quality: 0.58})
			found[term] = struct{}{}
			added++
			if added >= 8 {
				break
			}
		}
	}
	return matches
}

type scoredDocument struct {
	index   int
	score   float64
	matched int
}

func containsPhrase(text, phrase string) bool {
	return text != "" && phrase != "" && strings.Contains(" "+text+" ", " "+phrase+" ")
}

func phraseBonus(document Document, rawQuery string) float64 {
	if len([]rune(rawQuery)) < 2 {
		return 0
	}
	bonus := 0.0
	for _, field := range document.Fields {
		if !containsPhrase(field.Text, rawQuery) {
			continue
		}
		switch field.Name {
		case "title":
			bonus += 42
		case "channel":
			bonus += 24
		default:
			bonus += fieldWeightTopics * 2
		}
	}
	return bonus
}

func (index *SearchIndex) Search(query string, limit int) []int {
	ordered := index.searchScored(query, limit)
	indices := make([]int, len(ordered))
	for position, result := range ordered {
		indices[position] = result.index
	}
	return indices
}

func (index *SearchIndex) searchScored(query string, limit int) []scoredDocument {
	tokens := queryTokens(query)
	if len(tokens) == 0 {
		return []scoredDocument{}
	}
	if limit <= 0 || limit > maxLimit {
		limit = defaultLimit
	}
	rawQuery := normalize(query)
	docCount := len(index.documents)
	values := make([]float64, docCount)
	matched := make([]int, docCount)
	touched := make([]int, 0, 256)

	for _, token := range tokens {
		perDocument := make([]float64, docCount)
		perTouched := make([]int, 0, 128)
		for _, match := range index.matchingTerms(token, token == tokens[len(tokens)-1]) {
			list := index.postings[match.term]
			if len(list) == 0 {
				continue
			}
			inverseFrequency := 1 + math.Log1p(float64(docCount)/float64(len(list)+1))
			for _, item := range list {
				value := float64(item.weight) * match.quality * inverseFrequency
				document := int(item.doc)
				if perDocument[document] == 0 {
					perTouched = append(perTouched, document)
				}
				if value > perDocument[document] {
					perDocument[document] = value
				}
			}
		}
		for _, document := range perTouched {
			if values[document] == 0 && matched[document] == 0 {
				touched = append(touched, document)
			}
			values[document] += perDocument[document]
			matched[document]++
		}
	}
	if len(touched) == 0 {
		return []scoredDocument{}
	}

	complete := make([]scoredDocument, 0, len(touched))
	partial := make([]scoredDocument, 0, len(touched))
	minimumMatches := 1
	if len(tokens) > 1 {
		minimumMatches = (len(tokens) + 1) / 2
	}
	for _, document := range touched {
		if matched[document] == len(tokens) {
			complete = append(complete, scoredDocument{index: document, score: values[document], matched: matched[document]})
		} else if matched[document] >= minimumMatches {
			partial = append(partial, scoredDocument{index: document, score: values[document], matched: matched[document]})
		}
	}
	selected := complete
	if len(selected) == 0 {
		selected = partial
	}
	if len(selected) == 0 {
		return []scoredDocument{}
	}

	for position := range selected {
		document := index.documents[selected[position].index]
		coverage := float64(selected[position].matched) / float64(len(tokens))
		rank := index.videos[selected[position].index].Score / 10
		if rank < 0 {
			rank = 0
		} else if rank > 1 {
			rank = 1
		}
		selected[position].score = (selected[position].score+phraseBonus(document, rawQuery))*(0.55+0.45*coverage) + rank*5
	}
	sort.SliceStable(selected, func(left, right int) bool {
		if selected[left].score == selected[right].score {
			return selected[left].index < selected[right].index
		}
		return selected[left].score > selected[right].score
	})

	deduped := make([]scoredDocument, 0, len(selected))
	seen := make(map[string]struct{}, len(selected))
	for _, result := range selected {
		document := index.documents[result.index]
		key := document.Channel + "|" + document.Title
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, result)
	}

	head := make([]scoredDocument, 0, len(deduped))
	tail := make([]scoredDocument, 0, len(deduped))
	counts := make(map[string]int, 64)
	for _, result := range deduped {
		group := index.documents[result.index].Channel
		count := counts[group]
		if len(head) < diversityLimit && group != "" && count >= groupLimit {
			tail = append(tail, result)
			continue
		}
		head = append(head, result)
		if len(head) <= diversityLimit && group != "" {
			counts[group] = count + 1
		}
	}
	ordered := append(head, tail...)

	limit = min(limit, len(ordered))
	return ordered[:limit]
}

func (index *SearchIndex) TermCount() int {
	return len(index.terms)
}
