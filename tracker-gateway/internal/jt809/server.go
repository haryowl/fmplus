package jt809

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve a JT/T 809 platform-exchange listener (experimental 0x5B framing + CRC + login/HB/0x1200/0x1400).
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
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 2048)
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		n, err := conn.Read(tmp)
		if err != nil {
			return
		}
		buf = append(buf, tmp[:n]...)
		for {
			payload, rest, ok := takeFrame809(buf)
			if !ok {
				if rest != nil {
					buf = rest
				}
				// Legacy fallback: raw length-prefixed header without 0x5B (lab tools).
				if len(buf) >= 22 && buf[0] != 0x5b {
					if handled, remain := tryLegacyFrame(ctx, conn, st, sessions, &bound, &platformKey, buf); handled {
						buf = remain
						continue
					}
				}
				break
			}
			buf = rest
			if len(payload) < 22 {
				metrics.DecodeErr()
				continue
			}
			handleMessage(ctx, conn, st, sessions, &bound, &platformKey, payload)
		}
		if len(buf) > 2*1024*1024 {
			return
		}
		// Drop leading junk if no frame start soon.
		if len(buf) > 64*1024 && buf[0] != 0x5b {
			buf = buf[1:]
		}
	}
}

func tryLegacyFrame(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry,
	bound **protocol.ConnSession, platformKey *string, buf []byte) (bool, []byte) {
	length := int(binary.BigEndian.Uint32(buf[0:4]))
	if length < 22 || length > 2*1024*1024 || len(buf) < length {
		return false, buf
	}
	payload := buf[:length]
	handleMessage(ctx, conn, st, sessions, bound, platformKey, payload)
	return true, buf[length:]
}

func handleMessage(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry,
	bound **protocol.ConnSession, platformKey *string, payload []byte) {
	length := int(binary.BigEndian.Uint32(payload[0:4]))
	if length < 22 || length > len(payload) {
		// Some peers set MsgLength to full packet; tolerate payload-as-body.
		length = len(payload)
	}
	msgID := binary.BigEndian.Uint16(payload[8:10])
	encryptFlag := byte(0)
	if len(payload) > 18 {
		encryptFlag = payload[18]
	}
	rest := payload[22:]
	if length > 22 && length <= len(payload) {
		rest = payload[22:length]
	}
	if encryptFlag != 0 && msgID != 0x1001 && msgID != 0x1005 && msgID != 0x1003 && msgID != 0x1007 {
		// Encrypted vehicle bodies need platform key exchange — skip decode (honest experimental).
		log.Printf("[jt809] msg 0x%04x encrypt=%d — skip body decode (no key)", msgID, encryptFlag)
		return
	}
	switch msgID {
	case 0x1001: // login
		if len(rest) >= 4 {
			*platformKey = fmt.Sprintf("809-%d", binary.BigEndian.Uint32(rest[0:4]))
		}
		sess := &protocol.ConnSession{
			DeviceID: "",
			IMEI:     *platformKey,
			Protocol: "jt809",
			Conn:     conn,
			Meta:     map[string]string{"role": "platform"},
		}
		if sessions != nil {
			if *bound != nil {
				sessions.Unbind(*bound)
			}
			sessions.Bind(sess)
		}
		*bound = sess
		respBody := make([]byte, 26)
		binary.BigEndian.PutUint32(respBody[0:4], 26)
		binary.BigEndian.PutUint16(respBody[8:10], 0x1002)
		respBody[22] = 0 // result OK
		_, _ = conn.Write(wrapFrame809(respBody))
		log.Printf("[jt809] platform login ok key=%s", *platformKey)
	case 0x1005: // heartbeat
		respBody := make([]byte, 22)
		binary.BigEndian.PutUint32(respBody[0:4], 22)
		binary.BigEndian.PutUint16(respBody[8:10], 0x1006)
		_, _ = conn.Write(wrapFrame809(respBody))
	case 0x1003: // main-link logout from subordinate
		if sessions != nil && *bound != nil {
			sessions.Unbind(*bound)
			*bound = nil
		}
		respBody := make([]byte, 22)
		binary.BigEndian.PutUint32(respBody[0:4], 22)
		binary.BigEndian.PutUint16(respBody[8:10], 0x1004) // logout ack
		_, _ = conn.Write(wrapFrame809(respBody))
		log.Printf("[jt809] platform logout key=%s", *platformKey)
	case 0x1007: // main-link disconnect notify from subordinate
		if sessions != nil && *bound != nil {
			sessions.Unbind(*bound)
			*bound = nil
		}
		respBody := make([]byte, 22)
		binary.BigEndian.PutUint32(respBody[0:4], 22)
		binary.BigEndian.PutUint16(respBody[8:10], 0x1008) // disconnect ack
		_, _ = conn.Write(wrapFrame809(respBody))
		log.Printf("[jt809] platform disconnect key=%s", *platformKey)
	case 0x1200, 0x1202, 0x1203: // realtime / history location (0x1203 experimental same parse)
		fix, plate, ok := parseVehicleUplink(msgID, rest)
		if !ok {
			log.Printf("[jt809] vehicle uplink 0x%04x len=%d (no fix)", msgID, length)
			break
		}
		device := find809Device(ctx, st, plate, *platformKey, conn.RemoteAddr().String())
		if device != nil {
			if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
				log.Printf("[jt809] ingest %s: %v", plate, err)
			}
		} else {
			log.Printf("[jt809] vehicle uplink 0x%04x plate=%q (unregistered)", msgID, plate)
		}
	case 0x1201: // vehicle static / registration notify (experimental)
		plate, patch, ok := parseVehicleStatic(rest)
		if !ok {
			log.Printf("[jt809] 0x1201 len=%d (no parse)", length)
			break
		}
		device := find809Device(ctx, st, plate, *platformKey, conn.RemoteAddr().String())
		if device != nil {
			_ = st.PatchLastStatus(ctx, device, patch, nil)
			_ = st.TouchSeen(ctx, device)
		} else {
			log.Printf("[jt809] 0x1201 plate=%q (unregistered)", plate)
		}
	case 0x1400, 0x1402:
		plate, ev, ok := parseVehicleAlarm(msgID, rest)
		if !ok || ev == nil {
			log.Printf("[jt809] alarm 0x%04x len=%d (no parse)", msgID, length)
			break
		}
		device := find809Device(ctx, st, plate, *platformKey, conn.RemoteAddr().String())
		if device != nil {
			_ = st.InsertSafetyEvent(ctx, device, *ev)
			_ = st.PatchLastStatus(ctx, device, ev.RawAttrs, nil)
		} else {
			log.Printf("[jt809] alarm 0x%04x plate=%q type=%s (unregistered)", msgID, plate, ev.AlarmType)
		}
	case 0x1500: // vehicle added / platform vehicle list notify (experimental — plate only)
		plate := ""
		if len(rest) >= 21 {
			plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
		}
		device := find809Device(ctx, st, plate, *platformKey, conn.RemoteAddr().String())
		patch := map[string]any{"proto_msg": "0x1500", "vehicle_plate": plate, "body_len": len(rest)}
		if len(rest) >= 22 {
			patch["vehicle_color"] = int(rest[21])
		}
		if device != nil {
			_ = st.PatchLastStatus(ctx, device, patch, nil)
			_ = st.TouchSeen(ctx, device)
		} else {
			log.Printf("[jt809] 0x1500 plate=%q (unregistered)", plate)
		}
	case 0x1601, 0x1602: // media upload notify / complete (experimental — plate + size)
		plate := ""
		if len(rest) >= 21 {
			plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
		}
		device := find809Device(ctx, st, plate, *platformKey, conn.RemoteAddr().String())
		patch := map[string]any{
			"proto_msg":     fmt.Sprintf("0x%04x", msgID),
			"vehicle_plate": plate,
			"body_len":      len(rest),
		}
		if msgID == 0x1602 {
			patch["media_complete"] = true
		}
		if len(rest) >= 22 {
			patch["media_type"] = int(rest[21])
		}
		if len(rest) >= 26 {
			patch["media_size"] = int(binary.BigEndian.Uint32(rest[22:26]))
		}
		if device != nil {
			_ = st.PatchLastStatus(ctx, device, patch, nil)
			_ = st.TouchSeen(ctx, device)
		} else {
			log.Printf("[jt809] 0x%04x plate=%q (unregistered)", msgID, plate)
		}
	default:
		log.Printf("[jt809] msg 0x%04x len=%d (experimental — not fully decoded)", msgID, length)
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
