package jt1078

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve JT/T 1078-style A/V signaling hooks (experimental).
// Media RTP path stays out of process; we ACK control frames and log channel ids.
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[jt1078] listening on %s (status=experimental — signaling only, no RTP)", addr)
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
				log.Printf("[jt1078] accept: %v", err)
				continue
			}
		}
		go handleConn(ctx, conn, st, sessions)
	}
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry) {
	metrics.ConnOpen()
	var bound *protocol.ConnSession
	var device *store.Device
	defer func() {
		metrics.ConnClose()
		if sessions != nil && bound != nil {
			sessions.Unbind(bound)
		}
		_ = conn.Close()
	}()
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 2048)
	channels := map[byte]int{}
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		n, err := conn.Read(tmp)
		if err != nil {
			return
		}
		buf = append(buf, tmp[:n]...)
		// 1078 often uses 0x30 0x31 0x63 0x64 magic + channel
		for len(buf) >= 16 {
			if buf[0] == 0x30 && buf[1] == 0x31 && buf[2] == 0x63 && buf[3] == 0x64 {
				channel := buf[5]
				dataType := buf[4]
				frameLen := int(binary.BigEndian.Uint16(buf[6:8]))
				total := 16 + frameLen
				if frameLen < 0 || total > 2*1024*1024 {
					buf = buf[1:]
					continue
				}
				if len(buf) < total {
					break
				}
				frame := buf[:total]
				channels[channel]++
				meta := map[string]string{
					"channel": fmt.Sprintf("%d", channel),
					"role":    "av-signaling",
				}
				// SIM: ASCII digits in payload, else BCD in common 16-byte header slots [8:14].
				sim := extractSIMHint(frame[16:])
				if sim == "" && len(frame) >= 14 {
					sim = bcdSIM(frame[8:14])
				}
				if sim != "" {
					meta["sim"] = sim
					if device == nil && st != nil {
						device = deviceauth.FindByIMEI(ctx, st, sim, conn.RemoteAddr().String(), "jt1078")
					}
				}
				imei := fmt.Sprintf("1078-ch%d", channel)
				deviceID := ""
				if device != nil {
					imei = device.IMEI
					deviceID = device.ID
					meta["device_id"] = device.ID
				}
				if sessions != nil {
					if bound == nil {
						bound = &protocol.ConnSession{
							DeviceID: deviceID,
							IMEI:     imei,
							Protocol: "jt1078",
							Conn:     conn,
							Meta:     meta,
						}
						sessions.Bind(bound)
					} else {
						if device != nil && bound.DeviceID == "" {
							bound.DeviceID = device.ID
							bound.IMEI = device.IMEI
						}
						if bound.Meta != nil {
							for k, v := range meta {
								bound.Meta[k] = v
							}
						}
					}
				}
				kind := avDataKind(dataType)
				meta["av_kind"] = kind
				payload := frame[16:]
				sig := parseSignalingPayload(dataType, payload)
				hdr := parseSignalingHeader(frame[:16])
				if device != nil && st != nil {
					patch := buildSignalingPatch(channel, dataType, channels[channel], hdr, sig, sim)
					_ = st.PatchLastStatus(ctx, device, patch, nil)
					_ = st.TouchSeen(ctx, device)
				}
				if channels[channel] <= 3 || channels[channel]%50 == 0 {
					log.Printf("[jt1078] channel=%d type=0x%02x len=%d frames=%d sim=%s device=%v (signaling hook)",
						channel, dataType, frameLen, channels[channel], meta["sim"], device != nil)
				}
				// Experimental signaling ACK: echo magic + channel + zero payload len.
				_ = writeSignalingAck(conn, channel, dataType)
				buf = buf[total:]
				continue
			}
			// resync
			buf = buf[1:]
		}
		if len(buf) > 64*1024 {
			return
		}
	}
}

func extractSIMHint(payload []byte) string {
	digits := make([]byte, 0, 16)
	for _, b := range payload {
		if b >= '0' && b <= '9' {
			digits = append(digits, b)
			if len(digits) >= 15 {
				break
			}
		} else if len(digits) > 0 {
			break
		}
	}
	if len(digits) >= 11 {
		return string(digits)
	}
	return ""
}

// avDataKind maps JT1078 data-type nibble/byte to a coarse label (experimental).
func avDataKind(dataType byte) string {
	switch dataType & 0x0f {
	case 0x00:
		return "video_i"
	case 0x01:
		return "video_p"
	case 0x02:
		return "video_b"
	case 0x03:
		return "audio"
	case 0x04:
		return "passthrough"
	default:
		return fmt.Sprintf("type_0x%02x", dataType)
	}
}

// bcdSIM decodes 6 BCD bytes (phone/SIM) used in many JT1078 RTP-style headers.
func bcdSIM(b []byte) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, len(b)*2)
	for _, v := range b {
		hi, lo := v>>4, v&0x0f
		if hi <= 9 {
			out = append(out, hex[hi])
		}
		if lo <= 9 {
			out = append(out, hex[lo])
		}
	}
	s := string(out)
	for len(s) > 1 && s[0] == '0' {
		s = s[1:]
	}
	if len(s) >= 11 {
		return s
	}
	return ""
}

// writeSignalingAck is a minimal experimental ACK so clients do not retry forever.
// Not a full JT1078 RTP control response — honest partial/experimental only.
func writeSignalingAck(conn net.Conn, channel, dataType byte) error {
	ack := []byte{
		0x30, 0x31, 0x63, 0x64,
		dataType | 0x80, // mark as response-ish
		channel,
		0x00, 0x00, // payload len 0
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	}
	_, err := conn.Write(ack)
	return err
}

type Adapter struct{}

func (Adapter) Name() string        { return "jt1078" }
func (Adapter) DisplayName() string { return "JT/T 1078 A/V signaling" }
func (Adapter) Status() string      { return protocol.StatusExperimental }
func (Adapter) DefaultAddr() string { return ":1078" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}
