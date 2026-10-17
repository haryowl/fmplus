package jt808

import (
	"fmt"
	"sync"
	"time"
)

// subpkgAssembly collects JT/T 808 bit-13 fragmented bodies until complete.
type subpkgAssembly struct {
	msgID  uint16
	total  int
	parts  map[int][]byte
	expiry time.Time
}

type subpkgTracker struct {
	mu   sync.Mutex
	bufs map[string]*subpkgAssembly
}

func newSubpkgTracker() *subpkgTracker {
	return &subpkgTracker{bufs: map[string]*subpkgAssembly{}}
}

func subpkgKey(phone string, msgID uint16, total int) string {
	return fmt.Sprintf("%s|%04x|%d", phone, msgID, total)
}

// feed stores one fragment (index is 1-based). Returns full body when all parts present.
func (t *subpkgTracker) feed(phone string, msgID uint16, total, index int, frag []byte) ([]byte, bool) {
	if t == nil || total < 1 || total > 256 || index < 1 || index > total {
		return nil, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.gcLocked()
	key := subpkgKey(phone, msgID, total)
	a := t.bufs[key]
	if a == nil {
		a = &subpkgAssembly{
			msgID:  msgID,
			total:  total,
			parts:  map[int][]byte{},
			expiry: time.Now().Add(2 * time.Minute),
		}
		t.bufs[key] = a
	}
	cp := make([]byte, len(frag))
	copy(cp, frag)
	a.parts[index] = cp
	a.expiry = time.Now().Add(2 * time.Minute)
	if len(a.parts) < total {
		return nil, false
	}
	out := make([]byte, 0, total*64)
	for i := 1; i <= total; i++ {
		p, ok := a.parts[i]
		if !ok {
			return nil, false
		}
		out = append(out, p...)
	}
	delete(t.bufs, key)
	return out, true
}

func (t *subpkgTracker) gcLocked() {
	now := time.Now()
	for k, a := range t.bufs {
		if now.After(a.expiry) {
			delete(t.bufs, k)
		}
	}
}
