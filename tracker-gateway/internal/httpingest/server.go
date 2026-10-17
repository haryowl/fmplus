package httpingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		snap := metrics.Snapshot()
		if sessions != nil {
			reg := sessions.Snapshot()
			snap["onlineCount"] = reg["onlineCount"]
			snap["onlineByProto"] = reg["onlineByProto"]
		}
		writeJSON(w, 200, snap)
	})
	mux.HandleFunc("/metrics", metrics.Handler)
	mux.HandleFunc("/adapters", func(w http.ResponseWriter, r *http.Request) {
		if sessions != nil {
			writeJSON(w, 200, sessions.Snapshot())
			return
		}
		writeJSON(w, 200, map[string]any{
			"note": "Protocol adapters are MVP/partial until certified",
			"http": map[string]any{"status": "partial", "path": "/ingest/v1/fix"},
		})
	})
	mux.HandleFunc("/ingest/v1/fix", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, 405, map[string]any{"error": "Method not allowed"})
			return
		}
		token := bearer(r)
		body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
		if err != nil {
			writeJSON(w, 400, map[string]any{"error": "bad body"})
			return
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			writeJSON(w, 400, map[string]any{"error": "invalid json"})
			return
		}
		reqCtx := r.Context()
		var device *store.Device
		if token != "" {
			device, _ = st.FindByTokenHash(reqCtx, hashToken(token))
		}
		if device == nil {
			if imei, _ := payload["imei"].(string); imei != "" {
				device = deviceauth.FindByIMEI(reqCtx, st, strings.TrimSpace(imei), r.RemoteAddr, "json")
			}
		}
		if device == nil {
			writeJSON(w, 401, map[string]any{"error": "Unknown or disabled device"})
			return
		}

		heartbeat := asBool(payload["heartbeat"], payload["ping"])
		lat := asFloat(payload["lat"], payload["latitude"])
		lon := asFloat(payload["lon"], payload["lng"], payload["longitude"])
		if heartbeat || lat == nil || lon == nil {
			if err := st.TouchSeen(reqCtx, device); err != nil {
				writeJSON(w, 500, map[string]any{"error": err.Error()})
				return
			}
			writeJSON(w, 200, map[string]any{"ok": true, "imei": device.IMEI, "heartbeat": true})
			return
		}

		rawAttrs := map[string]any{}
		for k, v := range payload {
			if k == "lat" || k == "lon" || k == "latitude" || k == "longitude" || k == "lng" {
				continue
			}
			rawAttrs[k] = v
		}
		if attrs, ok := payload["attrs"].(map[string]any); ok {
			for k, v := range attrs {
				rawAttrs[k] = v
			}
		}
		// Flatten nested io for Device Manager vendor keys (io.239).
		if ioMap, ok := rawAttrs["io"].(map[string]any); ok {
			for k, v := range ioMap {
				rawAttrs["io."+k] = v
			}
		}

		fix := store.Fix{
			Lat:            *lat,
			Lon:            *lon,
			RecordedAt:     parseTime(payload["recordedAt"], payload["recorded_at"], payload["utc"], payload["timestamp"]),
			Speed:          asFloat(payload["speed"]),
			Heading:        asFloat(payload["heading"], payload["course"]),
			Odometer:       asFloat(payload["odometer"], payload["odometerKm"]),
			Altitude:       asFloat(payload["altitude"], payload["alt"]),
			SourceProtocol: "json",
			RawAttrs:       rawAttrs,
		}
		if v := asBoolPtr(payload["ignition"]); v != nil {
			fix.Ignition = v
		}
		if sats := asInt(payload["satellites"], payload["sats"]); sats != nil {
			fix.Satellites = sats
		}
		if err := deviceauth.Ingest(reqCtx, st, device, fix); err != nil {
			writeJSON(w, 403, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "imei": device.IMEI})
	})
	srv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	log.Printf("[http] listening on %s (status=partial)", addr)
	err := srv.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

func bearer(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return strings.TrimSpace(r.Header.Get("X-Device-Token"))
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func writeJSON(w http.ResponseWriter, status int, obj any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(obj)
}

func asFloat(vals ...any) *float64 {
	for _, v := range vals {
		switch t := v.(type) {
		case float64:
			x := t
			return &x
		case string:
			f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
			if err == nil {
				return &f
			}
		}
	}
	return nil
}

func asInt(vals ...any) *int {
	for _, v := range vals {
		switch t := v.(type) {
		case float64:
			n := int(t)
			return &n
		case string:
			n, err := strconv.Atoi(strings.TrimSpace(t))
			if err == nil {
				return &n
			}
		}
	}
	return nil
}

func asBool(vals ...any) bool {
	for _, v := range vals {
		switch t := v.(type) {
		case bool:
			if t {
				return true
			}
		case string:
			s := strings.ToLower(strings.TrimSpace(t))
			if s == "1" || s == "true" || s == "yes" {
				return true
			}
		case float64:
			if t != 0 {
				return true
			}
		}
	}
	return false
}

func asBoolPtr(vals ...any) *bool {
	for _, v := range vals {
		switch t := v.(type) {
		case bool:
			b := t
			return &b
		case float64:
			b := t != 0
			return &b
		case string:
			s := strings.ToLower(strings.TrimSpace(t))
			if s == "1" || s == "true" || s == "yes" {
				b := true
				return &b
			}
			if s == "0" || s == "false" || s == "no" {
				b := false
				return &b
			}
		}
	}
	return nil
}

func parseTime(vals ...any) time.Time {
	for _, v := range vals {
		switch t := v.(type) {
		case string:
			s := strings.TrimSpace(t)
			if s == "" {
				continue
			}
			if parsed, err := time.Parse(time.RFC3339, s); err == nil {
				return parsed.UTC()
			}
			if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
				if ms > 1_000_000_000_000 {
					return time.UnixMilli(ms).UTC()
				}
				if ms > 1_000_000_000 {
					return time.Unix(ms, 0).UTC()
				}
			}
		case float64:
			if t > 1_000_000_000_000 {
				return time.UnixMilli(int64(t)).UTC()
			}
			if t > 1_000_000_000 {
				return time.Unix(int64(t), 0).UTC()
			}
		}
	}
	return time.Now().UTC()
}
