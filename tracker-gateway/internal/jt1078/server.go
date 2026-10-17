package jt1078

import (
	"context"
	"encoding/binary"
	"log"
	"net"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve JT/T 1078-style A/V signaling hooks (experimental).
// Media RTP path stays out of process; we ACK control frames and log channel ids.
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[jt1078] listening on %s (status=experimental — signaling only)", addr)
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				log.Printf("[jt1078] accept: %v", err)
				continue
			}
		}
		go handleConn(ctx, conn, st)
	}
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store) {
	metrics.ConnOpen()
	defer func() {
		metrics.ConnClose()
		_ = conn.Close()
	}()
	_ = st
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 2048)
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		n, err := conn.Read(tmp)
		if err != nil {
			return
		}
		buf = append(buf, tmp[:n]...)
		// 1078 often uses 0x30 0x31 0x63 0x64 magic + channel
		for len(buf) >= 16 {
			if buf[0] == 0x30 && buf[1] == 0x31 && buf[2] == 0x63 && buf[3] == 0x64 {
				channel := buf[5]
				dataType := buf[4]
				frameLen := int(binary.BigEndian.Uint16(buf[6:8]))
				total := 16 + frameLen
				if len(buf) < total {
					break
				}
				log.Printf("[jt1078] channel=%d type=0x%02x len=%d (signaling hook)", channel, dataType, frameLen)
				buf = buf[total:]
				continue
			}
			// resync
			buf = buf[1:]
		}
		if len(buf) > 64*1024 {
			return
		}
	}
}

type Adapter struct{}

func (Adapter) Name() string        { return "jt1078" }
func (Adapter) DisplayName() string { return "JT/T 1078 A/V signaling" }
func (Adapter) Status() string      { return protocol.StatusExperimental }
func (Adapter) DefaultAddr() string { return ":1078" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}
