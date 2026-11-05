package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"sync"
	"time"
)

type request struct {
	ID     int    `json:"id"`
	Method string `json:"method"`
	Query  string `json:"query"`
	Limit  int    `json:"limit"`
}

type stats struct {
	Docs      int     `json:"docs"`
	Terms     int     `json:"terms"`
	HeapMB    float64 `json:"heap_mb"`
	HeapSysMB float64 `json:"heap_sys_mb"`
	SystemMB  float64 `json:"system_mb"`
	GC        uint32  `json:"gc"`
	Goroutine int     `json:"goroutines"`
	Queries   int64   `json:"queries"`
	AvgMS     float64 `json:"avg_ms"`
	LastMS    float64 `json:"last_ms"`
	MaxMS     float64 `json:"max_ms"`
}

type response struct {
	ID      int      `json:"id,omitempty"`
	Type    string   `json:"type,omitempty"`
	OK      bool     `json:"ok"`
	Error   string   `json:"error,omitempty"`
	Indices []int    `json:"indices,omitempty"`
	IDs     []string `json:"ids,omitempty"`
	Total   int      `json:"total,omitempty"`
	TookMS  float64  `json:"took_ms,omitempty"`
	FreedMB float64  `json:"freed_mb,omitempty"`
	BuildMS float64  `json:"build_ms,omitempty"`
	Stats   *stats   `json:"stats,omitempty"`
}

type backend struct {
	index   *SearchIndex
	queries int64
	totalMS float64
	lastMS  float64
	maxMS   float64
}

func (service *backend) stats() stats {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	average := 0.0
	if service.queries > 0 {
		average = service.totalMS / float64(service.queries)
	}
	return stats{
		Docs:      len(service.index.documents),
		Terms:     service.index.TermCount(),
		HeapMB:    bytesToMB(memory.HeapAlloc),
		HeapSysMB: bytesToMB(memory.HeapSys),
		SystemMB:  bytesToMB(memory.Sys),
		GC:        memory.NumGC,
		Goroutine: runtime.NumGoroutine(),
		Queries:   service.queries,
		AvgMS:     round(average),
		LastMS:    round(service.lastMS),
		MaxMS:     round(service.maxMS),
	}
}

func bytesToMB(value uint64) float64 {
	return round(float64(value) / (1024 * 1024))
}

func round(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
}

func (service *backend) search(query string, limit int) response {
	started := time.Now()
	indices := service.index.Search(query, limit)
	ids := make([]string, len(indices))
	for position, index := range indices {
		ids[position] = service.index.documents[index].ID
	}
	elapsed := float64(time.Since(started).Microseconds()) / 1000
	service.queries++
	service.totalMS += elapsed
	service.lastMS = elapsed
	if elapsed > service.maxMS {
		service.maxMS = elapsed
	}
	return response{OK: true, Indices: indices, IDs: ids, Total: len(indices), TookMS: round(elapsed)}
}

func (service *backend) trim() response {
	before := service.stats()
	runtime.GC()
	debug.FreeOSMemory()
	after := service.stats()
	return response{OK: true, Stats: &after, FreedMB: round(before.HeapMB - after.HeapMB)}
}

func main() {
	debug.SetGCPercent(50)
	dataPath := flag.String("data", "", "Path to data/videos.json")
	flag.Parse()
	if *dataPath == "" {
		fmt.Fprintln(os.Stderr, "missing --data")
		os.Exit(2)
	}

	buildStarted := time.Now()
	videos, err := loadCatalog(*dataPath)
	if err != nil {
		writeLine(response{Type: "ready", OK: false, Error: err.Error()})
		os.Exit(1)
	}
	index := NewSearchIndex(videos)
	buildMS := float64(time.Since(buildStarted).Microseconds()) / 1000
	service := &backend{index: index}

	writeLine(response{
		Type:    "ready",
		OK:      true,
		BuildMS: round(buildMS),
		Stats:   statsFor(service),
	})

	idleTrim := time.NewTimer(20 * time.Second)
	defer idleTrim.Stop()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	requests := make(chan request, 4)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for scanner.Scan() {
			var message request
			if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
				writeLine(response{OK: false, Error: "invalid json"})
				continue
			}
			if message.Method == "shutdown" {
				idleTrim.Stop()
				writeLine(response{ID: message.ID, OK: true})
				os.Exit(0)
			}
			idleTrim.Reset(20 * time.Second)
			select {
			case requests <- message:
			default:
				writeLine(response{ID: message.ID, OK: false, Error: "backend busy"})
			}
		}
		idleTrim.Stop()
	}()

	for {
		select {
		case message := <-requests:
			var reply response
			switch message.Method {
			case "search":
				reply = service.search(message.Query, message.Limit)
			case "stats":
				reply = response{OK: true, Stats: statsFor(service)}
			case "trim":
				reply = service.trim()
			case "ping":
				reply = response{OK: true}
			default:
				reply = response{OK: false, Error: "unknown method"}
			}
			reply.ID = message.ID
			if !writeLine(reply) {
				return
			}
		case <-idleTrim.C:
			idleTrim.Stop()
			runtime.GC()
			debug.FreeOSMemory()
		case <-done:
			return
		}
	}
}

func statsFor(service *backend) *stats {
	value := service.stats()
	return &value
}

var outputMu sync.Mutex

func writeLine(value response) bool {
	outputMu.Lock()
	defer outputMu.Unlock()
	encoder := json.NewEncoder(os.Stdout)
	return encoder.Encode(value) == nil
}
