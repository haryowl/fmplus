package jt808

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
	phone  string
	device *store.Device
	seq    uint16
	label  string
	bound  *protocol.ConnSession
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry, label string) {
	metrics.ConnOpen()
	sess := &session{label: label}
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
	bound := &protocol.ConnSession{
		DeviceID: sess.device.ID,
		IMEI:     sess.device.IMEI,
		Protocol: sess.label,
		Conn:     conn,
		Meta:     map[string]string{"phone": sess.phone},
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
		payload := encodeJT808Downlink(sess.phone, &sess.seq, cmd)
		if len(payload) == 0 {
			return
		}
		if _, err := conn.Write(payload); err != nil {
			return
		}
		_ = st.MarkCommandSent(ctx, cmd.ID)
	}
}

func encodeJT808Downlink(phone string, seq *uint16, cmd *store.Command) []byte {
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
		body = append([]byte{1}, raw...)
	case "jt808_8500", "control", "vehicle_control":
		msgID = 0x8500
		flag := byte(0)
		if text == "1" || text == "cut" || text == "oil_cut" {
			flag = 1
		}
		if len(cmd.PayloadBytes()) > 0 {
			flag = cmd.PayloadBytes()[0]
		}
		body = []byte{flag}
	default:
		body = append([]byte{0x01}, []byte(text)...)
	}
	return buildDownlinkFrame(phone, seq, msgID, body)
}

func buildDownlinkFrame(phone string, seq *uint16, msgID uint16, body []byte) []byte {
	header := make([]byte, 12)
	binary.BigEndian.PutUint16(header[0:2], msgID)
	binary.BigEndian.PutUint16(header[2:4], uint16(len(body)&0x3ff))
	phoneDigits := phone
	for len(phoneDigits) < 12 {
		phoneDigits = "0" + phoneDigits
	}
	if len(phoneDigits) > 12 {
		phoneDigits = phoneDigits[len(phoneDigits)-12:]
	}
	for i := 0; i < 6; i++ {
		hi := phoneDigits[i*2] - '0'
		lo := phoneDigits[i*2+1] - '0'
		header[4+i] = (hi << 4) | lo
	}
	if seq != nil {
		*seq++
		binary.BigEndian.PutUint16(header[10:12], *seq)
	} else {
		binary.BigEndian.PutUint16(header[10:12], 1)
	}
	msg := append(header, body...)
	msg = append(msg, bcc(msg))
	return escape(msg)
}

func handleFrame(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry, sess *session, frame []byte) error {
	raw := unescape(frame)
	if len(raw) < 13 {
		return nil
	}
	bodyWithBcc := raw
	msg := bodyWithBcc[:len(bodyWithBcc)-1]
	if bcc(msg) != bodyWithBcc[len(bodyWithBcc)-1] {
		return nil
	}
	msgID := binary.BigEndian.Uint16(msg[0:2])
	bodyProps := binary.BigEndian.Uint16(msg[2:4])
	bodyLen := int(bodyProps & 0x3ff)
	phone := bcdPhone(msg[4:10])
	seq := binary.BigEndian.Uint16(msg[10:12])
	body := msg[12:]
	if bodyLen > len(body) {
		bodyLen = len(body)
	}
	body = body[:bodyLen]
	sess.phone = phone
	sess.seq = seq
	protoHint := sess.label
	if protoHint == "" {
		protoHint = "jt808"
	}

	switch msgID {
	case 0x0100: // terminal register
		return reply(conn, sess, 0x8100, buildRegisterAck(seq, 0, "FM1"))
	case 0x0102: // auth
		remote := conn.RemoteAddr().String()
		sess.device = deviceauth.FindByIMEI(ctx, st, phone, remote, protoHint)
		if sess.device == nil {
			sess.device = deviceauth.FindByIMEI(ctx, st, bcdPhone(msg[4:10]), remote, protoHint)
		}
		bindSession(sessions, sess, conn)
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0001: // terminal general response (command ack)
		if sess.device != nil && len(body) >= 5 {
			result := body[4]
			respMsg := binary.BigEndian.Uint16(body[2:4])
			ok := result == 0
			_ = st.AckLatestSent(ctx, sess.device.ID, ok,
				fmt.Sprintf("jt808_0001 msg=0x%04x result=%d", respMsg, result))
		}
		return nil // no reply to a reply
	case 0x0104: // query terminal params response
		if sess.device != nil {
			_ = st.AckLatestSent(ctx, sess.device.ID, true,
				fmt.Sprintf("jt808_0104 len=%d hex=%x", len(body), body))
			_ = st.TouchSeen(ctx, sess.device)
		}
		return replyGeneral(conn, sess, msgID, seq, 0)
	case 0x0002: // heartbeat
		if sess.device != nil {
			_ = st.TouchSeen(ctx, sess.device)
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
	header := make([]byte, 12)
	binary.BigEndian.PutUint16(header[0:2], msgID)
	binary.BigEndian.PutUint16(header[2:4], uint16(len(body)&0x3ff))
	// phone BCD — pack from sess.phone digits
	phoneDigits := sess.phone
	for len(phoneDigits) < 12 {
		phoneDigits = "0" + phoneDigits
	}
	if len(phoneDigits) > 12 {
		phoneDigits = phoneDigits[len(phoneDigits)-12:]
	}
	for i := 0; i < 6; i++ {
		hi := phoneDigits[i*2] - '0'
		lo := phoneDigits[i*2+1] - '0'
		header[4+i] = (hi << 4) | lo
	}
	binary.BigEndian.PutUint16(header[10:12], sess.seq)
	msg := append(header, body...)
	msg = append(msg, bcc(msg))
	_, err := conn.Write(escape(msg))
	return err
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
