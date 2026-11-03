package galileosky

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// packetJob is a framed Galileosky packet already confirmed to the device.
// Ingest runs on a per-connection worker so the reader can ACK the next pack
// within the device's ~1s reply window (see device log: Wait reply 0x02…).
type packetJob struct {
	hdr       byte
	archive   bool
	tags      []byte
	packetHex string
	tagsHex   string
	remote    string
}

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
	if tc, ok := conn.(*net.TCPConn); ok {
		_ = tc.SetNoDelay(true)
		_ = tc.SetKeepAlive(true)
		_ = tc.SetKeepAlivePeriod(30 * time.Second)
	}

	var (
		writeMu sync.Mutex
		boundMu sync.Mutex
		bound   *protocol.ConnSession
		device  *store.Device
		imei    string
	)

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[galileosky] panic on %s: %v\n%s", conn.RemoteAddr(), r, debug.Stack())
		}
		metrics.ConnClose()
		boundMu.Lock()
		b := bound
		boundMu.Unlock()
		if sessions != nil && b != nil {
			sessions.Unbind(b)
		}
		_ = conn.Close()
	}()

	ackWrite := func(hdr byte, crc uint16) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return writeAckHdr(conn, hdr, crc)
	}
	connWrite := func(p []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_, err := conn.Write(p)
		return err
	}

	// Reader ACKs immediately; worker ingests so the next pack is not blocked on DB
	// (device reply window is ~1s — log: "Wait reply 0x025CF1" then error 104).
	jobs := make(chan packetJob, 64)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[galileosky] ingest worker panic on %s: %v\n%s", conn.RemoteAddr(), r, debug.Stack())
			}
		}()
		for job := range jobs {
			processPacketJob(ctx, st, sessions, conn, connWrite, &boundMu, &bound, &device, &imei, job)
		}
	}()
	defer func() {
		close(jobs)
		wg.Wait()
	}()

	remote := conn.RemoteAddr().String()
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		hdr := make([]byte, 3)
		if _, err := io.ReadFull(conn, hdr); err != nil {
			return
		}
		lenRaw := binary.LittleEndian.Uint16(hdr[1:3])
		archive := lenRaw&0x8000 != 0
		tagLen := int(lenRaw & 0x7fff)
		// Length field is 15 bits (max 32767). Length 0 is allowed; do not close.
		body := make([]byte, tagLen+2)
		if _, err := io.ReadFull(conn, body); err != nil {
			return
		}
		tagsBytes := body[:tagLen]
		gotCRC := binary.LittleEndian.Uint16(body[tagLen : tagLen+2])
		packetForCRC := append(append([]byte{}, hdr...), tagsBytes...)
		calc := crc16Modbus(packetForCRC)
		crcOK := calc == gotCRC

		// Confirm FIRST (LinuxOHW GalileoSkyParser / appORISNEW) — echo device CRC.
		ackHdr := byte(0x02)
		if hdr[0] == 0x07 {
			ackHdr = 0x07
		}
		if err := ackWrite(ackHdr, gotCRC); err != nil {
			return
		}

		if !crcOK {
			metrics.DecodeErr()
			log.Printf("[galileosky] bad CRC from %s hdr=0x%02x got=%04x want=%04x — acked, skip ingest",
				remote, hdr[0], gotCRC, calc)
			continue
		}
		switch hdr[0] {
		case 0x07, 0x15:
			continue
		}

		tagsCopy := append([]byte(nil), tagsBytes...)
		job := packetJob{
			hdr:       hdr[0],
			archive:   archive,
			tags:      tagsCopy,
			packetHex: fmt.Sprintf("%x", append(append([]byte{}, hdr...), body...)),
			tagsHex:   fmt.Sprintf("%x", tagsCopy),
			remote:    remote,
		}
		select {
		case jobs <- job:
		case <-ctx.Done():
			return
		}
	}
}

func processPacketJob(
	ctx context.Context,
	st *store.Store,
	sessions *protocol.Registry,
	conn net.Conn,
	connWrite func([]byte) error,
	boundMu *sync.Mutex,
	bound **protocol.ConnSession,
	device **store.Device,
	imei *string,
	job packetJob,
) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[galileosky] packet job panic from %s hdr=0x%02x: %v\n%s",
				job.remote, job.hdr, r, debug.Stack())
		}
	}()

	boundMu.Lock()
	dev := *device
	curIMEI := *imei
	boundMu.Unlock()

	if job.hdr == 0x08 {
		if dev == nil {
			return
		}
		fixes := parseCompressedPositions(job.tags, time.Now().UTC())
		sort.SliceStable(fixes, func(i, j int) bool {
			return fixes[i].RecordedAt.Before(fixes[j].RecordedAt)
		})
		for i := range fixes {
			fix := &fixes[i]
			fix.SourceProtocol = "galileosky"
			if fix.RawAttrs == nil {
				fix.RawAttrs = map[string]any{}
			}
			applyPacketMeta(fix.RawAttrs, job.archive, len(fixes))
			if err := deviceauth.Ingest(ctx, st, dev, *fix); err != nil {
				log.Printf("[galileosky] compressed ingest %s: %v", curIMEI, err)
			}
		}
		flushPending(ctx, connWrite, st, dev.ID)
		return
	}

	if job.hdr != 0x01 {
		// Extension / vendor headers: same tag stream as main (LinuxOHW).
		if dev != nil {
			_ = st.PatchLastStatus(ctx, dev, map[string]any{
				"extension_hdr": true,
				"hdr0":          int(job.hdr),
			}, nil)
		}
	}

	records := parseTagRecords(job.tags)
	if len(records) == 0 {
		records = []map[byte][]byte{parseTags(job.tags)}
	}

	for _, tags := range records {
		if v, ok := tags[0x03]; ok && len(v) >= 15 {
			curIMEI = strings.TrimSpace(string(v[:15]))
			break
		}
	}
	if curIMEI != "" {
		found := deviceauth.FindByIMEI(ctx, st, curIMEI, job.remote, "galileosky")
		boundMu.Lock()
		*imei = curIMEI
		*device = found
		dev = found
		if found != nil && sessions != nil {
			if *bound == nil || (*bound).DeviceID != found.ID {
				sess := &protocol.ConnSession{
					DeviceID: found.ID, IMEI: found.IMEI, Protocol: "galileosky", Conn: conn,
				}
				sessions.Bind(sess)
				*bound = sess
			}
		}
		boundMu.Unlock()
	}

	type pendingFix struct {
		fix  store.Fix
		tags map[byte][]byte
	}
	var toIngest []pendingFix
	touched := false
	for _, tags := range records {
		fix, hasFix := fixFromTags(tags)
		deviceTime, hasDeviceTime := deviceTimeFromTags(tags)
		if dev == nil {
			continue
		}
		if hasFix && !hasDeviceTime {
			log.Printf("[galileosky] skip GPS without device time (tag 0x20) imei=%s — likely a split/partial row", curIMEI)
			if !touched {
				_ = st.TouchSeen(ctx, dev)
				touched = true
			}
			continue
		}
		if hasFix {
			toIngest = append(toIngest, pendingFix{fix: fix, tags: tags})
			continue
		}
		if hasDeviceTime {
			toIngest = append(toIngest, pendingFix{
				fix: store.Fix{
					RecordedAt:     deviceTime,
					SourceProtocol: "galileosky",
					RawAttrs:       map[string]any{"gps.valid": false},
				},
				tags: tags,
			})
			continue
		}
		if len(tags) > 0 && !touched {
			_ = st.TouchSeen(ctx, dev)
			touched = true
		}
		if looksLikeCommandReply(tags) {
			text, ok := formatCommandReply(tags)
			_ = st.AckSoftOrLatest(ctx, dev.ID, ok, text)
		}
	}

	sort.SliceStable(toIngest, func(i, j int) bool {
		return toIngest[i].fix.RecordedAt.Before(toIngest[j].fix.RecordedAt)
	})

	for i := range toIngest {
		item := &toIngest[i]
		fix := &item.fix
		tags := item.tags
		fix.SourceProtocol = "galileosky"
		if fix.RawAttrs == nil {
			fix.RawAttrs = map[string]any{}
		}
		fix.RawAttrs["avl.hex"] = job.tagsHex
		fix.RawAttrs["avl.frame_hex"] = job.packetHex
		fix.RawAttrs["avl.bytes"] = len(job.tags)
		tagRaw := tagsToRaw(tags)
		fix.RawAttrs["tags"] = tagRaw
		applyPacketMeta(fix.RawAttrs, job.archive, len(records))
		for k, v := range tagRaw {
			fix.RawAttrs["tag."+k] = v
		}
		promoteSensorTags(fix.RawAttrs, tags)
		for _, ev := range applyStatusTags(tags, fix.RawAttrs) {
			ev.RecordedAt = fix.RecordedAt
			if store.ValidCoords(fix.Lat, fix.Lon) {
				lat, lon := fix.Lat, fix.Lon
				ev.Lat, ev.Lon = &lat, &lon
			}
			_ = st.InsertSafetyEvent(ctx, dev, *ev)
		}
		if err := deviceauth.Ingest(ctx, st, dev, *fix); err != nil {
			log.Printf("[galileosky] ingest %s: %v", curIMEI, err)
		}
		if looksLikeCommandReply(tags) {
			text, ok := formatCommandReply(tags)
			_ = st.AckSoftOrLatest(ctx, dev.ID, ok, text)
		}
	}
	if dev != nil {
		flushPending(ctx, connWrite, st, dev.ID)
	}
}

// applyPacketMeta sets archive / multi-record remappable keys on a fix.
func applyPacketMeta(raw map[string]any, archive bool, numRecords int) {
	if raw == nil {
		return
	}
	if archive {
		raw["archive"] = true
	}
	if numRecords > 1 {
		raw["record_count"] = numRecords
	}
}

func looksLikeCommandReply(tags map[byte][]byte) bool {
	if len(tags) == 0 {
		return false
	}
	// Official command reply uses 0xE0 (cmd id) + 0xE1 (text); optional 0xEB binary.
	// 0xE2–0xE9 are telemetry user-data tags — not command replies.
	if _, ok := tags[0xe1]; ok {
		return true
	}
	if _, ok := tags[0xeb]; ok {
		return true
	}
	if _, ok := tags[0xe0]; ok {
		if _, hasUser := tags[0xe2]; !hasUser {
			return true
		}
	}
	if _, onlyIMEI := tags[0x03]; onlyIMEI && len(tags) == 1 {
		return false
	}
	return false
}

func flushPending(ctx context.Context, write func([]byte) error, st *store.Store, deviceID string) {
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
		if err := write(payload); err != nil {
			_ = st.RequeueCommand(ctx, cmd.ID)
			return
		}
		_ = st.MarkCommandSentCorr(ctx, cmd.ID, store.SoftTextCorr(cmd.PayloadText))
	}
}

func writeAck(conn net.Conn, packetCRC uint16) error {
	return writeAckHdr(conn, 0x02, packetCRC)
}

func writeAckHdr(conn net.Conn, hdr byte, packetCRC uint16) error {
	buf := []byte{hdr, 0x00, 0x00}
	binary.LittleEndian.PutUint16(buf[1:3], packetCRC)
	_, err := conn.Write(buf)
	return err
}

// deviceTimeFromTags reads Galileosky tag 0x20 (unix seconds UTC, device clock)
// plus optional 0x21 milliseconds. It never falls back to server receive time.
func deviceTimeFromTags(tags map[byte][]byte) (time.Time, bool) {
	dt, ok := tags[0x20]
	if !ok || len(dt) < 4 {
		return time.Time{}, false
	}
	sec := binary.LittleEndian.Uint32(dt[0:4])
	if sec <= 1_000_000_000 || sec >= 4_000_000_000 {
		return time.Time{}, false
	}
	recorded := time.Unix(int64(sec), 0).UTC()
	if ms, ok := tags[0x21]; ok && len(ms) >= 2 {
		msec := binary.LittleEndian.Uint16(ms[0:2])
		if msec < 1000 {
			recorded = recorded.Add(time.Duration(msec) * time.Millisecond)
		}
	}
	return recorded, true
}

func fixFromTags(tags map[byte][]byte) (store.Fix, bool) {
	coords, ok := tags[0x30]
	if !ok || len(coords) < 9 {
		return store.Fix{}, false
	}
	// Official: flags(1) + lat int32/1e6 + lon int32/1e6
	flags := coords[0]
	validNibble := (flags >> 4) & 0x0f
	sats := int(flags & 0x0f)
	latRaw := int32(binary.LittleEndian.Uint32(coords[1:5]))
	lonRaw := int32(binary.LittleEndian.Uint32(coords[5:9]))
	lat := float64(latRaw) / 1_000_000.0
	lon := float64(lonRaw) / 1_000_000.0
	coordsOK := store.ValidCoords(lat, lon)
	// 0 = GNSS OK. 2 = LBS (cell) — keep coords for Terminal but never as a map fix.
	gnssOK := validNibble == 0 && coordsOK
	lbsOK := validNibble == 2 && coordsOK
	if !gnssOK && !lbsOK {
		lat, lon = 0, 0
	}

	recorded, _ := deviceTimeFromTags(tags)
	var timeMs int
	if ms, ok := tags[0x21]; ok && len(ms) >= 2 {
		timeMs = int(binary.LittleEndian.Uint16(ms[0:2]))
	}
	fix := store.Fix{
		Lat:            lat,
		Lon:            lon,
		RecordedAt:     recorded,
		Satellites:     &sats,
		SourceProtocol: "galileosky",
		RawAttrs: map[string]any{
			"gnss.sats":         sats,
			"gnss_sats":         sats,
			"gnss.valid_nibble": validNibble,
			"gps.valid":         gnssOK,
		},
	}
	if timeMs > 0 || tags[0x21] != nil {
		fix.RawAttrs["time.ms"] = timeMs
		fix.RawAttrs["tag.0x21"] = timeMs
	}
	if lbsOK {
		fix.RawAttrs["gnss.lbs"] = true
	} else if gnssOK {
		fix.RawAttrs["gnss.fix"] = true
	} else {
		fix.RawAttrs["gnss.invalid"] = true
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
		fix.RawAttrs["tag.0x34"] = alt
	}
	if hd, ok := tags[0x35]; ok && len(hd) >= 1 {
		h := float64(hd[0]) / 10.0
		fix.RawAttrs["hdop"] = h
		fix.RawAttrs["gnss.hdop"] = h
		fix.RawAttrs["tag.0x35"] = h
	}
	if pd, ok := tags[0x36]; ok && len(pd) >= 1 {
		p := float64(pd[0]) / 10.0
		if len(pd) >= 2 {
			p = float64(binary.LittleEndian.Uint16(pd[0:2])) / 10.0
		}
		fix.RawAttrs["pdop"] = p
		fix.RawAttrs["gnss.pdop"] = p
		fix.RawAttrs["tag.0x36"] = p
	}
	if vd, ok := tags[0x37]; ok && len(vd) >= 1 {
		v := float64(vd[0]) / 10.0
		if len(vd) >= 2 {
			v = float64(binary.LittleEndian.Uint16(vd[0:2])) / 10.0
		}
		fix.RawAttrs["vdop"] = v
		fix.RawAttrs["gnss.vdop"] = v
		fix.RawAttrs["tag.0x37"] = v
	}
	// Discrete inputs only. Galileosky has no canonical ignition tag — map in Device Mapper.
	if st, ok := tags[0x46]; ok && len(st) >= 1 {
		fix.RawAttrs["status.inputs"] = int(st[0])
		fix.RawAttrs["tag.0x46"] = int(st[0])
		fix.RawAttrs["status.tag.0x46"] = int(st[0])
		for i := 0; i < 8; i++ {
			fix.RawAttrs[fmt.Sprintf("status.din%d", i)] = st[0]&(1<<uint(i)) != 0
		}
		if len(st) >= 2 {
			fix.RawAttrs["status.inputs_hi"] = int(st[1])
			comp := int(st[0]) | (int(st[1]) << 8)
			fix.RawAttrs["tag.0x46"] = comp
			fix.RawAttrs["status.tag.0x46"] = comp
			for i := 0; i < 8; i++ {
				fix.RawAttrs[fmt.Sprintf("status.din%d", i+8)] = st[1]&(1<<uint(i)) != 0
			}
		}
	}
	// Official outputs are tag 0x45 (not 0x47 EcoDrive). applyStatusTags also fills dout*.
	if out, ok := tags[0x45]; ok && len(out) >= 1 {
		fix.RawAttrs["status.outputs"] = int(out[0])
		fix.RawAttrs["tag.0x45"] = int(out[0])
		fix.RawAttrs["status.tag.0x45"] = int(out[0])
		fix.RawAttrs["output.0"] = out[0]&0x01 != 0
		for i := 0; i < 8; i++ {
			fix.RawAttrs[fmt.Sprintf("status.dout%d", i)] = out[0]&(1<<uint(i)) != 0
		}
		if len(out) >= 2 {
			fix.RawAttrs["status.outputs_hi"] = int(out[1])
			comp := int(out[0]) | (int(out[1]) << 8)
			fix.RawAttrs["tag.0x45"] = comp
			fix.RawAttrs["status.tag.0x45"] = comp
			for i := 0; i < 8; i++ {
				fix.RawAttrs[fmt.Sprintf("status.dout%d", i+8)] = out[1]&(1<<uint(i)) != 0
			}
		}
	}
	if odo, ok := tags[0xd4]; ok && len(odo) >= 4 {
		f := float64(binary.LittleEndian.Uint32(odo)) / 1000.0
		fix.Odometer = &f
	}
	// Prefer official 0x41/0x42 supply/battery mV; fall back to analog inputs 0x50/0x51.
	if v, ok := tags[0x41]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		fix.RawAttrs["voltage.supply"] = mv / 1000.0
		fix.RawAttrs["voltage.ext"] = mv / 1000.0
		fix.RawAttrs["tag.0x41"] = mv
	} else if v, ok := tags[0x50]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		fix.RawAttrs["voltage.ext"] = mv / 1000.0
		fix.RawAttrs["tag.0x50"] = mv
	}
	if v, ok := tags[0x42]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		fix.RawAttrs["voltage.batt"] = mv / 1000.0
		fix.RawAttrs["tag.0x42"] = mv
	} else if v, ok := tags[0x51]; ok && len(v) >= 2 {
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
	// 0x21: milliseconds of the unix second (official newer tag; 2 bytes, 0–999).
	if v, ok := tags[0x21]; ok && len(v) >= 2 {
		ms := int(binary.LittleEndian.Uint16(v[0:2]))
		raw["time.ms"] = ms
		raw["tag.0x21"] = ms
	}
	// 0x33–0x35: speed/course, height, HDOP (official §8) — cook even without 0x30.
	if v, ok := tags[0x33]; ok && len(v) >= 4 {
		spd := float64(binary.LittleEndian.Uint16(v[0:2])) / 10.0
		hdg := float64(binary.LittleEndian.Uint16(v[2:4])) / 10.0
		raw["speed.gps"] = spd
		raw["heading.gps"] = hdg
	}
	if v, ok := tags[0x34]; ok && len(v) >= 2 {
		alt := float64(int16(binary.LittleEndian.Uint16(v[0:2])))
		raw["gnss.altitude"] = alt
		raw["tag.0x34"] = alt
	}
	if v, ok := tags[0x35]; ok && len(v) >= 1 {
		h := float64(v[0]) / 10.0
		raw["hdop"] = h
		raw["gnss.hdop"] = h
		raw["tag.0x35"] = h
	}
	// 0x41 / 0x42: supply / battery mV → V (official).
	if v, ok := tags[0x41]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		raw["voltage.supply"] = mv / 1000.0
		raw["voltage.ext"] = mv / 1000.0
		raw["tag.0x41"] = mv
	}
	if v, ok := tags[0x42]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		raw["voltage.batt"] = mv / 1000.0
		raw["tag.0x42"] = mv
	}
	if v, ok := tags[0x48]; ok && len(v) >= 2 {
		st := int(binary.LittleEndian.Uint16(v[0:2]))
		raw["status.extended"] = st
		raw["tag.0x48"] = st
	}
	// 0x50–0x51: analog inputs 0/1 (mV → V) when not already taken as supply/batt.
	for i, id := range []byte{0x50, 0x51} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		raw[fmt.Sprintf("analog.%d", i)] = mv / 1000.0
		if _, has := raw[fmt.Sprintf("tag.0x%02x", id)]; !has {
			raw[fmt.Sprintf("tag.0x%02x", id)] = mv
		}
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
	// 0x60–0x62: RS485 DUT level (uint16). 0x63–0x6F: fuel uint16 + temp int8.
	for i, id := range []byte{0x60, 0x61, 0x62} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		n := binary.LittleEndian.Uint16(v[0:2])
		raw[fmt.Sprintf("fuel.level%d", i)] = float64(n)
		if i == 0 {
			raw["fuel.level"] = float64(n)
		}
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(n)
	}
	for i := 0; i < 13; i++ {
		id := byte(0x63 + i)
		v, ok := tags[id]
		if !ok || len(v) < 3 {
			continue
		}
		lvl := binary.LittleEndian.Uint16(v[0:2])
		temp := int(int8(v[2]))
		raw[fmt.Sprintf("rs485.%d.level", i+3)] = float64(lvl)
		raw[fmt.Sprintf("rs485.%d.temp", i+3)] = float64(temp)
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(lvl)
		if i == 0 {
			raw["fuel.temp"] = float64(temp)
		}
	}
	// 0xd5: iButton attached bitmask. 0xd6–0xda: 2-byte CAN16 / axle / OBD.
	if v, ok := tags[0xd5]; ok && len(v) >= 1 {
		raw["ibutton.mask"] = int(v[0])
		raw["tag.0xd5"] = int(v[0])
	}
	for i, id := range []byte{0xd6, 0xd7, 0xd8, 0xd9, 0xda} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		n := binary.LittleEndian.Uint16(v[0:2])
		raw[fmt.Sprintf("can16.%d", i)] = float64(n)
		// Official axle-load option: value ÷ 2 → kg.
		raw[fmt.Sprintf("axle.load%d", i+1)] = float64(n) / 2.0
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(n)
	}
	// 0xDB–0xDF: CAN32 / engine hours (/100) / fuel L (/10).
	if v, ok := tags[0xdb]; ok && len(v) >= 4 {
		n := binary.LittleEndian.Uint32(v[0:4])
		raw["can32.0"] = float64(n)
		raw["engine.hours"] = float64(n) / 100.0
		raw["tag.0xdb"] = n
	}
	if v, ok := tags[0xdc]; ok && len(v) >= 4 {
		n := binary.LittleEndian.Uint32(v[0:4])
		raw["can32.1"] = float64(n)
		raw["can.fuel_l"] = float64(n) / 10.0
		raw["tag.0xdc"] = n
	}
	for i, id := range []byte{0xdd, 0xde, 0xdf} {
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fmt.Sprintf("can32.%d", i+2)] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	// 0x70–0x77: thermometer id (u8) + temp °C (int8) — official example 01 10 → 16°C.
	for i, id := range []byte{0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		raw[fmt.Sprintf("temp.%d.id", i)] = int(v[0])
		raw[fmt.Sprintf("temp.%d", i+1)] = float64(int8(v[1]))
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(int8(v[1]))
	}
	// 0xC0–0xC3: CAN_A0/A1/B0/B1 — cook per official §8 formulas.
	if v, ok := tags[0xc0]; ok && len(v) >= 4 {
		n := binary.LittleEndian.Uint32(v[0:4])
		raw["tag.0xc0"] = n
		raw["can.0"] = float64(n)
		raw["can.fuel_used"] = float64(n) / 2.0 // litres
	}
	if v, ok := tags[0xc1]; ok && len(v) >= 4 {
		// Official example FA 72 50 25 → fuel 100%, coolant 74°C, RPM 1194.
		raw["tag.0xc1"] = binary.LittleEndian.Uint32(v[0:4])
		raw["can.1"] = float64(binary.LittleEndian.Uint32(v[0:4]))
		raw["can.fuel_level"] = float64(v[0]) * 0.4
		raw["can.coolant_temp"] = float64(v[1]) - 40.0
		raw["can.rpm"] = float64(binary.LittleEndian.Uint16(v[2:4])) * 0.125
	}
	if v, ok := tags[0xc2]; ok && len(v) >= 4 {
		n := binary.LittleEndian.Uint32(v[0:4])
		raw["tag.0xc2"] = n
		raw["can.2"] = float64(n)
		raw["can.mileage"] = float64(n) * 5.0 // metres
	}
	if v, ok := tags[0xc3]; ok && len(v) >= 4 {
		n := binary.LittleEndian.Uint32(v[0:4])
		raw["can.3"] = float64(n)
		raw["tag.0xc3"] = n
	}
	// 0x58/0x59 RS232; 0x88–0x8C signed DUT temp / weight.
	for i, id := range []byte{0x58, 0x59} {
		v, ok := tags[id]
		if !ok || len(v) < 2 {
			continue
		}
		n := int(binary.LittleEndian.Uint16(v[0:2]))
		raw[fmt.Sprintf("rs232.%d", i)] = n
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	for i, id := range []byte{0x88, 0x89, 0x8a, 0x8b, 0x8c} {
		v, ok := tags[id]
		if !ok || len(v) < 1 {
			continue
		}
		t := float64(int8(v[0]))
		raw[fmt.Sprintf("dut.temp%d", i)] = t
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(int8(v[0]))
	}
	// 0xC4–0xCF / 0xD0–0xD2 / 0xA0–0xAF: CAN8BITR (1-byte).
	for i := 0; i < 12; i++ {
		id := byte(0xc4 + i)
		v, ok := tags[id]
		if !ok || len(v) < 1 {
			continue
		}
		raw[fmt.Sprintf("can8.%d", i)] = int(v[0])
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(v[0])
	}
	for i, id := range []byte{0xd0, 0xd1, 0xd2} {
		v, ok := tags[id]
		if !ok || len(v) < 1 {
			continue
		}
		raw[fmt.Sprintf("can8.%d", i+12)] = int(v[0])
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(v[0])
	}
	for i := 0; i < 16; i++ {
		id := byte(0xa0 + i)
		v, ok := tags[id]
		if !ok || len(v) < 1 {
			continue
		}
		raw[fmt.Sprintf("can8r.%d", i+15)] = int(v[0])
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(v[0])
	}
	// 0xE2–0xE9: official user data (4-byte LE uint32 each).
	for i := 0; i < 8; i++ {
		id := byte(0xe2 + i)
		v, ok := tags[id]
		if !ok || len(v) < 4 {
			continue
		}
		n := binary.LittleEndian.Uint32(v[0:4])
		raw[fmt.Sprintf("user.%d", i)] = float64(n)
		raw[fmt.Sprintf("tag.0x%02x", id)] = n
	}
	if v, ok := tags[0xea]; ok && len(v) > 0 {
		raw["user.array_hex"] = fmt.Sprintf("%x", v)
		raw["tag.0xea"] = raw["user.array_hex"]
	}
	// 0xE0 / 0xE1: command channel (not user data).
	if v, ok := tags[0xe0]; ok && len(v) >= 4 {
		raw["cmd.id"] = int(binary.LittleEndian.Uint32(v[0:4]))
		raw["tag.0xe0"] = raw["cmd.id"]
	}
	if v, ok := tags[0xe1]; ok && len(v) > 0 {
		s := strings.TrimSpace(string(v))
		if s != "" {
			raw["cmd.reply"] = s
			raw["cmd.reply_tag"] = "0xe1"
			raw["tag.0xe1"] = s
		}
	}
	if _, hasE1 := raw["cmd.reply"]; !hasE1 {
		if v, ok := tags[0xeb]; ok && len(v) > 0 {
			s := strings.TrimSpace(string(v))
			if s != "" && isMostlyPrintable(s) {
				raw["cmd.reply"] = s
				raw["cmd.reply_tag"] = "0xeb"
			}
			raw["tag.0xeb"] = fmt.Sprintf("%x", v)
		}
	}
	// 0xFE: extended tags (Modbus / Bluetooth / GSM cell).
	if v, ok := tags[0xfe]; ok && len(v) > 0 {
		raw["tag.0xfe"] = true
		for k, val := range parseExtendedFE(v) {
			raw[k] = val
		}
	}
	// 0x90 / 0xd3: iButton identifiers (4-byte).
	if v, ok := tags[0x90]; ok && len(v) >= 4 {
		raw["ibutton.id"] = fmt.Sprintf("%x", v[:4])
		raw["tag.0x90"] = raw["ibutton.id"]
	}
	if v, ok := tags[0xd3]; ok && len(v) >= 4 {
		raw["ibutton.id2"] = fmt.Sprintf("%x", v[:4])
		raw["tag.0xd3"] = raw["ibutton.id2"]
	}
	// 0x5a: REP-500 energy counter (uint32).
	if v, ok := tags[0x5a]; ok && len(v) >= 4 {
		n := binary.LittleEndian.Uint32(v[0:4])
		raw["energy.rep500"] = float64(n)
		raw["tag.0x5a"] = n
	}
	// 0x80–0x87: DS1923 id + temp°C + humidity (×100/255).
	for i, id := range []byte{0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87} {
		v, ok := tags[id]
		if !ok || len(v) < 3 {
			continue
		}
		raw[fmt.Sprintf("ds1923.%d.id", i)] = int(v[0])
		raw[fmt.Sprintf("ds1923.%d.temp", i)] = float64(int8(v[1]))
		hum := float64(v[2]) * 100.0 / 255.0
		raw[fmt.Sprintf("ds1923.%d.humidity", i)] = hum
		raw[fmt.Sprintf("tag.0x%02x", id)] = int(int8(v[1]))
	}
}
