package guard

import (
	"sync"
	"time"
)

const (
	window = time.Minute
	maxHit = 8
)

var (
	mu   sync.Mutex
	hits = map[string][]time.Time{}
)

// AllowUnknown returns false when this IMEI/IP key has been hammering unknown lookups.
func AllowUnknown(key string) bool {
	now := time.Now()
	cutoff := now.Add(-window)
	mu.Lock()
	defer mu.Unlock()
	list := hits[key]
	kept := list[:0]
	for _, t := range list {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= maxHit {
		hits[key] = kept
		return false
	}
	hits[key] = append(kept, now)
	if len(hits) > 20_000 {
		for k, v := range hits {
			alive := false
			for _, t := range v {
				if t.After(cutoff) {
					alive = true
					break
				}
			}
			if !alive {
				delete(hits, k)
			}
		}
	}
	return true
}
