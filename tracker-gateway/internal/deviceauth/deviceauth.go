package deviceauth

import (
	"context"
	"log"
	"net"
	"strings"

	"github.com/haryowl/fmplus/tracker-gateway/internal/guard"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func hostOf(remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return remote
	}
	return host
}

// FindByIMEI looks up a registered device; unknown IMEIs are logged and rate-limited.
func FindByIMEI(ctx context.Context, st *store.Store, imei, remote string) *store.Device {
	imei = strings.TrimSpace(imei)
	if imei == "" {
		return nil
	}
	d, err := st.FindByIMEI(ctx, imei)
	if err != nil || d == nil {
		metrics.UnknownIMEI()
		key := imei + "|" + hostOf(remote)
		if !guard.AllowUnknown(key) {
			metrics.UnknownIMEIDrop()
			log.Printf("[auth] drop unknown IMEI %s from %s (rate limit)", imei, remote)
			return nil
		}
		log.Printf("[auth] unknown IMEI %s from %s", imei, remote)
		return nil
	}
	return d
}

func Ingest(ctx context.Context, st *store.Store, device *store.Device, fix store.Fix) error {
	if err := st.Ingest(ctx, device, fix); err != nil {
		metrics.FixErr()
		return err
	}
	metrics.FixOK()
	return nil
}
