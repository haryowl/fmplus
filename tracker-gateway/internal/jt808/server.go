package jt808

import (
	"context"
	"encoding/binary"
	"encoding/hex"
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

// Serve JT/T 808 (partial: register/auth/heartbeat/location+TLV/batch). protocolLabel e.g. jt808|subiao.
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	return serveLabeled(ctx, addr, st, sessions, "jt808")
}

func ServeSuBiao(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	return serveLabeled(ctx, addr, st, sessions, "subiao")
}

func serveLabeled(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry, label string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[%s] listening on %s (status=partial)", label, addr)
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
				log.Printf("[%s] accept: %v", label, err)
				continue
			}
		}
		go handleConn(ctx, conn, st, sessions, label)
	}
}

type session struct {
	phone       string
	device      *store.Device
	seq         uint16
	label       string
	bound       *protocol.ConnSession
	subpkgs     *subpkgTracker
	version2019 bool
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry, label string) {
	metrics.ConnOpen()
	sess := &session{label: label, subpkgs: newSubpkgTracker()}
	defer func() {
		metrics.ConnClose()
		if sessions != nil && sess.bound != nil {
			sessions.Unbind(sess.bound)
		}
		_ = conn.Close()
	}()
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 2048)
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		n, err := conn.Read(tmp)
		if err != nil {
			if err != io.EOF {
				log.Printf("[%s] read: %v", label, err)
			}
			return
		}
		buf = append(buf, tmp[:n]...)
		for {
			frame, rest, ok := takeFrame(buf)
			buf = rest
			if !ok {
				break
			}
			if err := handleFrame(ctx, conn, st, sessions, sess, frame); err != nil {
				log.Printf("[%s] frame: %v", label, err)
			}
			tryFlushCommands(ctx, conn, st, sessions, sess)
		}
		if len(buf) > 64*1024 {
			return
		}
	}
}

func takeFrame(buf []byte) (frame []byte, rest []byte, ok bool) {
	start := -1
	for i, b := range buf {
		if b == 0x7e {
			start = i
			break
		}
	}
	if start < 0 {
		return nil, nil, false
	}
	if start > 0 {
		buf = buf[start:]
	}
	end := -1
	for i := 1; i < len(buf); i++ {
		if buf[i] == 0x7e {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, buf, false
	}
	return buf[: end+1], buf[end+1:], true
}

func unescape(frame []byte) []byte {
	if len(frame) < 2 {
		return nil
	}
	inner := frame[1 : len(frame)-1]
	out := make([]byte, 0, len(inner))
	for i := 0; i < len(inner); i++ {
		if inner[i] == 0x7d && i+1 < len(inner) {
			if inner[i+1] == 0x02 {
				out = append(out, 0x7e)
				i++
				continue
			}
			if inner[i+1] == 0x01 {
				out = append(out, 0x7d)
				i++
				continue
			}
		}
		out = append(out, inner[i])
	}
	return out
}

func escape(raw []byte) []byte {
	out := make([]byte, 0, len(raw)+8)
	out = append(out, 0x7e)
	for _, b := range raw {
		if b == 0x7e {
			out = append(out, 0x7d, 0x02)
		} else if b == 0x7d {
			out = append(out, 0x7d, 0x01)
		} else {
			out = append(out, b)
		}
	}
	out = append(out, 0x7e)
	return out
}

func bcc(b []byte) byte {
	var x byte
	for _, v := range b {
		x ^= v
	}
	return x
}

func bcdPhone(b []byte) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, len(b)*2)
	for _, v := range b {
		out = append(out, hex[v>>4], hex[v&0x0f])
	}
	// trim leading zeros for IMEI-like match flexibility
	s := string(out)
	for len(s) > 1 && s[0] == '0' {
		s = s[1:]
	}
	return s
}

func bindSession(sessions *protocol.Registry, sess *session, conn net.Conn) {
	if sessions == nil || sess.device == nil {
		return
	}
	meta := map[string]string{"phone": sess.phone, "seq": fmt.Sprintf("%d", sess.seq)}
	if sess.version2019 {
		meta["jt808_ver"] = "2019"
	}
	bound := &protocol.ConnSession{
		DeviceID: sess.device.ID,
		IMEI:     sess.device.IMEI,
		Protocol: sess.label,
		Conn:     conn,
		Meta:     meta,
	}
	if sess.bound != nil {
		sessions.Unbind(sess.bound)
	}
	sess.bound = bound
	sessions.Bind(bound)
}

func tryFlushCommands(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry, sess *session) {
	if sess.device == nil || sess.phone == "" {
		return // peek-then-claim: never claim until phone is known
	}
	for i := 0; i < 8; i++ {
		cmd, err := st.NextPendingCommand(ctx, sess.device.ID)
		if err != nil || cmd == nil {
			return
		}
		payload := encodeJT808DownlinkVer(sess.phone, &sess.seq, cmd, sess.version2019)
		if len(payload) == 0 {
			_ = st.MarkCommandFailed(ctx, cmd.ID, "jt808 empty downlink")
			continue
		}
		if _, err := conn.Write(payload); err != nil {
			_ = st.RequeueCommand(ctx, cmd.ID)
			return
		}
		corr := DownlinkCorrID(payload)
		if corr == "" {
			corr = fmt.Sprintf("%d", sess.seq)
		}
		_ = st.MarkCommandSentCorr(ctx, cmd.ID, corr)
		if sess.bound != nil && sess.bound.Meta != nil {
			sess.bound.Meta["seq"] = fmt.Sprintf("%d", sess.seq)
			if sess.version2019 {
				sess.bound.Meta["jt808_ver"] = "2019"
			}
		}
	}
}

// wrap8105Flag maps Admin text/hex to JT808 0x8105 terminal control command byte.
func wrap8105Flag(payloadHex, text string) byte {
	if payloadHex != "" {
		if b, err := hex.DecodeString(payloadHex); err == nil && len(b) > 0 {
			return b[0]
		}
	}
	switch strings.ToLower(strings.TrimSpace(text)) {
	case "0", "upgrade", "wireless_upgrade":
		return 0
	case "1", "connect_upgrade":
		return 1
	case "2", "shutdown", "power_off":
		return 2
	case "3", "reset", "reboot":
		return 3
	case "4", "factory", "restore":
		return 4
	case "5", "close_data", "close_comm":
		return 5
	case "6", "close_wireless", "airplane":
		return 6
	default:
		if text == "" {
			return 3 // safe default: reset
		}
		if n, err := strconv.Atoi(text); err == nil && n >= 0 && n <= 255 {
			return byte(n)
		}
		return 3
	}
}

// wrap8106Body builds 0x8106 designated-param query: N×DWORD ids (no leading count).
func wrap8106Body(raw []byte, text string) []byte {
	if len(raw) > 0 {
		if len(raw)%4 == 0 {
			return raw
		}
		// Strip leading count byte from 8104-style payload when present.
		if len(raw) >= 1 && int(raw[0])*4+1 == len(raw) {
			return raw[1:]
		}
		return raw
	}
	t := strings.TrimSpace(text)
	if t == "" || t == "all" || t == "*" {
		return nil
	}
	parts := strings.FieldsFunc(t, func(r rune) bool {
		return r == ',' || r == ' ' || r == ';'
	})
	out := make([]byte, 0, 4*len(parts))
	for _, p := range parts {
		p = strings.TrimPrefix(strings.ToLower(p), "0x")
		if p == "" {
			continue
		}
		for len(p) < 8 {
			p = "0" + p
		}
		if len(p) > 8 {
			p = p[len(p)-8:]
		}
		b, err := hex.DecodeString(p)
		if err != nil || len(b) != 4 {
			continue
		}
		out = append(out, b...)
	}
	return out
}

// wrap8108Body builds a partial 0x8108 upgrade notify (type + mfr + version; package len 0).
// text: "type=0,mfr=MFR01,ver=1.2.3" | "0,MFR01,1.2.3" | plain version string.
// Full package blobs: pass PayloadHex.
func wrap8108Body(text string) []byte {
	typ := byte(0)
	mfr, ver := "", ""
	t := strings.TrimSpace(text)
	lower := strings.ToLower(t)
	if strings.Contains(lower, "=") {
		for _, part := range strings.Split(t, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.ToLower(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "type", "t":
				if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
					typ = byte(n)
				}
			case "mfr", "manufacturer", "maker":
				mfr = v
			case "ver", "version", "v":
				ver = v
			}
		}
	} else if t != "" {
		parts := strings.SplitN(t, ",", 3)
		if n, err := strconv.Atoi(strings.TrimSpace(parts[0])); err == nil && n >= 0 && n <= 255 {
			typ = byte(n)
			if len(parts) >= 2 {
				mfr = strings.TrimSpace(parts[1])
			}
			if len(parts) >= 3 {
				ver = strings.TrimSpace(parts[2])
			}
		} else {
			ver = t
		}
	}
	mfrB := make([]byte, 5)
	copy(mfrB, []byte(mfr))
	vb := []byte(ver)
	if len(vb) > 255 {
		vb = vb[:255]
	}
	body := append([]byte{typ}, mfrB...)
	body = append(body, byte(len(vb)))
	body = append(body, vb...)
	body = append(body, 0, 0, 0, 0) // package length = 0 (metadata-only notify)
	return body
}

// wrap8104Body builds 0x8104 query body: count + DWORD ids from hex, or all (0).
func wrap8104Body(raw []byte, text string) []byte {
	if len(raw) == 0 && (text == "" || text == "all" || text == "*") {
		return []byte{0}
	}
	if len(raw) == 0 {
		// Allow comma-separated hex DWORDs in text: "0001,0002"
		parts := strings.FieldsFunc(text, func(r rune) bool {
			return r == ',' || r == ' ' || r == ';'
		})
		ids := make([]byte, 0, 1+4*len(parts))
		ids = append(ids, 0) // count placeholder
		n := 0
		for _, p := range parts {
			p = strings.TrimPrefix(strings.ToLower(p), "0x")
			if len(p) == 0 {
				continue
			}
			for len(p) < 8 {
				p = "0" + p
			}
			if len(p) > 8 {
				p = p[len(p)-8:]
			}
			b, err := hex.DecodeString(p)
			if err != nil || len(b) != 4 {
				continue
			}
			ids = append(ids, b...)
			n++
		}
		if n == 0 {
			return []byte{0}
		}
		ids[0] = byte(n)
		return ids
	}
	if len(raw) >= 1 && int(raw[0])*4+1 == len(raw) {
		return raw
	}
	if len(raw)%4 == 0 && len(raw) > 0 {
		out := append([]byte{byte(len(raw) / 4)}, raw...)
		return out
	}
	return append([]byte{0}, raw...)
}

// wrap8103Body uses admin hex as-is when it already has a valid param count+TLVs;
// otherwise prepends count=1 (single TLV paste from Device Manager).
func wrap8103Body(raw []byte) []byte {
	if len(raw) == 0 {
		return []byte{0}
	}
	if looksLike8103Body(raw) {
		return raw
	}
	return append([]byte{1}, raw...)
}

func looksLike8103Body(raw []byte) bool {
	n := int(raw[0])
	if n < 1 || n > 64 {
		return false
	}
	i := 1
	for p := 0; p < n; p++ {
		if i+5 > len(raw) {
			return false
		}
		l := int(raw[i+4])
		i += 5 + l
		if i > len(raw) {
			return false
		}
	}
	return i == len(raw)
}

func encodeJT808Downlink(phone string, seq *uint16, cmd *store.Command) []byte {
	return encodeJT808DownlinkVer(phone, seq, cmd, false)
}

func encodeJT808DownlinkVer(phone string, seq *uint16, cmd *store.Command, v2019 bool) []byte {
	if cmd == nil {
		return nil
	}
	text := cmd.PayloadText
	if text == "" {
		text = string(cmd.PayloadBytes())
	}
	var msgID uint16 = 0x8300
	var body []byte
	switch cmd.CommandType {
	case "jt808_8103", "param":
		msgID = 0x8103
		raw := cmd.PayloadBytes()
		if len(raw) == 0 {
			raw = []byte(text)
		}
		body = wrap8103Body(raw)
	case "jt808_8104", "query_params":
		// Body: count(BYTE) + N×DWORD param ids; empty / "all" → count=0 (query all).
		msgID = 0x8104
		var raw []byte
		if cmd.PayloadHex != "" {
			raw = cmd.PayloadBytes()
		}
		body = wrap8104Body(raw, text)
	case "jt808_8106", "query_param_ids":
		// Query designated params — body is N×DWORD ids (no count byte).
		msgID = 0x8106
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = wrap8106Body(raw, "")
				break
			}
		}
		body = wrap8106Body(nil, text)
	case "jt808_8107", "query_attrs":
		msgID = 0x8107
		body = nil // empty body
	case "jt808_8108", "terminal_upgrade":
		// Terminal upgrade package notify (pairs with 0x0108 result).
		msgID = 0x8108
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8108Body(text)
	case "jt808_8201", "query_location":
		// Platform queries terminal location; empty body (terminal replies 0x0201).
		msgID = 0x8201
		body = nil
	case "jt808_8105", "terminal_control":
		// 0x8105: command byte + optional parameter bytes (hex multi-byte or flag alias).
		msgID = 0x8105
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = []byte{wrap8105Flag("", text)}
	case "jt808_8500", "control", "vehicle_control":
		msgID = 0x8500
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw // full body when multi-byte control extensions
				break
			}
		}
		flag := byte(0)
		if text == "1" || text == "cut" || text == "oil_cut" {
			flag = 1
		}
		body = []byte{flag}
	case "jt808_8801", "camera":
		// Camera immediate shoot / record (pairs with 0x0805 response).
		msgID = 0x8801
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8801Body(text)
	case "jt808_8802", "multimedia_retrieve":
		// Stored multimedia retrieval (pairs with 0x0802 response).
		msgID = 0x8802
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8802Body(text)
	case "jt808_8805", "multimedia_upload":
		// Single stored multimedia upload/retrieve by media id (DWORD).
		msgID = 0x8805
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8805Body(text)
	case "jt808_8803", "multimedia_control":
		// Multimedia upload control: type + channel + cmd (0=stop, 1=start).
		msgID = 0x8803
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8803Body(text)
	case "jt808_8804", "record_audio":
		// Recording start/stop (cmd + duration + save + sample rate).
		msgID = 0x8804
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8804Body(text)
	case "jt808_8900", "transparent":
		// Downlink transparent transmission: type BYTE + content.
		msgID = 0x8900
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8900Body(text)
	case "jt808_8202", "track":
		// Temporary location tracking: interval(WORD sec) + validity(DWORD sec).
		msgID = 0x8202
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8202Body(text)
	case "jt808_8702", "driver_query":
		// Request driver identity upload — empty body; terminal replies 0x0702.
		msgID = 0x8702
		body = nil
	case "jt808_8700", "driving_record":
		// Driving record collect command — BYTE cmd (+ optional params as hex).
		msgID = 0x8700
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = []byte{wrap8700Cmd(text)}
	case "jt808_8204", "link_detect":
		// 2019 link detection — empty body.
		msgID = 0x8204
		body = nil
	case "jt808_8203", "alarm_confirm":
		// Manual confirm alarm — DWORD alarm mask (aliases: sos, overspeed, …).
		msgID = 0x8203
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8203Body(text)
	case "jt808_8600", "geofence_set":
		// Set circular (0x8600), rectangular (0x8602), polygon (0x8604), or route (0x8606).
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				switch {
				case strings.Contains(strings.ToLower(text), "type=route"):
					msgID = 0x8606
				case strings.Contains(strings.ToLower(text), "type=poly"):
					msgID = 0x8604
				case strings.Contains(strings.ToLower(text), "type=rect"):
					msgID = 0x8602
				default:
					msgID = 0x8600
				}
				body = raw
				break
			}
		}
		switch {
		case looksLikeRouteGeofence(text):
			msgID = 0x8606
			body = wrap8606Body(text)
		case looksLikePolyGeofence(text):
			msgID = 0x8604
			body = wrap8604Body(text)
		case looksLikeRectGeofence(text):
			msgID = 0x8602
			body = wrap8602Body(text)
		default:
			msgID = 0x8600
			body = wrap8600Body(text)
		}
	case "jt808_8602":
		msgID = 0x8602
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8602Body(text)
	case "jt808_8604":
		msgID = 0x8604
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8604Body(text)
	case "jt808_8601", "geofence_del":
		// Delete areas: 8601 circle (default), 8603 rect, 8605 poly — same id-list body.
		msgID = geofenceDelMsgID(text)
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8601Body(text)
	case "jt808_8603":
		msgID = 0x8603
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8601Body(text)
	case "jt808_8605":
		msgID = 0x8605
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8601Body(text)
	case "jt808_8606", "route_set":
		msgID = 0x8606
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8606Body(text)
	case "jt808_8607", "route_del":
		msgID = 0x8607
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8601Body(text)
	case "jt808_8608", "geofence_query":
		// Query area/route data (2019) — type BYTE; terminal replies 0x0608.
		msgID = 0x8608
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = []byte{wrap8608Type(text)}
	case "jt808_9101", "av_live":
		// Realtime AV request (JT/T 1078) — experimental; opens terminal→media server path.
		msgID = 0x9101
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap9101Body(text)
	case "jt808_9102", "av_control":
		// AV realtime control (close/pause/…) — channel + command.
		msgID = 0x9102
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap9102Body(text)
	case "jt808_8301", "event_set":
		// Set event items (terminal can later report via 0x0301).
		msgID = 0x8301
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8301Body(text)
	case "jt808_8302", "question":
		// Question / prompt downlink (terminal answers via 0x0302).
		msgID = 0x8302
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8302Body(text)
	case "jt808_8303", "info_menu":
		// Information on-demand menu setting (0=clear, 1=update, …).
		msgID = 0x8303
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8303Body(text)
	case "jt808_8304", "info":
		// Information service push (type + content).
		msgID = 0x8304
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8304Body(text)
	case "jt808_8400", "phone_callback":
		// Phone callback / listen-in.
		msgID = 0x8400
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8400Body(text)
	case "jt808_8401", "phonebook":
		// Set phone book contacts (or clear).
		msgID = 0x8401
		if cmd.PayloadHex != "" {
			if raw := cmd.PayloadBytes(); len(raw) > 0 {
				body = raw
				break
			}
		}
		body = wrap8401Body(text)
	default:
		// 0x8300: flag(1)+text. Prefixes tts:/urgent:/display: set flag bits.
		if cmd.PayloadHex != "" {
			raw := cmd.PayloadBytes()
			if len(raw) == 0 {
				body = append([]byte{0x01}, []byte(text)...)
			} else if raw[0] <= 0x1f {
				body = raw // includes display/flag byte
			} else {
				body = append([]byte{0x01}, raw...)
			}
		} else {
			flag, msg := wrap8300FlagText(text)
			body = append([]byte{flag}, []byte(msg)...)
		}
	}
	return buildDownlinkFrameVer(phone, seq, msgID, body, v2019)
}

func buildDownlinkFrame(phone string, seq *uint16, msgID uint16, body []byte) []byte {
	return buildDownlinkFrameVer(phone, seq, msgID, body, false)
}

const jt808MaxBody = 1023

func buildDownlinkFrameVer(phone string, seq *uint16, msgID uint16, body []byte, v2019 bool) []byte {
	if len(body) <= jt808MaxBody {
		var n uint16 = 1
		if seq != nil {
			*seq++
			n = *seq
		}
		header := packJT808Header(msgID, body, phone, n, v2019)
		msg := append(header, body...)
		msg = append(msg, bcc(msg))
		return escape(msg)
	}
	// Outbound subpackages: first fragment's seq is the command corr_id.
	total := (len(body) + jt808MaxBody - 1) / jt808MaxBody
	out := make([]byte, 0, len(body)+total*24)
	for i := 0; i < total; i++ {
		start := i * jt808MaxBody
		end := start + jt808MaxBody
		if end > len(body) {
			end = len(body)
		}
		frag := body[start:end]
		var n uint16 = 1
		if seq != nil {
			*seq++
			n = *seq
		}
		header := packJT808HeaderSub(msgID, frag, phone, n, v2019, total, i+1)
		msg := append(header, frag...)
		msg = append(msg, bcc(msg))
		out = append(out, escape(msg)...)
	}
	return out
}

func handleFrame(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry, sess *session, frame []byte) error {
	raw := unescape(frame)
	if len(raw) < 13 { // 2011 min; 2019 needs ≥18 — parseMessageHeader enforces
		return nil
	}
	bodyWithBcc := raw
	msg := bodyWithBcc[:len(bodyWithBcc)-1]
	hdr, ok := parseMessageHeader(msg)
	if !ok {
		metrics.DecodeErr()
		return nil
	}
	msgID := hdr.MsgID
	phone := hdr.Phone
	seq := hdr.Seq
	body := hdr.Body(msg)
	sess.phone = phone
	sess.seq = seq
	if hdr.Version2019 {
		sess.version2019 = true
	}
	protoHint := sess.label
	if protoHint == "" {
		protoHint = "jt808"
	}
	if bcc(msg) != bodyWithBcc[len(bodyWithBcc)-1] {
		metrics.DecodeErr()
		// Result=1 (failure) so terminal does not hang waiting for platform ack.
		return replyGeneral(conn, sess, msgID, seq, 1)
	}

	if hdr.Subpackaged {
		if sess.subpkgs == nil {
			sess.subpkgs = newSubpkgTracker()
		}
		full, done := sess.subpkgs.feed(phone, msgID, hdr.TotalPkgs, hdr.PkgIndex, body)
		if !done {
			// ACK fragment; wait for remaining packages before processing body.
			return replyGeneral(conn, sess, msgID, seq, 0)
		}
		body = full
	}

	switch msgID {
	case 0x0100: // terminal register — bind early so downlink can flush before 0x0102
		remote := conn.RemoteAddr().String()
		sess.device = deviceauth.FindByIMEI(ctx, st, phone, remote, protoHint)
		bindSession(sessions, sess, conn)
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseRegister(body), nil)
		}
		return reply(conn, sess, 0x8100, buildRegisterAck(seq, 0, "FM1"))
	case 0x0102: // auth
		remote := conn.RemoteAddr().String()
		sess.device = deviceauth.FindByIMEI(ctx, st, phone, remote, protoHint)
		bindSession(sessions, sess, conn)
		if sess.device != nil && len(body) > 0 {
			_ = st.PatchLastStatus(ctx, sess.device, parseAuth(body), nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0001: // terminal general response (command ack)
		if sess.device != nil && len(body) >= 5 {
			ackSeq := binary.BigEndian.Uint16(body[0:2])
			result := body[4]
			respMsg := binary.BigEndian.Uint16(body[2:4])
			ok := result == 0
			_ = st.AckCommand(ctx, sess.device.ID, fmt.Sprintf("%d", ackSeq), ok,
				fmt.Sprintf("jt808_0001 msg=0x%04x result=%d", respMsg, result))
		}
		return nil // no reply to a reply
	case 0x0104: // query terminal params response (应答流水号 + count + TLVs)
		if sess.device != nil {
			corr := ""
			paramsBody := body
			if len(body) >= 3 {
				corr = fmt.Sprintf("%d", binary.BigEndian.Uint16(body[0:2]))
				paramsBody = body[2:]
			}
			parsed, complete := parseTerminalParamsOK(paramsBody)
			_ = st.PatchLastStatus(ctx, sess.device, parsed, nil)
			_ = st.AckCommand(ctx, sess.device.ID, corr, complete,
				fmt.Sprintf("jt808_0104 len=%d complete=%v", len(body), complete))
			_ = st.TouchSeen(ctx, sess.device)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0106: // designated params response (same TLV layout as 0x0104; reply to 0x8106)
		if sess.device != nil {
			corr := ""
			paramsBody := body
			if len(body) >= 3 {
				corr = fmt.Sprintf("%d", binary.BigEndian.Uint16(body[0:2]))
				paramsBody = body[2:]
			}
			parsed, complete := parseTerminalParamsOK(paramsBody)
			parsed["proto_msg"] = "0x0106"
			_ = st.PatchLastStatus(ctx, sess.device, parsed, nil)
			_ = st.AckCommand(ctx, sess.device.ID, corr, complete,
				fmt.Sprintf("jt808_0106 len=%d complete=%v", len(body), complete))
			_ = st.TouchSeen(ctx, sess.device)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0108: // terminal upgrade result (type + result; no reply-seq in body)
		if sess.device != nil {
			patch := parseUpgradeResult(body)
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
			ok := true
			if r, has := patch["upgrade_result"].(int); has {
				ok = r == 0
			}
			// Pair with latest 0x8108 / terminal_upgrade (or 0x8105) — body has no reply-seq.
			_ = st.AckLatestSent(ctx, sess.device.ID, ok,
				fmt.Sprintf("jt808_0108 %v", patch["upgrade_result"]))
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0002: // heartbeat
		if sess.device != nil {
			_ = st.TouchSeen(ctx, sess.device)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0004: // query server time (2019) — reply 0x8004 with UTC BCD
		if sess.device != nil {
			_ = st.TouchSeen(ctx, sess.device)
		}
		return reply(conn, sess, 0x8004, bcdNowUTC6())
	case 0x0005: // terminal requests missing subpackages — status only (no retransmit yet)
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseSubpkgRetransmit(body), nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0003: // terminal logout — tear down session binding
		if sess.device != nil {
			_ = st.TouchSeen(ctx, sess.device)
		}
		if err := replyGeneral(conn, sess, msgID, seq, 0); err != nil {
			return err
		}
		if sessions != nil && sess.bound != nil {
			sessions.Unbind(sess.bound)
			sess.bound = nil
		}
		return nil
	case 0x0500: // vehicle control response (应答流水号 + location body)
		loc := body
		corr := ""
		if len(body) >= 30 {
			corr = fmt.Sprintf("%d", binary.BigEndian.Uint16(body[0:2]))
			loc = body[2:]
		}
		ingestLocation(ctx, conn, st, sessions, sess, loc, protoHint)
		if sess.device != nil {
			_ = st.AckCommand(ctx, sess.device.ID, corr, true, "jt808_0500")
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0107: // query terminal attributes response
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseTerminalAttrs(body), nil)
			// 0x0107 has no reply-seq in body — match latest query_attrs / 8107.
			_ = st.AckLatestSent(ctx, sess.device.ID, true,
				fmt.Sprintf("jt808_0107 len=%d", len(body)))
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0201: // location query response (应答流水号 + 0x0200 body)
		loc := body
		corr := ""
		if len(body) >= 30 {
			corr = fmt.Sprintf("%d", binary.BigEndian.Uint16(body[0:2]))
			loc = body[2:]
		}
		ingestLocation(ctx, conn, st, sessions, sess, loc, protoHint)
		if sess.device != nil {
			_ = st.AckCommand(ctx, sess.device.ID, corr, true, "jt808_0201")
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0701: // electronic waybill
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseWaybill(body), nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0800: // multimedia data packet (metadata + optional embedded location; no media storage)
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseMultimediaData(body), nil)
			if loc := multimediaLocationBody(body); len(loc) >= 28 {
				ingestLocation(ctx, conn, st, sessions, sess, loc, protoHint)
			}
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0801: // multimedia event / metadata (+ optional embedded location)
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseMultimediaMeta(body), nil)
			if loc := multimediaLocationBody(body); len(loc) >= 28 {
				ingestLocation(ctx, conn, st, sessions, sess, loc, protoHint)
			}
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0802: // stored multimedia retrieval response (应答流水号 + count + items)
		if sess.device != nil {
			patch := parseMultimediaRetrieveResp(body)
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
			corr := ""
			if c, ok := patch["reply_seq"].(int); ok {
				corr = fmt.Sprintf("%d", c)
			}
			_ = st.AckCommand(ctx, sess.device.ID, corr, true,
				fmt.Sprintf("jt808_0802 count=%v", patch["media_count"]))
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0805: // camera shoot response (应答流水号 + result + media ids)
		if sess.device != nil {
			patch := parseCameraShootResp(body)
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
			corr := ""
			if c, ok := patch["reply_seq"].(int); ok {
				corr = fmt.Sprintf("%d", c)
			}
			ok := true
			if r, has := patch["shoot_result"].(int); has {
				ok = r == 0
			}
			_ = st.AckCommand(ctx, sess.device.ID, corr, ok,
				fmt.Sprintf("jt808_0805 result=%v", patch["shoot_result"]))
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0900: // transparent data uplink
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseTransparent(body), nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0301: // event report
		if sess.device != nil && len(body) >= 1 {
			evID := int(body[0])
			patch := map[string]any{"event_id": evID, "proto_msg": "0x0301"}
			if ev := safetyFromEventID(evID, protoHint); ev != nil {
				for k, v := range ev.RawAttrs {
					patch[k] = v
				}
				_ = st.InsertSafetyEvent(ctx, sess.device, *ev)
			}
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0302: // question answer
		if sess.device != nil {
			patch := parseQuestionAnswer(body)
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
			corr := ""
			if c, ok := patch["reply_seq"].(int); ok {
				corr = fmt.Sprintf("%d", c)
			}
			_ = st.AckCommand(ctx, sess.device.ID, corr, true,
				fmt.Sprintf("jt808_0302 id=%v", patch["answer_id"]))
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0303: // info on-demand / cancel
		if sess.device != nil && len(body) >= 2 {
			flag := int(body[1]) // 0=cancel, 1=order (typical)
			patch := map[string]any{
				"proto_msg":     "0x0303",
				"info_type":     int(body[0]),
				"info_flag":     flag,
				"info_ordered":  flag == 1,
				"info_canceled": flag == 0,
			}
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0702: // driver identity information report
		if sess.device != nil {
			patch := parseDriverIdentity(body)
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
			if ev := safetyFromDriverIdentity(patch, protoHint); ev != nil {
				_ = st.InsertSafetyEvent(ctx, sess.device, *ev)
			}
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0704: // batch location
		if len(body) >= 3 {
			count := int(binary.BigEndian.Uint16(body[0:2]))
			off := 3
			for i := 0; i < count && off+2 <= len(body); i++ {
				itemLen := int(binary.BigEndian.Uint16(body[off : off+2]))
				off += 2
				if off+itemLen > len(body) {
					break
				}
				ingestLocation(ctx, conn, st, sessions, sess, body[off:off+itemLen], protoHint)
				off += itemLen
			}
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0705: // CAN bus data uplink (status patch only — no full CAN decode)
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseCANBus(body), nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0700: // driving record data upload (status patch — no full GB/T decode)
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseDrivingRecord(body), nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0608: // query area/route data response (2019) — status patch only
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseAreaQueryResp(body), nil)
			_ = st.AckLatestSent(ctx, sess.device.ID, true, fmt.Sprintf("jt808_0608 len=%d", len(body)))
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0200: // location
		ingestLocation(ctx, conn, st, sessions, sess, body, protoHint)
		return replyGeneral(conn, sess, msgID, seq, 0)
	default:
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, map[string]any{
				"proto_msg": fmt.Sprintf("0x%04x", msgID),
				"msg_id":    int(msgID),
				"body_hex":  fmt.Sprintf("%x", body),
			}, nil)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	}
}

// parseDriverIdentity extracts remappable driver fields from JT808 0x0702.
// Layout (common): state(1) + time(6 BCD) + IC result(1) + driver name len(1) + name + …
func parseDriverIdentity(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0702", "driver_hex": fmt.Sprintf("%x", body)}
	if len(body) < 1 {
		return out
	}
	st := int(body[0])
	out["driver_state"] = st // 0x01 insert, 0x02 pull out (typical)
	out["driver.ic_status"] = st
	switch st {
	case 1:
		out["driver.ic_login"] = true
	case 2:
		out["driver.ic_logout"] = true
	}
	off := 1
	if len(body) >= off+6 {
		out["driver_time"] = fmt.Sprintf("%x", body[off:off+6])
		out["driver.ic_time_bcd"] = out["driver_time"]
		off += 6
	}
	if len(body) >= off+1 {
		out["driver_ic_result"] = int(body[off])
		out["driver.ic_result"] = int(body[off])
		off++
	}
	if len(body) >= off+1 {
		n := int(body[off])
		off++
		if n > 0 && off+n <= len(body) {
			name := strings.TrimRight(string(body[off:off+n]), "\x00 ")
			out["driver_name"] = name
			out["driver.ic_name"] = name
			off += n
		}
	}
	if off < len(body) {
		// Remaining often: qualification cert ASCII / agency
		rest := strings.TrimRight(string(body[off:]), "\x00 ")
		if rest != "" {
			out["driver_cert"] = rest
			out["driver.ic_card"] = rest
		}
	}
	return out
}

// safetyFromDriverIdentity raises IC login/logout safety events from 0x0702 patches.
func safetyFromDriverIdentity(patch map[string]any, protocol string) *store.SafetyEvent {
	return safetyFromLocationTLVAlarms(patch, store.Fix{RecordedAt: time.Now().UTC()}, protocol)
}

// parseTerminalParams extracts remappable keys from 0x0104 param list
// (count BYTE + N×{id DWORD, len BYTE, value}).
func parseTerminalParams(body []byte) map[string]any {
	out, _ := parseTerminalParamsOK(body)
	return out
}

func parseTerminalParamsOK(body []byte) (map[string]any, bool) {
	out := map[string]any{"proto_msg": "0x0104", "params_hex": fmt.Sprintf("%x", body)}
	if len(body) < 1 {
		return out, false
	}
	count := int(body[0])
	out["param_count"] = count
	off := 1
	parsed := 0
	for i := 0; i < count && off+5 <= len(body); i++ {
		id := binary.BigEndian.Uint32(body[off : off+4])
		n := int(body[off+4])
		off += 5
		if n < 0 || off+n > len(body) {
			break
		}
		val := body[off : off+n]
		off += n
		parsed++
		key := fmt.Sprintf("param.0x%04x", id)
		var decoded any
		switch n {
		case 1:
			decoded = int(val[0])
		case 2:
			decoded = int(binary.BigEndian.Uint16(val))
		case 4:
			decoded = int(binary.BigEndian.Uint32(val))
		default:
			decoded = fmt.Sprintf("%x", val)
		}
		out[key] = decoded
		hoistTerminalParam(id, decoded, val, out)
	}
	out["params_parsed"] = parsed
	complete := parsed == count
	out["params_complete"] = complete
	return out, complete
}

// hoistTerminalParam maps common JT/T 808 terminal param IDs onto remappable named keys.
func hoistTerminalParam(id uint32, decoded any, raw []byte, out map[string]any) {
	if out == nil {
		return
	}
	switch id {
	case 0x0001:
		out["heartbeat.interval"] = decoded
	case 0x0002:
		out["tcp.timeout"] = decoded
	case 0x0003:
		out["tcp.retry"] = decoded
	case 0x0010:
		out["apn.main"] = string(raw)
	case 0x0011:
		out["apn.user"] = string(raw)
	case 0x0013:
		out["server.main"] = string(raw)
	case 0x0017:
		out["server.backup"] = string(raw)
	case 0x0018:
		out["server.port"] = decoded
	case 0x0020:
		out["report.interval"] = decoded
	case 0x0027:
		out["report.interval_dormant"] = decoded
	case 0x0029:
		out["report.interval_default"] = decoded
	case 0x0012:
		out["apn.password"] = string(raw)
	case 0x0014:
		out["apn.backup"] = string(raw)
	case 0x0040:
		out["phone.monitor"] = string(raw)
	case 0x0041:
		out["phone.reset"] = string(raw)
	case 0x0048:
		out["phone.sms"] = string(raw)
	case 0x0050:
		out["alarm.mask"] = decoded
	case 0x0051:
		out["alarm.sms_switch"] = decoded
	case 0x0055:
		out["speed.max"] = decoded
	case 0x0056:
		out["speed.duration"] = decoded
	case 0x0080:
		out["mileage.factor"] = decoded
	case 0x0081:
		out["vehicle.province"] = decoded
	case 0x0082:
		out["vehicle.city"] = decoded
	case 0x0083:
		out["vehicle.plate"] = string(raw)
	case 0x0084:
		out["vehicle.plate_color"] = decoded
	}
}

// parseUpgradeResult maps 0x0108 upgrade result body (type + result).
func parseUpgradeResult(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0108", "upgrade_hex": fmt.Sprintf("%x", body)}
	if len(body) >= 1 {
		out["upgrade_type"] = int(body[0])
	}
	if len(body) >= 2 {
		out["upgrade_result"] = int(body[1]) // 0=ok
	}
	return out
}

// parseMultimediaMeta stores 0x0801 multimedia event fields (partial; no media body).
// Preferred JT/T 808 layout: id(4)+type+format+event+channel + optional 0x0200 location (28+).
// Short legacy layout (type+channel+event+id) kept when body < 8.
func parseMultimediaMeta(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0801", "media_hex": fmt.Sprintf("%x", body)}
	if len(body) >= 8 {
		out["media_id"] = binary.BigEndian.Uint32(body[0:4])
		out["media_type"] = int(body[4])
		out["media_code"] = int(body[5])
		out["media_event"] = int(body[6])
		out["media_channel"] = int(body[7])
		if len(body) >= 36 {
			out["media_has_location"] = true
		}
		return out
	}
	if len(body) >= 1 {
		out["media_type"] = int(body[0])
	}
	if len(body) >= 2 {
		out["media_channel"] = int(body[1])
	}
	if len(body) >= 3 {
		out["media_event"] = int(body[2])
	}
	if len(body) >= 7 {
		out["media_id"] = binary.BigEndian.Uint32(body[3:7])
	}
	return out
}

// multimediaLocationBody returns the trailing 0x0200-style location blob from 0x0801 when present.
func multimediaLocationBody(body []byte) []byte {
	if len(body) < 36 {
		return nil
	}
	return body[8:]
}

// wrap8301Body builds minimal 0x8301 event setting: count + (id,len,text) items.
// text: "id=1,text=SOS" or "1:SOS;2:Call" (GBK/UTF-8 passthrough as bytes).
func wrap8301Body(text string) []byte {
	type item struct {
		id  byte
		msg string
	}
	var items []item
	t := strings.TrimSpace(text)
	if strings.Contains(t, "=") {
		var id byte = 1
		msg := t
		for _, part := range strings.Split(t, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.ToLower(kv[0]), kv[1]
			switch k {
			case "id":
				if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
					id = byte(n)
				}
			case "text", "msg", "event":
				msg = v
			}
		}
		items = append(items, item{id, msg})
	} else {
		for _, part := range strings.Split(t, ";") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			kv := strings.SplitN(part, ":", 2)
			if len(kv) != 2 {
				continue
			}
			n, err := strconv.Atoi(strings.TrimSpace(kv[0]))
			if err != nil || n < 0 || n > 255 {
				continue
			}
			items = append(items, item{byte(n), strings.TrimSpace(kv[1])})
		}
	}
	if len(items) == 0 {
		items = append(items, item{1, strings.TrimSpace(text)})
	}
	if len(items) > 255 {
		items = items[:255]
	}
	body := []byte{byte(len(items))}
	for _, it := range items {
		msg := []byte(it.msg)
		if len(msg) > 255 {
			msg = msg[:255]
		}
		body = append(body, it.id, byte(len(msg)))
		body = append(body, msg...)
	}
	return body
}

// wrap8302Body builds 0x8302 question: flag + id + len + content.
// text: "id=1,q=Over speed?" or plain question string (id=1).
func wrap8302Body(text string) []byte {
	id := byte(1)
	flag := byte(0)
	q := strings.TrimSpace(text)
	for _, part := range strings.Split(q, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), kv[1]
		switch k {
		case "id":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
				id = byte(n)
			}
		case "flag":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
				flag = byte(n)
			}
		case "q", "text", "question":
			q = v
		}
	}
	if strings.Contains(strings.ToLower(text), "id=") || strings.Contains(strings.ToLower(text), "q=") {
		// q already set from kv
	} else {
		q = strings.TrimSpace(text)
	}
	msg := []byte(q)
	if len(msg) > 255 {
		msg = msg[:255]
	}
	body := make([]byte, 0, 3+len(msg))
	body = append(body, flag, id, byte(len(msg)))
	body = append(body, msg...)
	return body
}

// parseQuestionAnswer maps 0x0302 answer: reply_seq + answer id (+ optional content).
func parseQuestionAnswer(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0302", "answer_len": len(body)}
	if len(body) >= 2 {
		out["reply_seq"] = int(binary.BigEndian.Uint16(body[0:2]))
	}
	if len(body) >= 3 {
		out["answer_id"] = int(body[2])
	}
	if len(body) > 3 {
		snip := body[3:]
		if len(snip) > 64 {
			snip = snip[:64]
		}
		text := strings.TrimRight(string(snip), "\x00")
		out["answer_text"] = text
		out["answer.text"] = text
		out["answer_hex"] = fmt.Sprintf("%x", snip)
	}
	return out
}

// wrap8300FlagText maps optional prefixes to JT808 text-flag bits (emergency/TTS/display).
func wrap8300FlagText(text string) (flag byte, msg string) {
	flag = 0x01 // default: terminal display
	msg = text
	lower := strings.ToLower(strings.TrimSpace(text))
	switch {
	case strings.HasPrefix(lower, "urgent:"):
		flag |= 0x01 // emergency
		msg = strings.TrimSpace(text[len("urgent:"):])
	case strings.HasPrefix(lower, "tts:"):
		flag = 0x08 // TTS broadcast
		msg = strings.TrimSpace(text[len("tts:"):])
	case strings.HasPrefix(lower, "display:"):
		flag = 0x10 // advertising screen
		msg = strings.TrimSpace(text[len("display:"):])
	case strings.HasPrefix(lower, "transparent:"):
		flag = 0x04
		msg = strings.TrimSpace(text[len("transparent:"):])
	}
	return flag, msg
}

// wrap8608Type: 1=circle 2=rect 3=poly 4=route; default 1.
func wrap8608Type(text string) byte {
	switch strings.TrimSpace(strings.ToLower(text)) {
	case "2", "rect", "rectangle":
		return 2
	case "3", "poly", "polygon":
		return 3
	case "4", "route":
		return 4
	default:
		return 1
	}
}

// wrap9101Body builds a minimal 0x9101 realtime AV request.
// text: "ip:port" or "ch=1,ip=x.x.x.x,tcp=1078" — defaults ch=1, stream=0 (AV), type=0.
func wrap9101Body(text string) []byte {
	ch, dataType, streamType := byte(1), byte(0), byte(0)
	ip := "127.0.0.1"
	tcpPort, udpPort := uint16(1078), uint16(0)
	t := strings.TrimSpace(text)
	if t != "" && !strings.Contains(t, "=") && strings.Contains(t, ":") {
		parts := strings.SplitN(t, ":", 2)
		ip = parts[0]
		if n, err := strconv.Atoi(parts[1]); err == nil && n > 0 && n < 65536 {
			tcpPort = uint16(n)
		}
	} else {
		for _, part := range strings.Split(t, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.ToLower(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "ch", "channel":
				if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
					ch = byte(n)
				}
			case "ip", "host":
				ip = v
			case "tcp", "port":
				if n, err := strconv.Atoi(v); err == nil && n > 0 && n < 65536 {
					tcpPort = uint16(n)
				}
			case "udp":
				if n, err := strconv.Atoi(v); err == nil && n >= 0 && n < 65536 {
					udpPort = uint16(n)
				}
			case "type", "datatype":
				if n, err := strconv.Atoi(v); err == nil {
					dataType = byte(n)
				}
			case "stream":
				if n, err := strconv.Atoi(v); err == nil {
					streamType = byte(n)
				}
			}
		}
	}
	ipBytes := []byte(ip)
	if len(ipBytes) > 255 {
		ipBytes = ipBytes[:255]
	}
	body := make([]byte, 0, 8+len(ipBytes))
	body = append(body, ch, dataType, streamType, byte(len(ipBytes)))
	body = append(body, ipBytes...)
	portBuf := make([]byte, 4)
	binary.BigEndian.PutUint16(portBuf[0:2], tcpPort)
	binary.BigEndian.PutUint16(portBuf[2:4], udpPort)
	body = append(body, portBuf...)
	return body
}

// wrap9102Body: "ch=1,cmd=0" — cmd 0=close, 1=switch stream, 2=pause, 3=resume, 4=close talk.
func wrap9102Body(text string) []byte {
	ch, cmd := byte(1), byte(0)
	for _, part := range strings.Split(strings.TrimSpace(text), ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			if n, err := strconv.Atoi(strings.TrimSpace(part)); err == nil {
				cmd = byte(n)
			}
			continue
		}
		k, v := strings.ToLower(kv[0]), strings.TrimSpace(kv[1])
		switch k {
		case "ch", "channel":
			if n, err := strconv.Atoi(v); err == nil {
				ch = byte(n)
			}
		case "cmd", "command":
			if n, err := strconv.Atoi(v); err == nil {
				cmd = byte(n)
			}
		}
	}
	return []byte{ch, cmd, 0, 0} // channel, cmd, closeType, streamType placeholders
}

// parseAuth stores 0x0102 auth code string (and optional IMEI suffix on 2019).
func parseAuth(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0102", "auth_len": len(body)}
	code := strings.TrimRight(string(body), "\x00 ")
	if code != "" {
		if len(code) > 64 {
			code = code[:64]
		}
		out["auth_code"] = code
	}
	return out
}

// parseRegister maps 0x0100 terminal register body (province/city/mfr/model/id/plate).
func parseRegister(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0100", "reg_len": len(body)}
	if len(body) >= 2 {
		out["province_id"] = int(binary.BigEndian.Uint16(body[0:2]))
	}
	if len(body) >= 4 {
		out["city_id"] = int(binary.BigEndian.Uint16(body[2:4]))
	}
	off := 4
	if len(body) >= off+5 {
		out["manufacturer"] = strings.TrimRight(string(body[off:off+5]), "\x00 ")
		off += 5
	}
	if len(body) >= off+20 {
		out["terminal_model"] = strings.TrimRight(string(body[off:off+20]), "\x00 ")
		off += 20
	}
	if len(body) >= off+7 {
		out["terminal_id"] = strings.TrimRight(string(body[off:off+7]), "\x00 ")
		off += 7
	}
	if len(body) > off {
		out["plate_color"] = int(body[off])
		off++
	}
	if off < len(body) {
		plate := strings.TrimRight(string(body[off:]), "\x00 ")
		if plate != "" {
			out["vehicle_plate"] = plate
		}
	}
	return out
}

// wrap8203Body builds 0x8203 manual alarm confirm (DWORD mask).
func wrap8203Body(text string) []byte {
	var mask uint32
	t := strings.TrimSpace(strings.ToLower(text))
	switch t {
	case "", "sos":
		mask = 1 << 0
	case "overspeed", "speed":
		mask = 1 << 1
	case "fatigue":
		mask = 1 << 2
	case "power_cut", "power":
		mask = 1 << 8
	case "collision":
		mask = 1 << 20
	case "all":
		mask = 0xffffffff
	default:
		t = strings.TrimPrefix(t, "0x")
		n, err := strconv.ParseUint(t, 16, 32)
		if err != nil {
			n, err = strconv.ParseUint(t, 10, 32)
		}
		if err == nil {
			mask = uint32(n)
		} else {
			mask = 1 // sos default
		}
	}
	body := make([]byte, 4)
	binary.BigEndian.PutUint32(body, mask)
	return body
}

// looksLikeRectGeofence detects type=rect or lat1/lon1/lat2/lon2 DSL.
func looksLikeRectGeofence(text string) bool {
	t := strings.ToLower(text)
	return strings.Contains(t, "type=rect") ||
		(strings.Contains(t, "lat1=") && strings.Contains(t, "lat2="))
}

// looksLikePolyGeofence detects type=poly or pts= vertex list.
func looksLikePolyGeofence(text string) bool {
	t := strings.ToLower(text)
	return strings.Contains(t, "type=poly") || strings.Contains(t, "pts=")
}

// geofenceDelMsgID picks 0x8601/8603/8605/8607 from type=circle|rect|poly|route (default circle).
func geofenceDelMsgID(text string) uint16 {
	t := strings.ToLower(text)
	switch {
	case strings.Contains(t, "type=rect"):
		return 0x8603
	case strings.Contains(t, "type=poly"):
		return 0x8605
	case strings.Contains(t, "type=route"):
		return 0x8607
	default:
		return 0x8601
	}
}

// looksLikeRouteGeofence detects type=route DSL.
func looksLikeRouteGeofence(text string) bool {
	return strings.Contains(strings.ToLower(text), "type=route")
}

// wrap8600Body builds a minimal 0x8600 single circular area.
// text: "id=1,lat=-6.2,lon=106.8,r=500" (degrees, radius meters).
func wrap8600Body(text string) []byte {
	var id uint32 = 1
	var lat, lon float64
	var radius uint32 = 100
	for _, part := range strings.Split(strings.TrimSpace(text), ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), strings.TrimSpace(kv[1])
		switch k {
		case "id":
			if n, err := strconv.ParseUint(v, 10, 32); err == nil {
				id = uint32(n)
			}
		case "lat":
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				lat = n
			}
		case "lon", "lng":
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				lon = n
			}
		case "r", "radius":
			if n, err := strconv.ParseUint(v, 10, 32); err == nil {
				radius = uint32(n)
			}
		}
	}
	// property=0 (update), count=1, then area: id, attr=0, lat, lon, radius
	body := make([]byte, 2+4+2+4+4+4)
	body[0] = 0
	body[1] = 1
	off := 2
	binary.BigEndian.PutUint32(body[off:], id)
	off += 4
	binary.BigEndian.PutUint16(body[off:], 0) // attribute
	off += 2
	binary.BigEndian.PutUint32(body[off:], uint32(int32(lat*1e6)))
	off += 4
	binary.BigEndian.PutUint32(body[off:], uint32(int32(lon*1e6)))
	off += 4
	binary.BigEndian.PutUint32(body[off:], radius)
	return body
}

// wrap8602Body builds a minimal 0x8602 single rectangular area.
// text: "id=1,lat1=-6.1,lon1=106.7,lat2=-6.3,lon2=106.9" (NW/SE corners, degrees).
func wrap8602Body(text string) []byte {
	var id uint32 = 1
	var lat1, lon1, lat2, lon2 float64
	for _, part := range strings.Split(strings.TrimSpace(text), ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), strings.TrimSpace(kv[1])
		switch k {
		case "id":
			if n, err := strconv.ParseUint(v, 10, 32); err == nil {
				id = uint32(n)
			}
		case "lat1", "nlat", "top":
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				lat1 = n
			}
		case "lon1", "lng1", "left":
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				lon1 = n
			}
		case "lat2", "slat", "bottom":
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				lat2 = n
			}
		case "lon2", "lng2", "right":
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				lon2 = n
			}
		}
	}
	body := make([]byte, 2+4+2+4+4+4+4)
	body[0] = 0 // property=update
	body[1] = 1 // count
	off := 2
	binary.BigEndian.PutUint32(body[off:], id)
	off += 4
	binary.BigEndian.PutUint16(body[off:], 0) // attribute
	off += 2
	binary.BigEndian.PutUint32(body[off:], uint32(int32(lat1*1e6)))
	off += 4
	binary.BigEndian.PutUint32(body[off:], uint32(int32(lon1*1e6)))
	off += 4
	binary.BigEndian.PutUint32(body[off:], uint32(int32(lat2*1e6)))
	off += 4
	binary.BigEndian.PutUint32(body[off:], uint32(int32(lon2*1e6)))
	return body
}

// wrap8604Body builds a minimal 0x8604 single polygon (≥3 vertices).
// text: "id=1,pts=-6.1,106.7;-6.2,106.8;-6.1,106.9" (lat,lon pairs separated by ;).
func wrap8604Body(text string) []byte {
	var id uint32 = 1
	var pts [][2]float64
	t := strings.TrimSpace(text)
	lower := strings.ToLower(t)
	if i := strings.Index(lower, "id="); i >= 0 {
		rest := t[i+3:]
		end := strings.IndexAny(rest, ",;")
		token := rest
		if end >= 0 {
			token = rest[:end]
		}
		if n, err := strconv.ParseUint(strings.TrimSpace(token), 10, 32); err == nil {
			id = uint32(n)
		}
	}
	ptsStart := -1
	ptsKeyLen := 0
	for _, key := range []string{"pts=", "points=", "vertices="} {
		if i := strings.Index(lower, key); i >= 0 {
			ptsStart, ptsKeyLen = i, len(key)
			break
		}
	}
	if ptsStart >= 0 {
		for _, pair := range strings.Split(t[ptsStart+ptsKeyLen:], ";") {
			coords := strings.Split(strings.TrimSpace(pair), ",")
			if len(coords) < 2 {
				continue
			}
			lat, err1 := strconv.ParseFloat(strings.TrimSpace(coords[0]), 64)
			lon, err2 := strconv.ParseFloat(strings.TrimSpace(coords[1]), 64)
			if err1 == nil && err2 == nil {
				pts = append(pts, [2]float64{lat, lon})
			}
		}
	}
	if len(pts) < 3 {
		pts = [][2]float64{{0, 0}, {0.001, 0}, {0, 0.001}}
	}
	if len(pts) > 255 {
		pts = pts[:255]
	}
	body := make([]byte, 2+4+2+2+8*len(pts))
	body[0] = 0
	body[1] = 1
	off := 2
	binary.BigEndian.PutUint32(body[off:], id)
	off += 4
	binary.BigEndian.PutUint16(body[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(body[off:], uint16(len(pts)))
	off += 2
	for _, p := range pts {
		binary.BigEndian.PutUint32(body[off:], uint32(int32(p[0]*1e6)))
		off += 4
		binary.BigEndian.PutUint32(body[off:], uint32(int32(p[1]*1e6)))
		off += 4
	}
	return body
}

// wrap8606Body builds a minimal 0x8606 route (inflection points, no time window).
// text: "id=1,w=50,pts=-6.1,106.7;-6.2,106.8" (width meters; ≥2 points).
func wrap8606Body(text string) []byte {
	var id uint32 = 1
	width := byte(50)
	var pts [][2]float64
	t := strings.TrimSpace(text)
	lower := strings.ToLower(t)
	if i := strings.Index(lower, "id="); i >= 0 {
		rest := t[i+3:]
		end := strings.IndexAny(rest, ",;")
		token := rest
		if end >= 0 {
			token = rest[:end]
		}
		if n, err := strconv.ParseUint(strings.TrimSpace(token), 10, 32); err == nil {
			id = uint32(n)
		}
	}
	if i := strings.Index(lower, "w="); i >= 0 {
		rest := t[i+2:]
		end := strings.IndexAny(rest, ",;")
		token := rest
		if end >= 0 {
			token = rest[:end]
		}
		if n, err := strconv.Atoi(strings.TrimSpace(token)); err == nil && n >= 0 && n <= 255 {
			width = byte(n)
		}
	}
	ptsStart := -1
	ptsKeyLen := 0
	for _, key := range []string{"pts=", "points="} {
		if i := strings.Index(lower, key); i >= 0 {
			ptsStart, ptsKeyLen = i, len(key)
			break
		}
	}
	if ptsStart >= 0 {
		for _, pair := range strings.Split(t[ptsStart+ptsKeyLen:], ";") {
			coords := strings.Split(strings.TrimSpace(pair), ",")
			if len(coords) < 2 {
				continue
			}
			lat, err1 := strconv.ParseFloat(strings.TrimSpace(coords[0]), 64)
			lon, err2 := strconv.ParseFloat(strings.TrimSpace(coords[1]), 64)
			if err1 == nil && err2 == nil {
				pts = append(pts, [2]float64{lat, lon})
			}
		}
	}
	if len(pts) < 2 {
		pts = [][2]float64{{0, 0}, {0.001, 0.001}}
	}
	if len(pts) > 255 {
		pts = pts[:255]
	}
	body := make([]byte, 0, 8+18*len(pts))
	var hdr [8]byte
	binary.BigEndian.PutUint32(hdr[0:4], id)
	binary.BigEndian.PutUint16(hdr[4:6], 0) // attribute — no time window
	binary.BigEndian.PutUint16(hdr[6:8], uint16(len(pts)))
	body = append(body, hdr[:]...)
	for i, p := range pts {
		var pt [18]byte
		binary.BigEndian.PutUint32(pt[0:4], uint32(i+1))
		binary.BigEndian.PutUint32(pt[4:8], 0) // road id
		lat := int32(p[0] * 1e6)
		lon := int32(p[1] * 1e6)
		binary.BigEndian.PutUint32(pt[8:12], uint32(lat))
		binary.BigEndian.PutUint32(pt[12:16], uint32(lon))
		pt[16] = width
		pt[17] = 0
		body = append(body, pt[:]...)
	}
	return body
}

// wrap8303Body builds 0x8303 info menu setting.
// text: "clear" | "type=1,items=1:News;2:Weather" (set_type + id:name pairs).
func wrap8303Body(text string) []byte {
	t := strings.TrimSpace(strings.ToLower(text))
	if t == "" || t == "clear" || t == "delete" || t == "0" {
		return []byte{0} // delete all
	}
	setType := byte(1) // update
	itemsPart := text
	for _, part := range strings.Split(text, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), kv[1]
		switch k {
		case "type", "set":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
				setType = byte(n)
			}
		case "items", "menu":
			itemsPart = v
		}
	}
	type item struct {
		id  byte
		name string
	}
	var items []item
	src := itemsPart
	if i := strings.Index(strings.ToLower(text), "items="); i >= 0 {
		src = text[i+6:]
	} else if j := strings.Index(strings.ToLower(text), "menu="); j >= 0 {
		src = text[j+5:]
	}
	for _, part := range strings.Split(src, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, ":", 2)
		if len(kv) != 2 {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSpace(kv[0]))
		if err != nil || n < 0 || n > 255 {
			continue
		}
		items = append(items, item{byte(n), strings.TrimSpace(kv[1])})
	}
	if len(items) > 255 {
		items = items[:255]
	}
	body := []byte{setType, byte(len(items))}
	for _, it := range items {
		name := []byte(it.name)
		if len(name) > 255 {
			name = name[:255]
		}
		body = append(body, it.id, byte(len(name)))
		body = append(body, name...)
	}
	return body
}

// wrap8400Body builds 0x8400 phone callback: flag BYTE + phone digits.
// text: "13800138000" | "listen:138…" | "flag=1,phone=138…".
func wrap8400Body(text string) []byte {
	flag := byte(0)
	phone := strings.TrimSpace(text)
	lower := strings.ToLower(phone)
	switch {
	case strings.HasPrefix(lower, "listen:"):
		flag = 1
		phone = strings.TrimSpace(text[len("listen:"):])
	case strings.HasPrefix(lower, "call:"):
		phone = strings.TrimSpace(text[len("call:"):])
	default:
		for _, part := range strings.Split(phone, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.ToLower(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "flag":
				if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
					flag = byte(n)
				}
			case "phone", "tel", "number":
				phone = v
			}
		}
		if strings.Contains(lower, "flag=") || strings.Contains(lower, "phone=") {
			// phone already set from kv
		} else if !strings.Contains(phone, "=") {
			phone = strings.TrimSpace(text)
		}
	}
	phone = strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' || r == '+' {
			return r
		}
		return -1
	}, phone)
	return append([]byte{flag}, []byte(phone)...)
}

// wrap8401Body builds 0x8401 phone book set.
// text: "clear" | "type=1,items=1:13800138000:Home;2:139…:Work".
func wrap8401Body(text string) []byte {
	t := strings.TrimSpace(strings.ToLower(text))
	if t == "" || t == "clear" || t == "delete" || t == "0" {
		return []byte{0} // delete all
	}
	setType := byte(1)
	src := text
	for _, part := range strings.Split(text, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), kv[1]
		switch k {
		case "type", "set":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
				setType = byte(n)
			}
		case "items", "contacts":
			src = v
		}
	}
	if i := strings.Index(strings.ToLower(text), "items="); i >= 0 {
		src = text[i+6:]
	} else if j := strings.Index(strings.ToLower(text), "contacts="); j >= 0 {
		src = text[j+9:]
	}
	type contact struct {
		flag byte
		num  string
		name string
	}
	var contacts []contact
	for _, part := range strings.Split(src, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		fields := strings.SplitN(part, ":", 3)
		if len(fields) < 2 {
			continue
		}
		flag := byte(1)
		num, name := fields[0], ""
		if len(fields) == 3 {
			if n, err := strconv.Atoi(strings.TrimSpace(fields[0])); err == nil && n >= 0 && n <= 255 {
				flag = byte(n)
			}
			num, name = fields[1], fields[2]
		} else {
			num, name = fields[0], fields[1]
		}
		num = strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' || r == '+' {
				return r
			}
			return -1
		}, strings.TrimSpace(num))
		name = strings.TrimSpace(name)
		if num == "" {
			continue
		}
		contacts = append(contacts, contact{flag, num, name})
	}
	if len(contacts) > 255 {
		contacts = contacts[:255]
	}
	body := []byte{setType, byte(len(contacts))}
	for _, c := range contacts {
		nb, nam := []byte(c.num), []byte(c.name)
		if len(nb) > 255 {
			nb = nb[:255]
		}
		if len(nam) > 255 {
			nam = nam[:255]
		}
		body = append(body, c.flag, byte(len(nb)))
		body = append(body, nb...)
		body = append(body, byte(len(nam)))
		body = append(body, nam...)
	}
	return body
}

// wrap8304Body builds 0x8304 info service: type BYTE + len DWORD + content.
// text: "type=1,text=Hello" or plain content (type=0).
func wrap8304Body(text string) []byte {
	infoType := byte(0)
	msg := strings.TrimSpace(text)
	for _, part := range strings.Split(msg, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), kv[1]
		switch k {
		case "type":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
				infoType = byte(n)
			}
		case "text", "msg", "info":
			msg = v
		}
	}
	if !strings.Contains(strings.ToLower(text), "text=") && !strings.Contains(strings.ToLower(text), "type=") {
		msg = strings.TrimSpace(text)
	}
	content := []byte(msg)
	body := make([]byte, 5+len(content))
	body[0] = infoType
	binary.BigEndian.PutUint32(body[1:5], uint32(len(content)))
	copy(body[5:], content)
	return body
}

// wrap8601Body builds 0x8601 delete circular area: 0=all, else count + DWORD ids.
func wrap8601Body(text string) []byte {
	t := strings.TrimSpace(strings.ToLower(text))
	if t == "" || t == "all" || t == "0" {
		return []byte{0}
	}
	parts := strings.FieldsFunc(t, func(r rune) bool {
		return r == ',' || r == ' ' || r == ';'
	})
	ids := make([]uint32, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimPrefix(p, "0x")
		n, err := strconv.ParseUint(p, 10, 32)
		if err != nil {
			n, err = strconv.ParseUint(p, 16, 32)
		}
		if err == nil {
			ids = append(ids, uint32(n))
		}
	}
	if len(ids) == 0 {
		return []byte{0}
	}
	if len(ids) > 255 {
		ids = ids[:255]
	}
	body := make([]byte, 1+4*len(ids))
	body[0] = byte(len(ids))
	for i, id := range ids {
		binary.BigEndian.PutUint32(body[1+i*4:], id)
	}
	return body
}

// parseAreaQueryResp maps 0x0608 area/route query response (type + count + first area).
func parseAreaQueryResp(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0608", "area_resp_len": len(body)}
	qType := 0
	if len(body) >= 1 {
		qType = int(body[0])
		out["area_query_type"] = qType
	}
	if len(body) >= 5 {
		out["area_count"] = int(binary.BigEndian.Uint32(body[1:5]))
	}
	rec := body
	if len(rec) > 5 {
		rec = rec[5:]
	} else {
		rec = nil
	}
	// First record: id(4)+attr(2)+…
	if len(rec) >= 6 {
		out["geofence.id"] = binary.BigEndian.Uint32(rec[0:4])
		out["geofence.attr"] = int(binary.BigEndian.Uint16(rec[4:6]))
	}
	switch qType {
	case 1: // circle: lat, lon, radius
		if len(rec) >= 18 {
			out["geofence.lat"] = float64(int32(binary.BigEndian.Uint32(rec[6:10]))) / 1e6
			out["geofence.lon"] = float64(int32(binary.BigEndian.Uint32(rec[10:14]))) / 1e6
			out["geofence.radius"] = binary.BigEndian.Uint32(rec[14:18])
		}
	case 2: // rectangle: NW + SE corners
		if len(rec) >= 22 {
			out["geofence.lat1"] = float64(int32(binary.BigEndian.Uint32(rec[6:10]))) / 1e6
			out["geofence.lon1"] = float64(int32(binary.BigEndian.Uint32(rec[10:14]))) / 1e6
			out["geofence.lat2"] = float64(int32(binary.BigEndian.Uint32(rec[14:18]))) / 1e6
			out["geofence.lon2"] = float64(int32(binary.BigEndian.Uint32(rec[18:22]))) / 1e6
		}
	case 3: // polygon: vertex count + first vertex
		if len(rec) >= 8 {
			out["geofence.vertex_count"] = int(binary.BigEndian.Uint16(rec[6:8]))
		}
		if len(rec) >= 16 {
			out["geofence.lat"] = float64(int32(binary.BigEndian.Uint32(rec[8:12]))) / 1e6
			out["geofence.lon"] = float64(int32(binary.BigEndian.Uint32(rec[12:16]))) / 1e6
		}
	case 4: // route: id+attr+width+inflection count + first point (partial)
		if len(rec) >= 8 {
			out["route.width"] = int(binary.BigEndian.Uint16(rec[6:8]))
		}
		if len(rec) >= 10 {
			out["route.point_count"] = int(binary.BigEndian.Uint16(rec[8:10]))
		}
		if len(rec) >= 18 {
			out["route.lat"] = float64(int32(binary.BigEndian.Uint32(rec[10:14]))) / 1e6
			out["route.lon"] = float64(int32(binary.BigEndian.Uint32(rec[14:18]))) / 1e6
		}
	}
	snip := body
	if len(snip) > 48 {
		snip = snip[:48]
	}
	out["area_head_hex"] = fmt.Sprintf("%x", snip)
	return out
}

// wrap8700Cmd maps Admin text to a common driving-record collect command byte.
func wrap8700Cmd(text string) byte {
	switch strings.TrimSpace(strings.ToLower(text)) {
	case "", "collect", "0x00", "0":
		return 0x00
	case "standard", "0x01", "1":
		return 0x01
	default:
		if n, err := strconv.ParseUint(strings.TrimPrefix(strings.TrimSpace(text), "0x"), 16, 8); err == nil {
			return byte(n)
		}
		return 0x00
	}
}

// parseSubpkgRetransmit maps 0x0005 (first packet id + total + id list) for status.
func parseSubpkgRetransmit(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0005", "retransmit_len": len(body)}
	if len(body) >= 2 {
		out["first_packet_id"] = int(binary.BigEndian.Uint16(body[0:2]))
	}
	if len(body) >= 3 {
		out["retransmit_count"] = int(body[2])
	}
	snip := body
	if len(snip) > 32 {
		snip = snip[:32]
	}
	out["retransmit_hex"] = fmt.Sprintf("%x", snip)
	return out
}

// wrap8801Body builds a minimal 0x8801 camera command (channel + 1 shot + defaults).
// text: channel number ("1") or "ch=N"; empty → channel 1.
func wrap8801Body(text string) []byte {
	ch := byte(1)
	t := strings.TrimSpace(strings.ToLower(text))
	if strings.HasPrefix(t, "ch=") {
		t = strings.TrimPrefix(t, "ch=")
	}
	if n, err := strconv.Atoi(t); err == nil && n >= 0 && n <= 255 {
		ch = byte(n)
	}
	// channel, cmd=1 (one photo), interval=0, save=0, res=0, quality=5, brightness/contrast/sat/chroma=0
	body := make([]byte, 12)
	body[0] = ch
	body[1] = 1
	body[5] = 5
	return body
}

// wrap8804Body builds 0x8804 recording command: cmd + time + save + sample rate.
// text: "stop" | "start" | "cmd=1,time=60,save=0,rate=0".
func wrap8804Body(text string) []byte {
	cmd, save, rate := byte(1), byte(0), byte(0)
	timeSec := uint16(60)
	t := strings.TrimSpace(strings.ToLower(text))
	switch {
	case t == "" || t == "start":
		// defaults
	case t == "stop" || t == "0":
		cmd = 0
		timeSec = 0
	default:
		for _, part := range strings.Split(t, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) == 1 {
				if n, err := strconv.Atoi(kv[0]); err == nil && n >= 0 {
					timeSec = uint16(n)
				}
				continue
			}
			k, v := kv[0], kv[1]
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 {
				continue
			}
			switch k {
			case "cmd", "command":
				if n <= 255 {
					cmd = byte(n)
				}
			case "time", "sec", "duration":
				timeSec = uint16(n)
			case "save":
				if n <= 255 {
					save = byte(n)
				}
			case "rate", "sample":
				if n <= 255 {
					rate = byte(n)
				}
			}
		}
	}
	body := make([]byte, 5)
	body[0] = cmd
	binary.BigEndian.PutUint16(body[1:3], timeSec)
	body[3] = save
	body[4] = rate
	return body
}

// wrap8803Body builds 0x8803 multimedia upload control: type + channel + cmd.
// text: "stop" / "start" / "type=0,ch=1,cmd=0".
func wrap8803Body(text string) []byte {
	mediaType, ch, cmd := byte(0), byte(1), byte(0)
	t := strings.TrimSpace(strings.ToLower(text))
	switch t {
	case "stop", "0":
		cmd = 0
	case "start", "1":
		cmd = 1
	default:
		for _, part := range strings.Split(t, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := kv[0], kv[1]
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || n > 255 {
				continue
			}
			switch k {
			case "type", "media_type":
				mediaType = byte(n)
			case "ch", "channel":
				ch = byte(n)
			case "cmd", "command":
				cmd = byte(n)
			}
		}
	}
	return []byte{mediaType, ch, cmd}
}

// wrap8805Body builds 0x8805 single multimedia upload/retrieve by id.
// text: "99" / "id=99" / "media_id=99".
func wrap8805Body(text string) []byte {
	var id uint32
	t := strings.TrimSpace(text)
	for _, part := range strings.Split(t, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) == 2 {
			k := strings.ToLower(kv[0])
			if k == "id" || k == "media_id" || k == "media" {
				if n, err := strconv.ParseUint(strings.TrimSpace(kv[1]), 10, 32); err == nil {
					id = uint32(n)
				}
			}
			continue
		}
		if n, err := strconv.ParseUint(strings.TrimSpace(part), 10, 32); err == nil {
			id = uint32(n)
		}
	}
	body := make([]byte, 4)
	binary.BigEndian.PutUint32(body, id)
	return body
}

// wrap8900Body builds 0x8900 downlink transparent: type BYTE + content.
// text: "type=0,text=ping" or plain content (type=0).
func wrap8900Body(text string) []byte {
	typ := byte(0)
	msg := strings.TrimSpace(text)
	for _, part := range strings.Split(msg, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), kv[1]
		switch k {
		case "type":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 255 {
				typ = byte(n)
			}
		case "text", "msg", "data":
			msg = v
		}
	}
	if !strings.Contains(strings.ToLower(text), "text=") && !strings.Contains(strings.ToLower(text), "type=") {
		msg = strings.TrimSpace(text)
	}
	return append([]byte{typ}, []byte(msg)...)
}

// wrap8802Body builds 0x8802 stored multimedia retrieval (type+ch+event+start/end BCD).
// text: "type=0,ch=1,event=0" — zero BCD times = unrestricted range (partial).
func wrap8802Body(text string) []byte {
	mediaType, ch, event := byte(0), byte(1), byte(0)
	for _, part := range strings.Split(strings.TrimSpace(text), ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k, v := strings.ToLower(kv[0]), strings.TrimSpace(kv[1])
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > 255 {
			continue
		}
		switch k {
		case "type", "media_type":
			mediaType = byte(n)
		case "ch", "channel":
			ch = byte(n)
		case "event", "event_code":
			event = byte(n)
		}
	}
	body := make([]byte, 15)
	body[0] = mediaType
	body[1] = ch
	body[2] = event
	// body[3:15] start/end BCD stay zero → all stored items in range
	return body
}

// parseMultimediaRetrieveResp maps 0x0802 retrieval response (seq + count + first item).
func parseMultimediaRetrieveResp(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0802", "media_retrieve_len": len(body)}
	if len(body) >= 2 {
		out["reply_seq"] = int(binary.BigEndian.Uint16(body[0:2]))
	}
	if len(body) >= 6 {
		out["media_count"] = int(binary.BigEndian.Uint32(body[2:6]))
	}
	// First item: media_id(4) + type(1) + channel(1) + event(1) …
	if len(body) >= 10 {
		out["media_id"] = binary.BigEndian.Uint32(body[6:10])
	}
	if len(body) >= 11 {
		out["media_type"] = int(body[10])
	}
	if len(body) >= 12 {
		out["media_channel"] = int(body[11])
	}
	if len(body) >= 13 {
		out["media_event"] = int(body[12])
	}
	snip := body
	if len(snip) > 48 {
		snip = snip[:48]
	}
	out["media_retrieve_hex"] = fmt.Sprintf("%x", snip)
	return out
}

// wrap8202Body: "interval[,validity]" seconds — defaults 10s interval, 60s validity.
func wrap8202Body(text string) []byte {
	interval, validity := uint16(10), uint32(60)
	parts := strings.Split(strings.TrimSpace(text), ",")
	if len(parts) >= 1 {
		if n, err := strconv.Atoi(strings.TrimSpace(parts[0])); err == nil && n >= 0 {
			interval = uint16(n)
		}
	}
	if len(parts) >= 2 {
		if n, err := strconv.Atoi(strings.TrimSpace(parts[1])); err == nil && n >= 0 {
			validity = uint32(n)
		}
	}
	body := make([]byte, 6)
	binary.BigEndian.PutUint16(body[0:2], interval)
	binary.BigEndian.PutUint32(body[2:6], validity)
	return body
}

// parseDrivingRecord maps 0x0700 driving-record uplink (command word + data snippet).
func parseDrivingRecord(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0700", "drv_len": len(body)}
	if len(body) >= 1 {
		cmd := int(body[0])
		out["drv_cmd"] = cmd
		if name, ok := drivingRecordCmdName[cmd]; ok {
			out["drv_cmd_name"] = name
		}
	}
	snip := body
	if len(snip) > 48 {
		snip = snip[:48]
	}
	out["drv_head_hex"] = fmt.Sprintf("%x", snip)
	return out
}

// drivingRecordCmdName maps common GB/T 19056 / JT808 0x0700 command bytes (partial).
var drivingRecordCmdName = map[int]string{
	0x00: "exec_std_version",
	0x01: "current_driver",
	0x02: "real_time_clock",
	0x03: "odometer",
	0x04: "pulse_factor",
	0x05: "vehicle_info",
	0x06: "status_signal_config",
	0x07: "unique_number",
	0x08: "speed_status_log",
	0x09: "doubtful_points",
	0x10: "timeout_driving",
	0x11: "driver_identity",
	0x12: "power_log",
	0x13: "param_modify_log",
	0x14: "speed_status_log_ext",
}

// bcdNowUTC6 returns YYMMDDhhmmss as 6 BCD bytes (JT808 server time 0x8004).
func bcdNowUTC6() []byte {
	t := time.Now().UTC()
	dig := func(n int) byte { return byte((n/10)%10<<4 | n%10) }
	yy := t.Year() % 100
	return []byte{
		dig(yy), dig(int(t.Month())), dig(t.Day()),
		dig(t.Hour()), dig(t.Minute()), dig(t.Second()),
	}
}

// parseCANBus stores 0x0705 CAN uplink: count + BCD time + per-item id/data (partial — no signal decode).
func parseCANBus(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0705", "can_len": len(body)}
	if len(body) < 2 {
		return out
	}
	count := int(binary.BigEndian.Uint16(body[0:2]))
	out["can_item_count"] = count
	off := 2
	if off+5 <= len(body) {
		out["can_time_bcd"] = fmt.Sprintf("%x", body[off:off+5])
		off += 5
	}
	const itemSize = 12 // DWORD id + 8 data
	maxItems := 8
	if count < maxItems {
		maxItems = count
	}
	parsed := 0
	for i := 0; i < maxItems && off+itemSize <= len(body); i++ {
		id := binary.BigEndian.Uint32(body[off : off+4])
		data := body[off+4 : off+12]
		out[fmt.Sprintf("can.%d.id", i)] = int(id)
		out[fmt.Sprintf("can.%d.data", i)] = fmt.Sprintf("%x", data)
		out[fmt.Sprintf("can.%d.data0", i)] = int(data[0])
		out[fmt.Sprintf("can.%d.data1", i)] = int(data[1])
		if i == 0 {
			out["can.first_id"] = int(id)
			out["can.first_data"] = fmt.Sprintf("%x", data)
		}
		off += itemSize
		parsed++
	}
	out["can_parsed"] = parsed
	snip := body
	if len(snip) > 48 {
		snip = snip[:48]
	}
	out["can_head_hex"] = fmt.Sprintf("%x", snip)
	return out
}

// parseCameraShootResp maps 0x0805 camera immediate-shoot response (no media body).
func parseCameraShootResp(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0805", "shoot_hex": fmt.Sprintf("%x", body)}
	if len(body) >= 2 {
		out["reply_seq"] = int(binary.BigEndian.Uint16(body[0:2]))
	}
	if len(body) >= 3 {
		r := int(body[2]) // 0=ok
		out["shoot_result"] = r
		out["shoot_ok"] = r == 0
	}
	if len(body) >= 4 {
		n := int(body[3])
		out["media_id_count"] = n
		ids := make([]uint32, 0, n)
		off := 4
		for i := 0; i < n && off+4 <= len(body); i++ {
			ids = append(ids, binary.BigEndian.Uint32(body[off:off+4]))
			off += 4
		}
		if len(ids) > 0 {
			out["media_ids"] = ids
			out["media_id"] = int(ids[0])
		}
	}
	return out
}

// parseMultimediaData stores 0x0800 multimedia data header (id/type/channel/event); body truncated.
func parseMultimediaData(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0800", "media_data_len": len(body)}
	if len(body) >= 4 {
		out["media_id"] = binary.BigEndian.Uint32(body[0:4])
	}
	if len(body) >= 5 {
		out["media_type"] = int(body[4])
	}
	if len(body) >= 6 {
		out["media_code"] = int(body[5])
	}
	if len(body) >= 7 {
		out["media_channel"] = int(body[6])
	}
	if len(body) >= 8 {
		out["media_event"] = int(body[7])
	}
	if len(body) >= 36 {
		out["media_has_location"] = true
	}
	if len(body) > 8 {
		snip := body[8:]
		if len(snip) > 32 {
			snip = snip[:32]
		}
		out["media_head_hex"] = fmt.Sprintf("%x", snip)
	}
	return out
}

// parseTransparent stores 0x0900 transparent uplink (type + payload snippet).
func parseTransparent(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0900"}
	if len(body) < 1 {
		out["transparent_hex"] = ""
		return out
	}
	typ := int(body[0])
	out["transparent_type"] = typ
	switch typ {
	case 0x00:
		out["transparent_kind"] = "gnss_detail"
	case 0x0b:
		out["transparent_kind"] = "road_transport"
	case 0xf0:
		out["transparent_kind"] = "vendor"
	}
	rest := body[1:]
	if len(rest) > 64 {
		rest = rest[:64]
	}
	out["transparent_hex"] = fmt.Sprintf("%x", rest)
	if s := strings.TrimRight(string(rest), "\x00 "); s != "" && isPrintableASCII(s) {
		out["transparent_text"] = s
	}
	return out
}

func isPrintableASCII(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 32 || c > 126 {
			return false
		}
	}
	return true
}

// parseWaybill stores 0x0701 electronic waybill length + text snippet.
func parseWaybill(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0701", "waybill_hex": fmt.Sprintf("%x", body)}
	if len(body) < 4 {
		return out
	}
	n := int(binary.BigEndian.Uint32(body[0:4]))
	out["waybill_len"] = n
	if n > 0 && 4+n <= len(body) {
		text := strings.TrimRight(string(body[4:4+n]), "\x00 ")
		if len(text) > 120 {
			text = text[:120]
		}
		out["waybill_text"] = text
		out["waybill.text"] = text
	}
	return out
}

// parseTerminalAttrs extracts remappable keys from 0x0107 (best-effort layout).
func parseTerminalAttrs(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0107", "attrs_hex": fmt.Sprintf("%x", body)}
	if len(body) < 1 {
		return out
	}
	out["terminal_type"] = int(body[0])
	off := 1
	if len(body) >= off+5 {
		out["manufacturer"] = strings.TrimRight(string(body[off:off+5]), "\x00 ")
		off += 5
	}
	if len(body) >= off+20 {
		out["terminal_model"] = strings.TrimRight(string(body[off:off+20]), "\x00 ")
		off += 20
	}
	if len(body) >= off+7 {
		out["terminal_id"] = strings.TrimRight(string(body[off:off+7]), "\x00 ")
		off += 7
	}
	if len(body) >= off+10 {
		out["iccid"] = bcdPhone(body[off : off+10])
	}
	return out
}

// safetyFromEventID maps common JT808 0x0301 event ids to safety (partial set).
// IDs follow common platform tables (vendor-specific beyond 1–3).
func safetyFromEventID(evID int, protocol string) *store.SafetyEvent {
	name := ""
	level := 1
	switch evID {
	case 0: // reserved / custom
		return nil
	case 1:
		name, level = "sos", 2
	case 2:
		name, level = "speeding", 1
	case 3:
		name, level = "fatigue", 2
	case 4:
		name, level = "danger", 2
	case 5:
		name = "enter_area" // geofence in
	case 6:
		name = "leave_area" // geofence out
	case 7:
		name = "enter_route"
	case 8:
		name = "leave_route"
	case 9:
		name, level = "overspeed_road", 1
	case 10:
		name, level = "underspeed_road", 1
	case 11:
		name = "depart_route" // route deviation
	case 12:
		name, level = "collision", 2
	case 13:
		name = "rollover"
		level = 2
	case 14:
		name = "driver_change"
	default:
		name = fmt.Sprintf("event_%d", evID)
	}
	raw := map[string]any{"event_id": evID, "alarm." + name: true}
	return &store.SafetyEvent{
		AlarmType: name, AlarmLevel: level, RawAttrs: raw, SourceProtocol: protocol,
	}
}

func buildRegisterAck(seq uint16, result byte, authCode string) []byte {
	out := make([]byte, 0, 4+len(authCode))
	tmp := make([]byte, 2)
	binary.BigEndian.PutUint16(tmp, seq)
	out = append(out, tmp...)
	out = append(out, result)
	out = append(out, []byte(authCode)...)
	return out
}

func replyGeneral(conn net.Conn, sess *session, ackMsgID uint16, seq uint16, result byte) error {
	body := make([]byte, 5)
	binary.BigEndian.PutUint16(body[0:2], seq)
	binary.BigEndian.PutUint16(body[2:4], ackMsgID)
	body[4] = result
	return reply(conn, sess, 0x8001, body)
}

func reply(conn net.Conn, sess *session, msgID uint16, body []byte) error {
	sess.seq++
	header := packJT808Header(msgID, body, sess.phone, sess.seq, sess.version2019)
	msg := append(header, body...)
	msg = append(msg, bcc(msg))
	_, err := conn.Write(escape(msg))
	return err
}

// packJT808Header builds 2011/2019 header; optional subpackage (total/index 1-based).
func packJT808Header(msgID uint16, body []byte, phone string, seq uint16, v2019 bool) []byte {
	return packJT808HeaderSub(msgID, body, phone, seq, v2019, 0, 0)
}

func packJT808HeaderSub(msgID uint16, body []byte, phone string, seq uint16, v2019 bool, total, index int) []byte {
	props := uint16(len(body) & 0x3ff)
	if v2019 {
		props |= 0x4000
	}
	if total > 1 && index >= 1 {
		props |= 0x2000
	}
	var header []byte
	if v2019 {
		header = make([]byte, 17)
		binary.BigEndian.PutUint16(header[0:2], msgID)
		binary.BigEndian.PutUint16(header[2:4], props)
		header[4] = 1
		digits := phone
		for len(digits) < 20 {
			digits = "0" + digits
		}
		if len(digits) > 20 {
			digits = digits[len(digits)-20:]
		}
		for i := 0; i < 10; i++ {
			hi := digits[i*2] - '0'
			lo := digits[i*2+1] - '0'
			header[5+i] = (hi << 4) | lo
		}
		binary.BigEndian.PutUint16(header[15:17], seq)
	} else {
		header = make([]byte, 12)
		binary.BigEndian.PutUint16(header[0:2], msgID)
		binary.BigEndian.PutUint16(header[2:4], props)
		digits := phone
		for len(digits) < 12 {
			digits = "0" + digits
		}
		if len(digits) > 12 {
			digits = digits[len(digits)-12:]
		}
		for i := 0; i < 6; i++ {
			hi := digits[i*2] - '0'
			lo := digits[i*2+1] - '0'
			header[4+i] = (hi << 4) | lo
		}
		binary.BigEndian.PutUint16(header[10:12], seq)
	}
	if total > 1 && index >= 1 {
		pkg := make([]byte, 4)
		binary.BigEndian.PutUint16(pkg[0:2], uint16(total))
		binary.BigEndian.PutUint16(pkg[2:4], uint16(index))
		header = append(header, pkg...)
	}
	return header
}

func ingestLocation(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry, sess *session, body []byte, protoHint string) {
	fix, ok := parseLocation(body)
	if !ok {
		return
	}
	if sess.device == nil {
		sess.device = deviceauth.FindByIMEI(ctx, st, sess.phone, conn.RemoteAddr().String(), protoHint)
		bindSession(sessions, sess, conn)
	}
	if sess.device == nil {
		return
	}
	fix.SourceProtocol = protoHint
	add := parseAdditionalInfo(body)
	if fix.RawAttrs == nil {
		fix.RawAttrs = map[string]any{}
	}
	if len(add) > 0 {
		fix.RawAttrs["add"] = add
		for k, v := range add {
			fix.RawAttrs["add."+k] = v
		}
		hoistLocationTLV(add, fix.RawAttrs)
		if v, ok := add["0x01"].(float64); ok {
			fix.Odometer = &v
		}
		if ev := safetyFromAdditional(add, fix, protoHint); ev != nil {
			_ = st.InsertSafetyEvent(ctx, sess.device, *ev)
		}
	}
	if alarm, _ := fix.RawAttrs["alarm"].(uint32); alarm != 0 {
		if ev := safetyFromAlarmWord(alarm, fix, protoHint); ev != nil {
			_ = st.InsertSafetyEvent(ctx, sess.device, *ev)
		}
	}
	if err := deviceauth.Ingest(ctx, st, sess.device, fix); err != nil {
		log.Printf("[%s] ingest %s: %v", protoHint, sess.phone, err)
	}
}

func parseLocation(body []byte) (store.Fix, bool) {
	if len(body) < 28 {
		return store.Fix{}, false
	}
	// alarm 4, status 4, lat 4, lon 4, alt 2, speed 2, direction 2, time 6 BCD
	alarm := binary.BigEndian.Uint32(body[0:4])
	latRaw := binary.BigEndian.Uint32(body[8:12])
	lonRaw := binary.BigEndian.Uint32(body[12:16])
	alt := int(binary.BigEndian.Uint16(body[16:18]))
	speed := float64(binary.BigEndian.Uint16(body[18:20])) / 10.0
	dir := float64(binary.BigEndian.Uint16(body[20:22]))
	ts := parseBcdTime(body[22:28])
	lat := float64(latRaw) / 1e6
	lon := float64(lonRaw) / 1e6
	status := binary.BigEndian.Uint32(body[4:8])
	if status&0x04 != 0 { // south latitude
		lat = -lat
	}
	if status&0x08 != 0 { // west longitude
		lon = -lon
	}
	altF := float64(alt)
	ign := status&0x01 != 0
	raw := map[string]any{
		"status":     status,
		"alarm":      alarm,
		"status.acc": ign,
	}
	if status&0x02 != 0 {
		raw["status.gps"] = true
	}
	hoistLocationStatusBits(status, raw)
	flattenAlarmBits(alarm, raw)
	return store.Fix{
		Lat:        lat,
		Lon:        lon,
		RecordedAt: ts,
		Speed:      &speed,
		Heading:    &dir,
		Altitude:   &altF,
		Ignition:   &ign,
		RawAttrs:   raw,
	}, true
}

func parseBcdTime(b []byte) time.Time {
	if len(b) < 6 {
		return time.Now().UTC()
	}
	decode := func(v byte) int { return int(v>>4)*10 + int(v&0x0f) }
	year := 2000 + decode(b[0])
	month := decode(b[1])
	day := decode(b[2])
	hour := decode(b[3])
	min := decode(b[4])
	sec := decode(b[5])
	return time.Date(year, time.Month(month), day, hour, min, sec, 0, time.UTC)
}
