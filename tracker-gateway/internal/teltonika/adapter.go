package teltonika

import (
	"context"
	"encoding/binary"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type Adapter struct{}

func (Adapter) Name() string        { return "teltonika" }
func (Adapter) DisplayName() string { return "Teltonika Codec 8 / 8E" }
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":5027" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink wraps Codec 12 GPRS command in a TCP AVL packet (preamble + len + crc).
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	text := cmd.PayloadText
	if text == "" {
		text = string(cmd.PayloadBytes())
	}
	body := []byte(text)
	// Codec 12 payload: 0x0C | qty=1 | type=5 | size u32 BE | body | qty=1
	avl := make([]byte, 0, 8+len(body))
	avl = append(avl, 0x0c, 0x01, 0x05)
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(len(body)))
	avl = append(avl, sz...)
	avl = append(avl, body...)
	avl = append(avl, 0x01)

	out := make([]byte, 0, 12+len(avl))
	out = append(out, 0, 0, 0, 0) // preamble
	lenBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lenBuf, uint32(len(avl)))
	out = append(out, lenBuf...)
	out = append(out, avl...)
	crc := crc16IBM(avl)
	crcBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(crcBuf, uint32(crc))
	out = append(out, crcBuf...)
	return out, nil
}
