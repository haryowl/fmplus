package teltonika

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

// Serve Teltonika Codec 8 / 8 Extended AVL over TCP.
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[teltonika] listening on %s (status=partial)", addr)
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
				log.Printf("[teltonika] accept: %v", err)
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
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))

	imeiLenBuf := make([]byte, 2)
	if _, err := io.ReadFull(conn, imeiLenBuf); err != nil {
		return
	}
	imeiLen := int(binary.BigEndian.Uint16(imeiLenBuf))
	if imeiLen < 5 || imeiLen > 32 {
		_, _ = conn.Write([]byte{0x00})
		return
	}
	imeiBuf := make([]byte, imeiLen)
	if _, err := io.ReadFull(conn, imeiBuf); err != nil {
		return
	}
	imei := string(imeiBuf)

	device := deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "teltonika")
	if device == nil {
		_, _ = conn.Write([]byte{0x00})
		return
	}
	if _, err := conn.Write([]byte{0x01}); err != nil {
		return
	}
	bound = &protocol.ConnSession{
		DeviceID: device.ID,
		IMEI:     device.IMEI,
		Protocol: "teltonika",
		Conn:     conn,
	}
	if sessions != nil {
		sessions.Bind(bound)
	}

	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		preamble := make([]byte, 4)
		if _, err := io.ReadFull(conn, preamble); err != nil {
			return
		}
		if binary.BigEndian.Uint32(preamble) != 0 {
			return
		}
		lenBuf := make([]byte, 4)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return
		}
		dataLen := int(binary.BigEndian.Uint32(lenBuf))
		if dataLen < 1 || dataLen > 128*1024 {
			return
		}
		payload := make([]byte, dataLen)
		if _, err := io.ReadFull(conn, payload); err != nil {
			return
		}
		crcBuf := make([]byte, 4)
		if _, err := io.ReadFull(conn, crcBuf); err != nil {
			return
		}

		if !verifyAVLCRC(payload, crcBuf) {
			metrics.DecodeErr()
			log.Printf("[teltonika] bad CRC for %s — zero-ack and drop", imei)
			// Official: always reply record count so device does not stall.
			ack := make([]byte, 4)
			if _, err := conn.Write(ack); err != nil {
				return
			}
			continue
		}
		// Codec 12/13 GPRS command response (not AVL records).
		if len(payload) > 0 && (payload[0] == 0x0c || payload[0] == 0x0d) {
			resp, ok := parseCodec12Response(payload)
			_ = st.AckSoftOrLatest(ctx, device.ID, ok, resp)
			ack := make([]byte, 4)
			if _, err := conn.Write(ack); err != nil {
				return
			}
			flushPending(ctx, conn, st, device.ID)
			continue
		}
		count, fixes := parseAVL(payload)
		for _, fix := range fixes {
			fix.SourceProtocol = "teltonika"
			if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
				log.Printf("[teltonika] ingest %s: %v", imei, err)
			}
			if ev := safetyFromEventIO(fix); ev != nil {
				_ = st.InsertSafetyEvent(ctx, device, *ev)
			}
		}
		ack := make([]byte, 4)
		binary.BigEndian.PutUint32(ack, uint32(count))
		if _, err := conn.Write(ack); err != nil {
			return
		}
		flushPending(ctx, conn, st, device.ID)
	}
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
			_ = st.MarkCommandFailed(ctx, cmd.ID, "teltonika encode failed")
			continue
		}
		if _, err := conn.Write(payload); err != nil {
			_ = st.RequeueCommand(ctx, cmd.ID)
			return
		}
		_ = st.MarkCommandSentCorr(ctx, cmd.ID, store.SoftTextCorr(cmd.PayloadText))
	}
}

// parseCodec12Response decodes Codec 12/13 type=0x06 response body.
// ok=false for empty body or ERROR/FAIL style replies (wiki GPRS command responses).
func parseCodec12Response(payload []byte) (string, bool) {
	// 0x0C|0x0D | qty | type=0x06 | size u32 BE | body | qty
	if len(payload) < 8 {
		return fmt.Sprintf("%x", payload), false
	}
	typ := payload[2]
	szOff := 3
	if typ != 0x06 && typ != 0x05 {
		// some firmwares omit qty and put type at [1]
		if payload[1] == 0x06 || payload[1] == 0x05 {
			szOff = 2
			typ = payload[1]
		}
	}
	if szOff+4 > len(payload) {
		return fmt.Sprintf("%x", payload), false
	}
	sz := int(binary.BigEndian.Uint32(payload[szOff : szOff+4]))
	start := szOff + 4
	if start+sz > len(payload) {
		sz = len(payload) - start
	}
	if sz < 0 {
		return fmt.Sprintf("%x", payload), false
	}
	body := string(payload[start : start+sz])
	ok := typ == 0x06 && sz > 0 && !codec12LooksFailed(body)
	return body, ok
}

func codec12LooksFailed(body string) bool {
	s := strings.TrimSpace(strings.ToUpper(body))
	if s == "" {
		return true
	}
	for _, p := range []string{"ERROR", "FAIL", "DENIED", "NOT AVAILABLE", "UNKNOWN"} {
		if strings.HasPrefix(s, p) || strings.Contains(s, " "+p) {
			return true
		}
	}
	return false
}
