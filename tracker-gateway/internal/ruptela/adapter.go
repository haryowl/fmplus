package ruptela

import (
	"context"
	"encoding/binary"
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type Adapter struct{}

func (Adapter) Name() string        { return "ruptela" }
func (Adapter) DisplayName() string { return "Ruptela FM" }
func (Adapter) Status() string      { return protocol.StatusPartial } // records + IO + cmd 108
func (Adapter) DefaultAddr() string { return ":3047" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink builds command 108 (0x6C) SMS-via-GPRS packet (ASCII payload).
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	text := cmd.PayloadText
	if text == "" {
		text = string(cmd.PayloadBytes())
	}
	if text == "" {
		return nil, fmt.Errorf("ruptela: empty command payload")
	}
	if len(text) > 160 {
		return nil, fmt.Errorf("ruptela: command too long (max 160)")
	}
	payload := []byte(text)
	body := append([]byte{0x6c}, payload...)
	plen := len(body)
	lenBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(lenBuf, uint16(plen))
	crc := crc16IBM(append(append([]byte{}, lenBuf...), body...))
	out := make([]byte, 0, 2+plen+2)
	out = append(out, lenBuf...)
	out = append(out, body...)
	crcBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(crcBuf, crc)
	out = append(out, crcBuf...)
	return out, nil
}
