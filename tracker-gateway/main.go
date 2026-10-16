package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/config"
	"github.com/haryowl/fmplus/tracker-gateway/internal/concox"
	"github.com/haryowl/fmplus/tracker-gateway/internal/galileosky"
	"github.com/haryowl/fmplus/tracker-gateway/internal/httpingest"
	"github.com/haryowl/fmplus/tracker-gateway/internal/jt808"
	"github.com/haryowl/fmplus/tracker-gateway/internal/ruptela"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
	"github.com/haryowl/fmplus/tracker-gateway/internal/teltonika"
)

func main() {
	cfg := config.Load()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	st, err := store.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[tracker-gateway] db: %v", err)
	}
	defer st.Close()

	go serve("teltonika", cfg.TeltonikaAddr, cancel, func() error { return teltonika.Serve(ctx, cfg.TeltonikaAddr, st) })
	go serve("jt808", cfg.JT808Addr, cancel, func() error { return jt808.Serve(ctx, cfg.JT808Addr, st) })
	go serve("concox", cfg.ConcoxAddr, cancel, func() error { return concox.Serve(ctx, cfg.ConcoxAddr, st) })
	go serve("ruptela", cfg.RuptelaAddr, cancel, func() error { return ruptela.Serve(ctx, cfg.RuptelaAddr, st) })
	go serve("galileosky", cfg.GalileoskyAddr, cancel, func() error { return galileosky.Serve(ctx, cfg.GalileoskyAddr, st) })
	go serve("http", cfg.HTTPAddr, cancel, func() error { return httpingest.Serve(cfg.HTTPAddr, st) })

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

	log.Printf(
		"[tracker-gateway] ready http=%s teltonika=%s jt808=%s concox=%s ruptela=%s galileosky=%s",
		cfg.HTTPAddr, cfg.TeltonikaAddr, cfg.JT808Addr, cfg.ConcoxAddr, cfg.RuptelaAddr, cfg.GalileoskyAddr,
	)
	<-ctx.Done()
	log.Printf("[tracker-gateway] shutting down")
}

func serve(name, addr string, cancel context.CancelFunc, fn func() error) {
	if err := fn(); err != nil {
		log.Printf("[%s] stopped (%s): %v", name, addr, err)
		cancel()
	}
}
