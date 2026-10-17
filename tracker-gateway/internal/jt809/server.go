package jt809

import (
	"context"
	"encoding/binary"
	"io"
	"log"
	"net"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve a JT/T 809 platform-exchange listener (experimental framing + login ACK).
// Full MoT interconnect is checklist-driven; this establishes the adapter port.
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[jt809] listening on %s (status=experimental)", addr)
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
				log.Printf("[jt809] accept: %v", err)
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
	_ = st // store reserved for platform vehicle list sync
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		hdr := make([]byte, 22) // JT809 header length (typical)
		if _, err := io.ReadFull(conn, hdr); err != nil {
			return
		}
		// Header starts with length u32 BE in many 809 dialects
		length := int(binary.BigEndian.Uint32(hdr[0:4]))
		if length < 22 || length > 2*1024*1024 {
			return
		}
		rest := make([]byte, length-22)
		if length > 22 {
			if _, err := io.ReadFull(conn, rest); err != nil {
				return
			}
		}
		msgID := binary.BigEndian.Uint16(hdr[8:10])
		switch msgID {
		case 0x1001: // login
			// minimal login response 0x1002
			resp := make([]byte, 26)
			binary.BigEndian.PutUint32(resp[0:4], 26)
			binary.BigEndian.PutUint16(resp[8:10], 0x1002)
			resp[22] = 0 // result OK
			_, _ = conn.Write(resp)
		default:
			log.Printf("[jt809] msg 0x%04x len=%d (experimental — not fully decoded)", msgID, length)
		}
	}
}

type Adapter struct{}

func (Adapter) Name() string        { return "jt809" }
func (Adapter) DisplayName() string { return "JT/T 809 platform exchange" }
func (Adapter) Status() string      { return protocol.StatusExperimental }
func (Adapter) DefaultAddr() string { return ":8090" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}
