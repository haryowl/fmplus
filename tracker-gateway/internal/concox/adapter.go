package concox

import (
	"context"
	"encoding/binary"
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type Adapter struct{}

func (Adapter) Name() string        { return "concox" }
func (Adapter) DisplayName() string { return "Concox / GT06 family" }
func (Adapter) Status() string      { return protocol.StatusPartial } // GPS + HB ACC patch + 0x80 downlink
func (Adapter) DefaultAddr() string { return ":5023" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink builds GT06 0x80 server command frame (ASCII SMS-style GPRS command).
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	return Adapter{}.EncodeDownlinkSerial(cmd, 1)
}

// EncodeDownlinkSerial uses an explicit serial for session-scoped command correlation.
func (Adapter) EncodeDownlinkSerial(cmd store.Command, serial uint16) ([]byte, error) {
	text := cmd.PayloadText
	if text == "" {
		text = string(cmd.PayloadBytes())
	}
	if text == "" {
		return nil, fmt.Errorf("concox: empty command payload")
	}
	body := []byte(text)
	if len(body) > 240 {
		return nil, fmt.Errorf("concox: command too long")
	}
	if serial == 0 {
		serial = 1
	}
	// info = cmd_len | ascii | language(2)
	info := make([]byte, 0, 1+len(body)+2)
	info = append(info, byte(len(body)))
	info = append(info, body...)
	info = append(info, 0x00, 0x01) // language English (common default)
	return buildFrame(0x80, serial, info), nil
}

// DownlinkCorrID extracts the serial from a GT06 0x78 frame.
func DownlinkCorrID(framed []byte) string {
	if len(framed) < 10 || framed[0] != 0x78 || framed[1] != 0x78 {
		return ""
	}
	plen := int(framed[2])
	if 3+plen > len(framed) || plen < 5 {
		return ""
	}
	content := framed[3 : 3+plen]
	ser := binary.BigEndian.Uint16(content[len(content)-4 : len(content)-2])
	return fmt.Sprintf("%d", ser)
}

func buildFrame(proto byte, serial uint16, extra []byte) []byte {
	body := make([]byte, 0, 8+len(extra))
	body = append(body, proto)
	body = append(body, extra...)
	ser := make([]byte, 2)
	binary.BigEndian.PutUint16(ser, serial)
	body = append(body, ser...)
	crcIn := append([]byte{byte(1 + len(extra) + 2 + 2)}, body...)
	sum := crc16ITU(crcIn)
	out := []byte{0x78, 0x78, byte(len(body) + 2)}
	out = append(out, body...)
	crcBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(crcBuf, sum)
	out = append(out, crcBuf...)
	out = append(out, 0x0d, 0x0a)
	return out
}
