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

// outboundSubpkg holds escaped frames for one logical downlink (shared seq).
type outboundSubpkg struct {
	total  int
	frames map[int][]byte // 1-based package index → escaped 0x7e…0x7e frame
	expiry time.Time
}

// outboundSubpkgCache remembers multi-fragment downlinks for 0x0005 resend.
type outboundSubpkgCache struct {
	mu   sync.Mutex
	bufs map[string]*outboundSubpkg
}

func newOutboundSubpkgCache() *outboundSubpkgCache {
	return &outboundSubpkgCache{bufs: map[string]*outboundSubpkg{}}
}

func outboundKey(phone string, seq uint16) string {
	return fmt.Sprintf("%s|%d", phone, seq)
}

func (c *outboundSubpkgCache) put(phone string, seq uint16, total int, frames map[int][]byte) {
	if c == nil || phone == "" || total < 2 || len(frames) == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gcLocked()
	cp := make(map[int][]byte, len(frames))
	for i, f := range frames {
		b := make([]byte, len(f))
		copy(b, f)
		cp[i] = b
	}
	c.bufs[outboundKey(phone, seq)] = &outboundSubpkg{
		total:  total,
		frames: cp,
		expiry: time.Now().Add(2 * time.Minute),
	}
}

// framesFor returns escaped frames for requested 1-based indexes; miss lists unknown ids.
func (c *outboundSubpkgCache) framesFor(phone string, seq uint16, ids []int) (resent [][]byte, miss []int) {
	if c == nil || phone == "" {
		return nil, append([]int(nil), ids...)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gcLocked()
	a := c.bufs[outboundKey(phone, seq)]
	if a == nil {
		return nil, append([]int(nil), ids...)
	}
	a.expiry = time.Now().Add(2 * time.Minute)
	for _, id := range ids {
		f, ok := a.frames[id]
		if !ok || len(f) == 0 {
			miss = append(miss, id)
			continue
		}
		cp := make([]byte, len(f))
		copy(cp, f)
		resent = append(resent, cp)
	}
	return resent, miss
}

func (c *outboundSubpkgCache) gcLocked() {
	now := time.Now()
	for k, a := range c.bufs {
		if now.After(a.expiry) {
			delete(c.bufs, k)
		}
	}
}
