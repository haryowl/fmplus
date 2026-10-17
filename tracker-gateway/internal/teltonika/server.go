package teltonika

import (
	"context"
	"encoding/binary"
	"io"
	"log"
	"net"
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
			log.Printf("[teltonika] bad CRC for %s — still attempting parse", imei)
		}
		count, fixes := parseAVL(payload)
		for _, fix := range fixes {
			fix.SourceProtocol = "teltonika"
			if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
				log.Printf("[teltonika] ingest %s: %v", imei, err)
			}
		}
		ack := make([]byte, 4)
		binary.BigEndian.PutUint32(ack, uint32(count))
		if _, err := conn.Write(ack); err != nil {
			return
		}
	}
}
