package jt809

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve a JT/T 809 platform-exchange listener (experimental framing + login/heartbeat + minimal 0x1200).
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
		go handleConn(ctx, conn, st, sessions)
	}
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry) {
	metrics.ConnOpen()
	var bound *protocol.ConnSession
	defer func() {
		metrics.ConnClose()
		if sessions != nil && bound != nil {
			sessions.Unbind(bound)
		}
		_ = conn.Close()
	}()
	platformKey := conn.RemoteAddr().String()
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		hdr := make([]byte, 22) // JT809 header length (typical)
		if _, err := io.ReadFull(conn, hdr); err != nil {
			return
		}
		length := int(binary.BigEndian.Uint32(hdr[0:4]))
		if length < 22 || length > 2*1024*1024 {
			metrics.DecodeErr()
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
			if len(rest) >= 4 {
				platformKey = fmt.Sprintf("809-%d", binary.BigEndian.Uint32(rest[0:4]))
			}
			bound = &protocol.ConnSession{
				DeviceID: "", // platform link — not a single vehicle
				IMEI:     platformKey,
				Protocol: "jt809",
				Conn:     conn,
				Meta:     map[string]string{"role": "platform"},
			}
			if sessions != nil {
				sessions.Bind(bound)
			}
			resp := make([]byte, 26)
			binary.BigEndian.PutUint32(resp[0:4], 26)
			binary.BigEndian.PutUint16(resp[8:10], 0x1002)
			resp[22] = 0 // result OK
			_, _ = conn.Write(resp)
			log.Printf("[jt809] platform login ok key=%s", platformKey)
		case 0x1005: // heartbeat from subordinate platform
			resp := make([]byte, 22)
			binary.BigEndian.PutUint32(resp[0:4], 22)
			binary.BigEndian.PutUint16(resp[8:10], 0x1006)
			_, _ = conn.Write(resp)
		case 0x1200, 0x1202: // vehicle dynamic / location uplink (experimental)
			fix, plate, ok := parseVehicleUplink(msgID, rest)
			if !ok {
				log.Printf("[jt809] vehicle uplink 0x%04x len=%d (no fix)", msgID, length)
				break
			}
			device := find809Device(ctx, st, plate, platformKey, conn.RemoteAddr().String())
			if device != nil {
				if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
					log.Printf("[jt809] ingest %s: %v", plate, err)
				}
			} else {
				log.Printf("[jt809] vehicle uplink 0x%04x plate=%q (unregistered)", msgID, plate)
			}
		case 0x1400, 0x1402: // vehicle alarm / warn (experimental)
			plate, ev, ok := parseVehicleAlarm(msgID, rest)
			if !ok || ev == nil {
				log.Printf("[jt809] alarm 0x%04x len=%d (no parse)", msgID, length)
				break
			}
			device := find809Device(ctx, st, plate, platformKey, conn.RemoteAddr().String())
			if device != nil {
				_ = st.InsertSafetyEvent(ctx, device, *ev)
				_ = st.PatchLastStatus(ctx, device, ev.RawAttrs, nil)
			} else {
				log.Printf("[jt809] alarm 0x%04x plate=%q type=%s (unregistered)", msgID, plate, ev.AlarmType)
			}
		default:
			log.Printf("[jt809] msg 0x%04x len=%d (experimental — not fully decoded)", msgID, length)
		}
	}
}

func find809Device(ctx context.Context, st *store.Store, plate, platformKey, remote string) *store.Device {
	key := plate
	if key == "" {
		key = platformKey
	}
	device := deviceauth.FindByIMEI(ctx, st, key, remote, "jt809")
	if device == nil && plate != "" {
		device = deviceauth.FindByIMEI(ctx, st, strings.ReplaceAll(plate, " ", ""), remote, "jt809")
	}
	return device
}

type Adapter struct{}

func (Adapter) Name() string        { return "jt809" }
func (Adapter) DisplayName() string { return "JT/T 809 platform exchange" }
func (Adapter) Status() string      { return protocol.StatusExperimental }
func (Adapter) DefaultAddr() string { return ":8090" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}
