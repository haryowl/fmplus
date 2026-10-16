package httpingest

import (
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
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func Serve(addr string, st *store.Store) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, metrics.Snapshot())
	})
	mux.HandleFunc("/metrics", metrics.Handler)
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
		ctx := r.Context()
		var device *store.Device
		if token != "" {
			device, _ = st.FindByTokenHash(ctx, hashToken(token))
		}
		if device == nil {
			if imei, _ := payload["imei"].(string); imei != "" {
				device = deviceauth.FindByIMEI(ctx, st, strings.TrimSpace(imei), r.RemoteAddr, "json")
			}
		}
		if device == nil {
			writeJSON(w, 401, map[string]any{"error": "Unknown or disabled device"})
			return
		}
		lat := asFloat(payload["lat"], payload["latitude"])
		lon := asFloat(payload["lon"], payload["lng"], payload["longitude"])
		if lat == nil || lon == nil {
			writeJSON(w, 400, map[string]any{"error": "Invalid lat/lon"})
			return
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
			RawAttrs:       map[string]any{},
		}
		if v, ok := payload["ignition"].(bool); ok {
			fix.Ignition = &v
		}
		if attrs, ok := payload["attrs"].(map[string]any); ok {
			fix.RawAttrs = attrs
		}
		if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
			writeJSON(w, 403, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "imei": device.IMEI})
	})
	log.Printf("[http] listening on %s", addr)
	return http.ListenAndServe(addr, mux)
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
