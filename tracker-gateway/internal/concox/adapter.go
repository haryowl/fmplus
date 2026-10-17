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
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":5023" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink builds GT06 0x80 server command frame (ASCII SMS-style GPRS command).
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
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
	// info = cmd_len | ascii | language(2)
	info := make([]byte, 0, 1+len(body)+2)
	info = append(info, byte(len(body)))
	info = append(info, body...)
	info = append(info, 0x00, 0x01) // language English (common default)
	return buildFrame(0x80, 1, info), nil
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
