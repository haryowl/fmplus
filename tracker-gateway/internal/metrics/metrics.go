package metrics

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"
)

var (
	startedAt          = time.Now().UTC()
	connectionsOpen    atomic.Int64
	connectionsTotal   atomic.Int64
	fixesIngested      atomic.Int64
	ingestErrors       atomic.Int64
	unknownIMEI        atomic.Int64
	unknownIMEIDropped atomic.Int64
	decodeErrors       atomic.Int64
)

func ConnOpen()  { connectionsOpen.Add(1); connectionsTotal.Add(1) }
func ConnClose() { connectionsOpen.Add(-1) }
func FixOK()     { fixesIngested.Add(1) }
func FixErr()    { ingestErrors.Add(1) }
func UnknownIMEI() {
	unknownIMEI.Add(1)
}
func UnknownIMEIDrop() { unknownIMEIDropped.Add(1) }
func DecodeErr()       { decodeErrors.Add(1) }

func Snapshot() map[string]any {
	return map[string]any{
		"ok":                 true,
		"service":            "tracker-gateway",
		"uptimeSec":          int64(time.Since(startedAt).Seconds()),
		"connectionsOpen":    connectionsOpen.Load(),
		"connectionsTotal":   connectionsTotal.Load(),
		"fixesIngested":      fixesIngested.Load(),
		"ingestErrors":       ingestErrors.Load(),
		"unknownImei":        unknownIMEI.Load(),
		"unknownImeiDropped": unknownIMEIDropped.Load(),
		"decodeErrors":       decodeErrors.Load(),
	}
}

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(Snapshot())
}
