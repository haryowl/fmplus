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
	if sess.device == nil {
		return
	}
	for i := 0; i < 8; i++ {
		cmd, err := st.NextPendingCommand(ctx, sess.device.ID)
		if err != nil || cmd == nil {
			return
		}
		if sess.phone == "" {
			_ = st.RequeueCommand(ctx, cmd.ID)
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
	case "jt808_8107", "query_attrs":
		msgID = 0x8107
		body = nil // empty body
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
	default:
		// 0x8300: flag(1)+text. Hex-only Admin payloads skip UTF-8 mangling.
		if cmd.PayloadHex != "" {
			raw := cmd.PayloadBytes()
			if len(raw) == 0 {
				body = append([]byte{0x01}, []byte(text)...)
			} else if raw[0] <= 0x03 {
				body = raw // includes display/flag byte
			} else {
				body = append([]byte{0x01}, raw...)
			}
		} else {
			body = append([]byte{0x01}, []byte(text)...)
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
	if bcc(msg) != bodyWithBcc[len(bodyWithBcc)-1] {
		return nil
	}
	hdr, ok := parseMessageHeader(msg)
	if !ok {
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
	case 0x0100: // terminal register
		return reply(conn, sess, 0x8100, buildRegisterAck(seq, 0, "FM1"))
	case 0x0102: // auth
		remote := conn.RemoteAddr().String()
		sess.device = deviceauth.FindByIMEI(ctx, st, phone, remote, protoHint)
		if sess.device == nil {
			sess.device = deviceauth.FindByIMEI(ctx, st, phone, remote, protoHint)
		}
		bindSession(sessions, sess, conn)
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
	case 0x0108: // terminal upgrade result (pairs with 0x8105 wireless upgrade)
		if sess.device != nil {
			corr := ""
			resultBody := body
			if len(body) >= 3 {
				corr = fmt.Sprintf("%d", binary.BigEndian.Uint16(body[0:2]))
				resultBody = body[2:]
			}
			patch := parseUpgradeResult(resultBody)
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
			ok := true
			if r, has := patch["upgrade_result"].(int); has {
				ok = r == 0
			}
			_ = st.AckCommand(ctx, sess.device.ID, corr, ok,
				fmt.Sprintf("jt808_0108 %v", patch["upgrade_result"]))
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0002: // heartbeat
		if sess.device != nil {
			_ = st.TouchSeen(ctx, sess.device)
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
	case 0x0801: // multimedia event / metadata (no 1078 media stack)
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseMultimediaMeta(body), nil)
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
			_ = st.PatchLastStatus(ctx, sess.device, patch, nil)
			if ev := safetyFromEventID(evID, protoHint); ev != nil {
				_ = st.InsertSafetyEvent(ctx, sess.device, *ev)
			}
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0702: // driver identity information report
		if sess.device != nil {
			_ = st.PatchLastStatus(ctx, sess.device, parseDriverIdentity(body), nil)
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
	case 0x0200: // location
		ingestLocation(ctx, conn, st, sessions, sess, body, protoHint)
		return replyGeneral(conn, sess, msgID, seq, 0)
	default:
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
	out["driver_state"] = int(body[0]) // 0x01 insert, 0x02 pull out (typical)
	off := 1
	if len(body) >= off+6 {
		out["driver_time"] = fmt.Sprintf("%x", body[off:off+6])
		off += 6
	}
	if len(body) >= off+1 {
		out["driver_ic_result"] = int(body[off])
		off++
	}
	if len(body) >= off+1 {
		n := int(body[off])
		off++
		if n > 0 && off+n <= len(body) {
			name := strings.TrimRight(string(body[off:off+n]), "\x00 ")
			out["driver_name"] = name
			off += n
		}
	}
	if off < len(body) {
		// Remaining often: qualification cert ASCII / agency
		rest := strings.TrimRight(string(body[off:]), "\x00 ")
		if rest != "" {
			out["driver_cert"] = rest
		}
	}
	return out
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
		switch n {
		case 1:
			out[key] = int(val[0])
		case 2:
			out[key] = int(binary.BigEndian.Uint16(val))
		case 4:
			out[key] = int(binary.BigEndian.Uint32(val))
		default:
			out[key] = fmt.Sprintf("%x", val)
		}
	}
	out["params_parsed"] = parsed
	complete := parsed == count
	out["params_complete"] = complete
	return out, complete
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
func parseMultimediaMeta(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0801", "media_hex": fmt.Sprintf("%x", body)}
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

// parseTransparent stores 0x0900 transparent uplink (type + payload snippet).
func parseTransparent(body []byte) map[string]any {
	out := map[string]any{"proto_msg": "0x0900"}
	if len(body) < 1 {
		out["transparent_hex"] = ""
		return out
	}
	out["transparent_type"] = int(body[0])
	rest := body[1:]
	if len(rest) > 64 {
		rest = rest[:64]
	}
	out["transparent_hex"] = fmt.Sprintf("%x", rest)
	return out
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
			if isRemappableSafetyKey(k) {
				fix.RawAttrs[k] = v
			}
		}
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
