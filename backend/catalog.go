package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"unicode"
)

type Video struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Channel   string   `json:"channel"`
	ChannelID string   `json:"channel_id"`
	Topics    []string `json:"topics"`
	Score     float64  `json:"score"`
}

type Field struct {
	Name string
	Text string
}

type Document struct {
	Index   int
	Title   string
	Channel string
	Fields  []Field
}

const (
	fieldWeightTitle   = 12
	fieldWeightChannel = 8
	fieldWeightTopics  = 7
)

var topicLabels = map[string]string{
	"python": "Python", "javascript": "JavaScript", "web": "Web Development", "php": "PHP",
	"java": "Java", "cpp": "C++", "rust": "Rust", "csharp": "C#", "mobile": "Mobile", "database": "Databases",
	"linux": "Linux", "devops": "DevOps & Cloud", "git": "Git", "security": "Security",
	"ai": "AI", "data": "Data Analysis", "algorithms": "Algorithms", "cs": "Computer Science",
	"testing": "Testing", "networking": "Networking", "tools": "Dev Tools",
}

var topicAliases = map[string]string{
	"python":     "py بايثون",
	"javascript": "js جافاسكربت جافا سكريبت nodejs",
	"web":        "frontend front end تطوير الويب",
	"php":        "لارافيل",
	"java":       "جافا",
	"cpp":        "c++ cplusplus c plus plus سي بلس بلس",
	"csharp":     "c# c sharp dotnet .net سي شارب",
	"mobile":     "android ios flutter kotlin اندرويد كوتلن",
	"database":   "sql mysql postgres mongodb داتا بيز قواعد البيانات",
	"linux":      "لينكس اوبونتو",
	"devops":     "cloud kubernetes docker ديفوبس",
	"git":        "github جيت",
	"security":   "cyber hacking cybersecurity امن سيبراني",
	"ai":         "machine learning deep learning artificial intelligence ml ذكاء اصطناعي تعلم الاله",
	"data":       "data science data analysis تحليل البيانات علم البيانات",
	"algorithms": "data structures هياكل البيانات داتا ستركتشر",
	"cs":         "computer science علوم الحاسوب علوم الحاسب",
	"testing":    "qa tests اختبار",
	"networking": "شبكات",
	"tools":      "ide editors ادوات المطور",
}

func loadCatalog(path string) ([]Video, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var videos []Video
	if err := json.Unmarshal(raw, &videos); err != nil {
		return nil, fmt.Errorf("parse catalog: %w", err)
	}
	for index := range videos {
		if strings.TrimSpace(videos[index].ID) == "" {
			return nil, fmt.Errorf("catalog entry %d has no id", index)
		}
	}
	return videos, nil
}

func searchFields(video Video) []Field {
	topics := make([]string, 0, len(video.Topics))
	for _, topic := range video.Topics {
		label := topicLabels[topic]
		if label == "" {
			label = topic
		}
		parts := []string{topic, label}
		if alias := topicAliases[topic]; alias != "" {
			parts = append(parts, alias)
		}
		topics = append(topics, strings.Join(parts, " "))
	}
	return []Field{
		{Name: "title", Text: video.Title},
		{Name: "channel", Text: video.Channel},
		{Name: "topics", Text: strings.Join(topics, " ")},
	}
}

func isWordRune(r rune) bool {
	if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '+' || r == '#' || r == '.' {
		return true
	}
	return r >= 0x0600 && r <= 0x06ff
}

func isTokenRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsNumber(r) || r == '_' || r == '+' || r == '#' || r == '.'
}

// normalize mirrors public/search.js so both engines produce the same terms.
func normalize(value string) string {
	var builder strings.Builder
	builder.Grow(len(value))
	pendingSpace := false
	for _, r := range strings.ToLower(value) {
		switch {
		case r >= 0x0610 && r <= 0x061a,
			r >= 0x064b && r <= 0x065f,
			r == 0x0670,
			r >= 0x06d6 && r <= 0x06ed,
			r == 0x0640:
			continue
		}
		switch r {
		case 'إ', 'أ', 'آ', 'ٱ':
			r = 'ا'
		case 'ى':
			r = 'ي'
		case 'ة':
			r = 'ه'
		case 'ؤ':
			r = 'و'
		case 'ئ':
			r = 'ي'
		}
		if isWordRune(r) {
			if pendingSpace && builder.Len() > 0 {
				builder.WriteByte(' ')
			}
			pendingSpace = false
			builder.WriteRune(r)
		} else {
			pendingSpace = true
		}
	}
	return builder.String()
}

func tokenizeNormalized(text string) []string {
	raw := make([]string, 0, 8)
	var current strings.Builder
	flush := func() {
		if current.Len() == 0 {
			return
		}
		raw = append(raw, current.String())
		current.Reset()
	}
	for _, r := range text {
		if isTokenRune(r) {
			current.WriteRune(r)
		} else {
			flush()
		}
	}
	flush()

	tokens := make([]string, 0, len(raw))
	for _, match := range raw {
		tokens = append(tokens, match)
		if strings.Contains(match, ".") && !strings.HasPrefix(match, ".") {
			for _, part := range strings.Split(match, ".") {
				if len([]rune(part)) > 1 {
					tokens = append(tokens, part)
				}
			}
		}
	}
	return tokens
}
