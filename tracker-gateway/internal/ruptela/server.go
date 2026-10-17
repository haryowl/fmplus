package ruptela

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Ruptela FM TCP (records packet id 1, ACK id 100).
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[ruptela] listening on %s (status=partial)", addr)
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
				log.Printf("[ruptela] accept: %v", err)
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
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		lenBuf := make([]byte, 2)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return
		}
		length := int(binary.BigEndian.Uint16(lenBuf))
		if length < 1 || length > 64*1024 {
			return
		}
		payload := make([]byte, length+2) // data + crc
		if _, err := io.ReadFull(conn, payload); err != nil {
			return
		}
		data := payload[:length]
		if len(data) < 1 {
			continue
		}
		packetID := data[0]
		switch packetID {
		case 1, 7: // classic + dynamic/extended records
			records, imei := parseRecords(data[1:])
			if imei == "" {
				_ = writeAck(conn, 0)
				continue
			}
			device := deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "ruptela")
			if device == nil {
				_ = writeAck(conn, 0)
				continue
			}
			if sessions != nil && bound == nil {
				bound = &protocol.ConnSession{
					DeviceID: device.ID, IMEI: device.IMEI, Protocol: "ruptela", Conn: conn,
				}
				sessions.Bind(bound)
			}
			for _, fix := range records {
				fix.SourceProtocol = "ruptela"
				if ev := safetyFromEventIO(fix); ev != nil {
					_ = st.InsertSafetyEvent(ctx, device, *ev)
				}
				if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
					log.Printf("[ruptela] ingest %s: %v", imei, err)
				}
			}
			_ = writeAck(conn, len(records))
			flushPending(ctx, conn, st, device.ID)
		case 2, 105, 107: // config / command responses (IMEI may be present)
			imei := ""
			if len(data) >= 9 {
				imeiNum := binary.BigEndian.Uint64(data[1:9])
				imei = strconv.FormatUint(imeiNum, 10)
			}
			device := boundDevice(bound)
			if device == nil && imei != "" {
				device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "ruptela")
			}
			if device != nil {
				resp := fmt.Sprintf("ruptela_cmd_%d %x", packetID, data)
				if packetID == 2 && len(data) > 9 {
					resp = string(data[9:])
				}
				_ = st.AckLatestSent(ctx, device.ID, true, strings.TrimSpace(resp))
				_ = st.TouchSeen(ctx, device)
			}
			_ = writeAck(conn, 0)
		default:
			if device := boundDevice(bound); device != nil {
				_ = st.TouchSeen(ctx, device)
			}
			_ = writeAck(conn, 0)
		}
	}
}

func boundDevice(bound *protocol.ConnSession) *store.Device {
	if bound == nil {
		return nil
	}
	// Lightweight stub — callers that need full Device should FindByIMEI; Ack only needs ID.
	return &store.Device{ID: bound.DeviceID, IMEI: bound.IMEI, Protocol: bound.Protocol}
}

func flushPending(ctx context.Context, conn net.Conn, st *store.Store, deviceID string) {
	enc := Adapter{}
	for i := 0; i < 4; i++ {
		cmd, err := st.NextPendingCommand(ctx, deviceID)
		if err != nil || cmd == nil {
			return
		}
		payload, err := enc.EncodeDownlink(*cmd)
		if err != nil || len(payload) == 0 {
			return
		}
		if _, err := conn.Write(payload); err != nil {
			return
		}
		_ = st.MarkCommandSent(ctx, cmd.ID)
	}
}

func writeAck(conn net.Conn, count int) error {
	// length=3, packet id=100, records received (uint16 BE), crc
	body := []byte{100, 0, 0}
	binary.BigEndian.PutUint16(body[1:3], uint16(count))
	crc := crc16IBM(append([]byte{0, 3}, body...))
	out := make([]byte, 0, 7)
	out = append(out, 0, 3)
	out = append(out, body...)
	crcBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(crcBuf, crc)
	out = append(out, crcBuf...)
	_, err := conn.Write(out)
	return err
}

func crc16IBM(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

func parseRecords(data []byte) ([]store.Fix, string) {
	if len(data) < 8 {
		return nil, ""
	}
	imeiNum := binary.BigEndian.Uint64(data[0:8])
	imei := strconv.FormatUint(imeiNum, 10)
	off := 8
	if off >= len(data) {
		return nil, imei
	}
	// some firmwares insert a records-left / flags byte
	count := int(data[off])
	off++
	var fixes []store.Fix
	for i := 0; i < count && off+30 <= len(data); i++ {
		ts := int64(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		// timestamp is unix seconds on classic Ruptela
		lonRaw := int32(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		latRaw := int32(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		// altitude int16, angle uint16, satellites, speed — order varies; use common FM layout:
		// altitude(2) angle(2) satellites(1) speed(2) then IO
		if off+7 > len(data) {
			break
		}
		alt := int16(binary.BigEndian.Uint16(data[off : off+2]))
		off += 2
		angle := binary.BigEndian.Uint16(data[off : off+2])
		off += 2
		sats := int(data[off])
		off++
		speed := binary.BigEndian.Uint16(data[off : off+2])
		off += 2
		ioMap := map[string]any{}
		var eventID any
		if off < len(data) {
			off, eventID, ioMap = extractRuptelaIO(data, off)
		}
		lon := float64(lonRaw) / 1e7
		lat := float64(latRaw) / 1e7
		spd := float64(speed)
		hdg := float64(angle)
		altF := float64(alt)
		raw := map[string]any{
			"io":           ioMap,
			"event_io":     eventID,
			"record_index": i,
		}
		for k, v := range ioMap {
			raw["io."+k] = v
		}
		fix := store.Fix{
			Lat:            lat,
			Lon:            lon,
			RecordedAt:     time.Unix(ts, 0).UTC(),
			Speed:          &spd,
			Heading:        &hdg,
			Altitude:       &altF,
			Satellites:     &sats,
			SourceProtocol: "ruptela",
			RawAttrs:       raw,
		}
		// Common Ruptela IO IDs (model-dependent; Device Manager remaps io.* too).
		if v, ok := ioMap["5"]; ok {
			b := asTruthy(v)
			fix.Ignition = &b
		} else if v, ok := ioMap["239"]; ok {
			b := asTruthy(v)
			fix.Ignition = &b
		}
		if v, ok := ioMap["65"]; ok {
			f := asFloat64(v)
			fix.Odometer = &f
		} else if v, ok := ioMap["199"]; ok {
			f := asFloat64(v) / 1000.0
			fix.Odometer = &f
		}
		fixes = append(fixes, fix)
	}
	return fixes, imei
}

func extractRuptelaIO(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off >= len(b) {
		return off, event, io
	}
	event = int(b[off])
	off++
	if off >= len(b) {
		return off, event, io
	}
	n1 := int(b[off])
	off++
	for i := 0; i < n1 && off+2 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int(b[off])
		off++
	}
	if off >= len(b) {
		return off, event, io
	}
	n2 := int(b[off])
	off++
	for i := 0; i < n2 && off+3 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
	}
	if off >= len(b) {
		return off, event, io
	}
	n4 := int(b[off])
	off++
	for i := 0; i < n4 && off+5 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int64(binary.BigEndian.Uint32(b[off : off+4]))
		off += 4
	}
	if off >= len(b) {
		return off, event, io
	}
	n8 := int(b[off])
	off++
	for i := 0; i < n8 && off+9 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int64(binary.BigEndian.Uint64(b[off : off+8]))
		off += 8
	}
	return off, event, io
}

func asTruthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int:
		return t != 0
	case int64:
		return t != 0
	case float64:
		return t != 0
	default:
		return false
	}
}

func asFloat64(v any) float64 {
	switch t := v.(type) {
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float64:
		return t
	default:
		return 0
	}
}
