package galileosky

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

// Serve Galileosky Easy/Main TCP per official server exchange protocol:
// [0x01][len LE, high bit=archive][tags…][CRC-16 Modbus]; ack = [0x02][crc LE].
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
		lenRaw := binary.LittleEndian.Uint16(hdr[1:3])
		archive := lenRaw&0x8000 != 0
		tagLen := int(lenRaw & 0x7fff)
		if tagLen < 1 || tagLen > 1000 {
			return
		}
		// tags + 2-byte CRC
		body := make([]byte, tagLen+2)
		if _, err := io.ReadFull(conn, body); err != nil {
			return
		}
		tagsBytes := body[:tagLen]
		gotCRC := binary.LittleEndian.Uint16(body[tagLen : tagLen+2])
		packetForCRC := append(append([]byte{}, hdr...), tagsBytes...)
		calc := crc16Modbus(packetForCRC)
		if calc != gotCRC {
			metrics.DecodeErr()
			log.Printf("[galileosky] bad CRC from %s got=%04x want=%04x — ack only, skip ingest", conn.RemoteAddr(), gotCRC, calc)
			_ = writeAck(conn, gotCRC)
			continue
		}

		records := parseTagRecords(tagsBytes)
		if len(records) == 0 {
			records = []map[byte][]byte{parseTags(tagsBytes)}
		}
		ingested := false
		for _, tags := range records {
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
				if archive {
					fix.RawAttrs["archive"] = true
				}
				if len(records) > 1 {
					fix.RawAttrs["record_count"] = len(records)
				}
				for k, v := range tagRaw {
					fix.RawAttrs["tag."+k] = v
				}
				for _, ev := range applyStatusTags(tags, fix.RawAttrs) {
					ev.RecordedAt = fix.RecordedAt
					lat, lon := fix.Lat, fix.Lon
					ev.Lat, ev.Lon = &lat, &lon
					_ = st.InsertSafetyEvent(ctx, device, *ev)
				}
				if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
					log.Printf("[galileosky] ingest %s: %v", imei, err)
				}
				ingested = true
			} else if device != nil && !hasFix && !ingested {
				_ = st.TouchSeen(ctx, device)
				raw := tagsToRaw(tags)
				attrs := map[string]any{"tags": raw}
				for k, v := range raw {
					attrs["tag."+k] = v
				}
				for _, ev := range applyStatusTags(tags, attrs) {
					_ = st.InsertSafetyEvent(ctx, device, *ev)
				}
				_ = st.PatchLastStatus(ctx, device, attrs, nil)
			}
			// Command replies often piggyback on a GPS record (tag 0x30 + E0–E6).
			if device != nil && looksLikeCommandReply(tags) {
				text, ok := formatCommandReply(tags)
				_ = st.AckSoftOrLatest(ctx, device.ID, ok, text)
			}
		}
		if device != nil {
			flushPending(ctx, conn, st, device.ID)
		}
		// Official confirm: header 0x02 + CRC of received packet.
		_ = writeAck(conn, gotCRC)
	}
}

func looksLikeCommandReply(tags map[byte][]byte) bool {
	if len(tags) == 0 {
		return false
	}
	// E0–E6 / 0xFF are command-reply tags even when piggybacked with coords.
	for _, t := range []byte{0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xff} {
		if _, ok := tags[t]; ok {
			return true
		}
	}
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
			_ = st.RequeueCommand(ctx, cmd.ID)
			return
		}
		_ = st.MarkCommandSentCorr(ctx, cmd.ID, store.SoftTextCorr(cmd.PayloadText))
	}
}

func writeAck(conn net.Conn, packetCRC uint16) error {
	buf := []byte{0x02, 0x00, 0x00}
	binary.LittleEndian.PutUint16(buf[1:3], packetCRC)
	_, err := conn.Write(buf)
	return err
}

func fixFromTags(tags map[byte][]byte) (store.Fix, bool) {
	coords, ok := tags[0x30]
	if !ok || len(coords) < 9 {
		return store.Fix{}, false
	}
	// Official: flags(1) + lat int32/1e6 + lon int32/1e6
	flags := coords[0]
	validNibble := (flags >> 4) & 0x0f
	// 0 = GNSS OK, 2 = LBS OK; other = invalid
	if validNibble != 0 && validNibble != 2 {
		return store.Fix{}, false
	}
	sats := int(flags & 0x0f)
	latRaw := int32(binary.LittleEndian.Uint32(coords[1:5]))
	lonRaw := int32(binary.LittleEndian.Uint32(coords[5:9]))
	lat := float64(latRaw) / 1_000_000.0
	lon := float64(lonRaw) / 1_000_000.0

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
		Satellites:     &sats,
		SourceProtocol: "galileosky",
		RawAttrs: map[string]any{
			"gnss.sats": sats,
			"gnss_sats": sats,
		},
	}
	if validNibble == 2 {
		fix.RawAttrs["gnss.lbs"] = true
	} else {
		fix.RawAttrs["gnss.fix"] = true
	}
	if sc, ok := tags[0x33]; ok && len(sc) >= 4 {
		spd := float64(binary.LittleEndian.Uint16(sc[0:2])) / 10.0
		hdg := float64(binary.LittleEndian.Uint16(sc[2:4])) / 10.0
		fix.Speed = &spd
		fix.Heading = &hdg
		fix.RawAttrs["speed.gps"] = spd
		fix.RawAttrs["heading.gps"] = hdg
	}
	if h, ok := tags[0x34]; ok && len(h) >= 2 {
		alt := float64(int16(binary.LittleEndian.Uint16(h[0:2])))
		fix.Altitude = &alt
		fix.RawAttrs["gnss.altitude"] = alt
	}
	if hd, ok := tags[0x35]; ok && len(hd) >= 1 {
		h := float64(hd[0]) / 10.0
		fix.RawAttrs["hdop"] = h
		fix.RawAttrs["gnss.hdop"] = h
	}
	if pd, ok := tags[0x36]; ok && len(pd) >= 1 {
		p := float64(pd[0]) / 10.0
		if len(pd) >= 2 {
			p = float64(binary.LittleEndian.Uint16(pd[0:2])) / 10.0
		}
		fix.RawAttrs["pdop"] = p
		fix.RawAttrs["gnss.pdop"] = p
	}
	// Input status bit0 = input 0 (common ignition wiring); not tag 0x01 (hw version).
	if st, ok := tags[0x46]; ok && len(st) >= 1 {
		b := st[0]&0x01 != 0
		fix.Ignition = &b
		fix.RawAttrs["status.ignition"] = b
		fix.RawAttrs["status.inputs"] = int(st[0])
		for i := 0; i < 8; i++ {
			fix.RawAttrs[fmt.Sprintf("status.din%d", i)] = st[0]&(1<<uint(i)) != 0
		}
		if len(st) >= 2 {
			fix.RawAttrs["status.inputs_hi"] = int(st[1])
			for i := 0; i < 8; i++ {
				fix.RawAttrs[fmt.Sprintf("status.din%d", i+8)] = st[1]&(1<<uint(i)) != 0
			}
		}
	}
	if out, ok := tags[0x47]; ok && len(out) >= 1 {
		fix.RawAttrs["status.outputs"] = int(out[0])
		fix.RawAttrs["output.0"] = out[0]&0x01 != 0
		for i := 0; i < 8; i++ {
			fix.RawAttrs[fmt.Sprintf("status.dout%d", i)] = out[0]&(1<<uint(i)) != 0
		}
		if len(out) >= 2 {
			fix.RawAttrs["status.outputs_hi"] = int(out[1])
			for i := 0; i < 8; i++ {
				fix.RawAttrs[fmt.Sprintf("status.dout%d", i+8)] = out[1]&(1<<uint(i)) != 0
			}
		}
	}
	if odo, ok := tags[0xd4]; ok && len(odo) >= 4 {
		f := float64(binary.LittleEndian.Uint32(odo)) / 1000.0
		fix.Odometer = &f
	}
	// Analog 0x50 often external voltage (mV) on Easy firmwares; 0x51 often backup battery.
	if v, ok := tags[0x50]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		fix.RawAttrs["voltage.ext"] = mv / 1000.0
		fix.RawAttrs["tag.0x50"] = mv
	}
	if v, ok := tags[0x51]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		fix.RawAttrs["voltage.batt"] = mv / 1000.0
		fix.RawAttrs["tag.0x51"] = mv
	}
	promoteSensorTags(fix.RawAttrs, tags)
	return fix, true
}

// promoteSensorTags lifts common fuel/user/analog tags onto remappable keys (partial).
func promoteSensorTags(raw map[string]any, tags map[byte][]byte) {
	if raw == nil || tags == nil {
		return
	}
	if v, ok := tags[0x01]; ok && len(v) >= 1 {
		raw["device.hw"] = int(v[0])
		raw["tag.0x01"] = int(v[0])
	}
	if v, ok := tags[0x02]; ok && len(v) >= 1 {
		raw["device.fw"] = int(v[0])
		raw["tag.0x02"] = int(v[0])
	}
	if v, ok := tags[0x03]; ok && len(v) >= 1 {
		imei := strings.TrimRight(string(v), "\x00 ")
		if imei != "" {
			raw["device.imei"] = imei
			raw["tag.0x03"] = imei
		}
	}
	if v, ok := tags[0x04]; ok && len(v) >= 2 {
		id := int(binary.LittleEndian.Uint16(v[0:2]))
		raw["device.id"] = id
		raw["tag.0x04"] = id
	}
	if v, ok := tags[0x10]; ok && len(v) >= 2 {
		n := int(binary.LittleEndian.Uint16(v[0:2]))
		raw["archive.record"] = n
		raw["tag.0x10"] = n
	}
	if v, ok := tags[0xd4]; ok && len(v) >= 4 {
		n := float64(binary.LittleEndian.Uint32(v[0:4]))
		raw["odometer"] = n
		raw["tag.0xd4"] = n
	}
	if v, ok := tags[0x20]; ok && len(v) >= 4 {
		raw["unix_time"] = int64(binary.LittleEndian.Uint32(v[0:4]))
		raw["tag.0x20"] = raw["unix_time"]
	}
	// 0x52–0x57: additional analog channels (mV → V when plausible).
	for i, id := range []byte{0x52, 0x53, 0x54, 0x55, 0x56, 0x57} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		raw[fmt.Sprintf("analog.%d", i+2)] = mv / 1000.0
		raw[fmt.Sprintf("tag.0x%02x", id)] = mv
	}
	// 0x60–0x63: frequent LLS / fuel sensor payloads (uint32, units model-dependent).
	fuelKeys := []string{"fuel.level", "fuel.level2", "fuel.temp", "fuel.freq"}
	for i, id := range []byte{0x60, 0x61, 0x62, 0x63} {
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fuelKeys[i]] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	// 0x11–0x19: 1-byte user/CAN status nibbles.
	for i, id := range []byte{0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19} {
		v, ok := tags[id]
		if !ok || len(v) < 1 {
			continue
		}
		raw[fmt.Sprintf("user.%d", i)] = int(v[0])
	}
	// 0xd5–0xd7: additional counters (units model-dependent).
	for i, id := range []byte{0xd5, 0xd6, 0xd7} {
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fmt.Sprintf("counter.%d", i+1)] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	// 0x70–0x73: frequent 1-Wire / temp sensor payloads (signed °C×10 on many firmwares).
	for i, id := range []byte{0x70, 0x71, 0x72, 0x73} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		t10 := int16(binary.LittleEndian.Uint16(v[0:2]))
		raw[fmt.Sprintf("temp.%d", i+1)] = float64(t10) / 10.0
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(t10)
	}
	// 0x74–0x7b: additional 1-Wire / humidity-style payloads (model-dependent).
	for i, id := range []byte{0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		n := binary.LittleEndian.Uint16(v[0:2])
		raw[fmt.Sprintf("sensor.%d", i+5)] = float64(n) / 10.0
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(n)
	}
	// 0x64–0x67: frequent CAN / RS485 numeric payloads.
	for i, id := range []byte{0x64, 0x65, 0x66, 0x67} {
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fmt.Sprintf("can.%d", i+1)] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	// 0xC0–0xC3: additional CAN / RS485 channels (4-byte LE).
	for i, id := range []byte{0xc0, 0xc1, 0xc2, 0xc3} {
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fmt.Sprintf("can.%d", i+5)] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	// 0xA0–0xA3: extended analog / sensor payloads (4-byte LE, units model-dependent).
	for i, id := range []byte{0xa0, 0xa1, 0xa2, 0xa3} {
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fmt.Sprintf("analog.%d", i+10)] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	// 0xE0–0xE6: command / text replies (length-prefixed ASCII).
	for _, id := range []byte{0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6} {
		v, ok := tags[id]
		if !ok || len(v) == 0 {
			continue
		}
		s := strings.TrimSpace(string(v))
		if s == "" {
			continue
		}
		raw["cmd.reply"] = s
		raw["cmd.reply_tag"] = fmt.Sprintf("0x%02x", id)
		raw[fmt.Sprintf("tag.0x%02x", id)] = s
		break
	}
	// 0x48: iButton / Dallas key (8-byte id as hex).
	if v, ok := tags[0x48]; ok && len(v) >= 8 {
		raw["ibutton.id"] = fmt.Sprintf("%x", v[:8])
		raw["tag.0x48"] = raw["ibutton.id"]
	}
	// 0x5a: accelerometer axes (signed milli-g or device units).
	if v, ok := tags[0x5a]; ok && len(v) >= 6 {
		raw["accel.x"] = float64(int16(binary.LittleEndian.Uint16(v[0:2])))
		raw["accel.y"] = float64(int16(binary.LittleEndian.Uint16(v[2:4])))
		raw["accel.z"] = float64(int16(binary.LittleEndian.Uint16(v[4:6])))
		raw["tag.0x5a"] = true
	}
	// 0x80–0x87: 8-byte Modbus / RS485 registers (low 4 bytes as uint32 when plausible).
	for i, id := range []byte{0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87} {
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fmt.Sprintf("modbus.%d", i+1)] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
		if len(v) >= 8 {
			raw[fmt.Sprintf("modbus.%d_hi", i+1)] = float64(binary.LittleEndian.Uint32(v[4:8]))
		}
	}
}
