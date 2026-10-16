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

// FindByIMEI looks up a registered device; unknown IMEIs are quarantined, logged, and rate-limited.
// Optional protocol hint is stored on the unassigned row for Admin claim.
func FindByIMEI(ctx context.Context, st *store.Store, imei, remote string, protocol ...string) *store.Device {
	imei = strings.TrimSpace(imei)
	if imei == "" {
		return nil
	}
	proto := "other"
	if len(protocol) > 0 && strings.TrimSpace(protocol[0]) != "" {
		proto = strings.TrimSpace(protocol[0])
	}
	d, err := st.FindByIMEI(ctx, imei)
	if err != nil || d == nil {
		metrics.UnknownIMEI()
		host := hostOf(remote)
		st.TouchUnassigned(ctx, imei, proto, host)
		key := imei + "|" + host
		if !guard.AllowUnknown(key) {
			metrics.UnknownIMEIDrop()
			log.Printf("[auth] drop unknown IMEI %s from %s (rate limit)", imei, remote)
			return nil
		}
		log.Printf("[auth] unknown IMEI %s from %s (quarantined)", imei, remote)
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
