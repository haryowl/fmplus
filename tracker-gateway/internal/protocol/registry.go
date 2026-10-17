package protocol

import (
	"fmt"
	"sync"
)

// Registry holds named adapters and live sessions for 2-way commands.
type Registry struct {
	mu       sync.RWMutex
	adapters map[string]Adapter
	byIMEI   map[string]*ConnSession
	byDevice map[string]*ConnSession
}

func NewRegistry() *Registry {
	return &Registry{
		adapters: make(map[string]Adapter),
		byIMEI:   make(map[string]*ConnSession),
		byDevice: make(map[string]*ConnSession),
	}
}

func (r *Registry) Register(a Adapter) {
	if a == nil || a.Name() == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[a.Name()] = a
}

func (r *Registry) Get(name string) (Adapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[name]
	return a, ok
}

func (r *Registry) All() []Adapter {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Adapter, 0, len(r.adapters))
	for _, a := range r.adapters {
		out = append(out, a)
	}
	return out
}

func (r *Registry) Bind(sess *ConnSession) {
	if sess == nil || sess.Conn == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if sess.IMEI != "" {
		r.byIMEI[sess.IMEI] = sess
	}
	if sess.DeviceID != "" {
		r.byDevice[sess.DeviceID] = sess
	}
}

func (r *Registry) Unbind(sess *ConnSession) {
	if sess == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if sess.IMEI != "" {
		if cur, ok := r.byIMEI[sess.IMEI]; ok && cur == sess {
			delete(r.byIMEI, sess.IMEI)
		}
	}
	if sess.DeviceID != "" {
		if cur, ok := r.byDevice[sess.DeviceID]; ok && cur == sess {
			delete(r.byDevice, sess.DeviceID)
		}
	}
}

func (r *Registry) SessionByDevice(deviceID string) (*ConnSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.byDevice[deviceID]
	return s, ok
}

func (r *Registry) SessionByIMEI(imei string) (*ConnSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.byIMEI[imei]
	return s, ok
}

func (r *Registry) SendToDevice(deviceID string, payload []byte) error {
	sess, ok := r.SessionByDevice(deviceID)
	if !ok || sess.Conn == nil {
		return fmt.Errorf("device %s not connected", deviceID)
	}
	_, err := sess.Conn.Write(payload)
	return err
}

// Snapshot returns adapter catalog + online session counts (for /adapters health).
func (r *Registry) Snapshot() map[string]any {
	r.mu.RLock()
	defer r.mu.RUnlock()
	adapters := make([]map[string]any, 0, len(r.adapters))
	for _, a := range r.adapters {
		adapters = append(adapters, map[string]any{
			"name":        a.Name(),
			"displayName": a.DisplayName(),
			"status":      a.Status(),
			"defaultAddr": a.DefaultAddr(),
		})
	}
	sessions := make([]map[string]any, 0, len(r.byDevice))
	byProto := map[string]int{}
	for _, s := range r.byDevice {
		sessions = append(sessions, map[string]any{
			"deviceId": s.DeviceID,
			"imei":     s.IMEI,
			"protocol": s.Protocol,
		})
		byProto[s.Protocol]++
	}
	return map[string]any{
		"adapters":       adapters,
		"onlineCount":    len(r.byDevice),
		"onlineByProto":  byProto,
		"onlineSessions": sessions,
		"note":           "Adapters are MVP/partial/experimental until certified",
	}
}
