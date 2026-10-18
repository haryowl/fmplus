package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"strings"

	"github.com/haryowl/fmplus/tracker-gateway/internal/config"
	"github.com/haryowl/fmplus/tracker-gateway/internal/concox"
	"github.com/haryowl/fmplus/tracker-gateway/internal/dispatch"
	"github.com/haryowl/fmplus/tracker-gateway/internal/galileosky"
	"github.com/haryowl/fmplus/tracker-gateway/internal/httpingest"
	"github.com/haryowl/fmplus/tracker-gateway/internal/jt1078"
	"github.com/haryowl/fmplus/tracker-gateway/internal/jt808"
	"github.com/haryowl/fmplus/tracker-gateway/internal/jt809"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/ruptela"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
	"github.com/haryowl/fmplus/tracker-gateway/internal/subiao"
	"github.com/haryowl/fmplus/tracker-gateway/internal/teltonika"
)

func main() {
	cfg := config.Load()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		log.Fatalf("[tracker-gateway] DATABASE_URL is empty — set it in ../.env.local or the systemd EnvironmentFile")
	}
	st, err := store.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[tracker-gateway] db: %v", err)
	}
	defer st.Close()

	reg := protocol.NewRegistry()
	adapters := []protocol.Adapter{
		teltonika.Adapter{},
		jt808.Adapter{},
		subiao.Adapter{},
		jt809.Adapter{},
		jt1078.Adapter{},
		concox.Adapter{},
		ruptela.Adapter{},
		galileosky.Adapter{},
		httpingest.Adapter{},
	}
	addrs := map[string]string{
		"teltonika":  cfg.TeltonikaAddr,
		"jt808":      cfg.JT808Addr,
		"subiao":     cfg.SuBiaoAddr,
		"jt809":      cfg.JT809Addr,
		"jt1078":     cfg.JT1078Addr,
		"concox":     cfg.ConcoxAddr,
		"ruptela":    cfg.RuptelaAddr,
		"galileosky": cfg.GalileoskyAddr,
		"json":       cfg.HTTPAddr,
	}
	deps := protocol.Deps{Store: st, Sessions: reg}
	for _, a := range adapters {
		reg.Register(a)
		name := a.Name()
		addr := addrs[name]
		if addr == "" {
			addr = a.DefaultAddr()
		}
		ad := a
		adAddr := addr
		go serve(ad.Name(), adAddr, cancel, func() error {
			return ad.Serve(ctx, adAddr, deps)
		})
		log.Printf("[adapter] %s (%s) status=%s addr=%s", ad.DisplayName(), ad.Name(), ad.Status(), adAddr)
	}

	go dispatch.Loop(ctx, st, reg, 2*time.Second)

	go func() {
		t := time.NewTicker(6 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				n, err := st.PruneFixes(ctx, cfg.RetentionDays)
				if err != nil {
					log.Printf("[prune] %v", err)
				} else if n > 0 {
					log.Printf("[prune] deleted %d vehicle_fixes", n)
				}
			}
		}
	}()

	log.Printf("[tracker-gateway] ready — adapters are MVP/partial until certified (see README)")
	<-ctx.Done()
	log.Printf("[tracker-gateway] shutting down")
}

func serve(name, addr string, cancel context.CancelFunc, fn func() error) {
	if err := fn(); err != nil {
		// Keep other adapters (esp. HTTP /healthz) up if one TCP port fails to bind.
		log.Printf("[%s] stopped (%s): %v", name, addr, err)
		if name == "json" {
			cancel()
		}
	}
}
