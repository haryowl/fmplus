package galileosky

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Galileosky Easy/Main TCP (header 0x01 tag packets).
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[galileosky] listening on %s (status=partial)", addr)
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
				log.Printf("[galileosky] accept: %v", err)
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
	var device *store.Device
	var imei string
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		hdr := make([]byte, 3)
		if _, err := io.ReadFull(conn, hdr); err != nil {
			return
		}
		if hdr[0] != 0x01 {
			continue
		}
		length := int(binary.LittleEndian.Uint16(hdr[1:3]))
		if length < 1 || length > 64*1024 {
			return
		}
		body := make([]byte, length)
		if _, err := io.ReadFull(conn, body); err != nil {
			return
		}
		if length < 2 {
			continue
		}
		payload := body[:length-1]
		payload, compressed := maybeDecompress(hdr[0], payload)
		if compressed {
			log.Printf("[galileosky] compressed packet from %s (experimental — ack only)", conn.RemoteAddr())
			if device != nil {
				_ = st.TouchSeen(ctx, device)
			}
			_ = writeAck(conn)
			continue
		}
		tags := parseTags(payload)
		if v, ok := tags[0x03]; ok && len(v) >= 15 {
			imei = string(v[:15])
			device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "galileosky")
			if device != nil && sessions != nil && bound == nil {
				bound = &protocol.ConnSession{
					DeviceID: device.ID, IMEI: device.IMEI, Protocol: "galileosky", Conn: conn,
				}
				sessions.Bind(bound)
			}
		}
		fix, hasFix := fixFromTags(tags)
		if hasFix && device == nil && imei != "" {
			device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "galileosky")
			if device != nil && sessions != nil && bound == nil {
				bound = &protocol.ConnSession{
					DeviceID: device.ID, IMEI: device.IMEI, Protocol: "galileosky", Conn: conn,
				}
				sessions.Bind(bound)
			}
		}
		if hasFix && device != nil {
			fix.SourceProtocol = "galileosky"
			if fix.RawAttrs == nil {
				fix.RawAttrs = map[string]any{}
			}
			tagRaw := tagsToRaw(tags)
			fix.RawAttrs["tags"] = tagRaw
			for k, v := range tagRaw {
				fix.RawAttrs["tag."+k] = v
			}
			if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
				log.Printf("[galileosky] ingest %s: %v", imei, err)
			}
			flushPending(ctx, conn, st, device.ID)
		} else if device != nil && !hasFix {
			_ = st.TouchSeen(ctx, device)
			// Non-fix uplink (status / command reply tags) closes the sent→acked loop.
			if looksLikeCommandReply(tags) {
				_ = st.AckLatestSent(ctx, device.ID, true, fmt.Sprintf("galileosky tags %v", tagsToRaw(tags)))
			}
			flushPending(ctx, conn, st, device.ID)
		}
		_ = writeAck(conn)
	}
}

func looksLikeCommandReply(tags map[byte][]byte) bool {
	if len(tags) == 0 {
		return false
	}
	// Reply / confirm tags used by various Galileosky firmwares (model-dependent).
	for _, t := range []byte{0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xff} {
		if _, ok := tags[t]; ok {
			return true
		}
	}
	// Any packet with more than just IMEI is treated as a candidate reply.
	if _, onlyIMEI := tags[0x03]; onlyIMEI && len(tags) == 1 {
		return false
	}
	return len(tags) > 0 && !hasCoordTag(tags)
}

func hasCoordTag(tags map[byte][]byte) bool {
	_, ok := tags[0x30]
	return ok
}

func flushPending(ctx context.Context, conn net.Conn, st *store.Store, deviceID string) {
	ad := Adapter{}
	for i := 0; i < 4; i++ {
		cmd, err := st.NextPendingCommand(ctx, deviceID)
		if err != nil || cmd == nil {
			return
		}
		payload, encErr := ad.EncodeDownlink(*cmd)
		if encErr != nil || len(payload) == 0 {
			_ = st.MarkCommandFailed(ctx, cmd.ID, "galileosky encode failed")
			continue
		}
		if _, err := conn.Write(payload); err != nil {
			_ = st.MarkCommandFailed(ctx, cmd.ID, "write failed: "+err.Error())
			return
		}
		_ = st.MarkCommandSent(ctx, cmd.ID)
	}
}

func writeAck(conn net.Conn) error {
	_, err := conn.Write([]byte{0x02, 0x00, 0x00})
	return err
}

func fixFromTags(tags map[byte][]byte) (store.Fix, bool) {
	coords, ok := tags[0x30]
	if !ok || len(coords) < 8 {
		return store.Fix{}, false
	}
	latRaw := int32(binary.LittleEndian.Uint32(coords[0:4]))
	lonRaw := int32(binary.LittleEndian.Uint32(coords[4:8]))
	lat := float64(latRaw) / 1_000_000.0
	lon := float64(lonRaw) / 1_000_000.0
	var sats *int
	if len(coords) >= 9 {
		n := int(coords[8])
		sats = &n
	}
	var recorded time.Time
	if dt, ok := tags[0x20]; ok && len(dt) >= 4 {
		sec := binary.LittleEndian.Uint32(dt[0:4])
		if sec > 1_000_000_000 && sec < 4_000_000_000 {
			recorded = time.Unix(int64(sec), 0).UTC()
		}
	}
	if recorded.IsZero() {
		recorded = time.Now().UTC()
	}
	fix := store.Fix{
		Lat:            lat,
		Lon:            lon,
		RecordedAt:     recorded,
		Satellites:     sats,
		SourceProtocol: "galileosky",
		RawAttrs:       map[string]any{},
	}
	if sc, ok := tags[0x33]; ok && len(sc) >= 2 {
		spd := float64(sc[0])
		hdg := float64(sc[1]) * 2
		fix.Speed = &spd
		fix.Heading = &hdg
	}
	if din, ok := tags[0x01]; ok && len(din) >= 1 {
		b := din[0]&0x01 != 0
		fix.Ignition = &b
	}
	if odo, ok := tags[0xd4]; ok && len(odo) >= 4 {
		f := float64(binary.LittleEndian.Uint32(odo)) / 1000.0
		fix.Odometer = &f
	}
	return fix, true
}
