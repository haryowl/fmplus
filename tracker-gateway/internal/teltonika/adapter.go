package teltonika

import (
	"context"

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

// EncodeDownlink Codec 12 GPRS command (text).
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	text := cmd.PayloadText
	if text == "" {
		text = string(cmd.PayloadBytes())
	}
	body := []byte(text)
	// Codec 12: 0x0C | qty=1 | type=5 (command) | size u32 | body | qty=1
	out := make([]byte, 0, 8+len(body))
	out = append(out, 0x0c, 0x01, 0x05)
	sz := make([]byte, 4)
	// big-endian size
	sz[0] = byte(len(body) >> 24)
	sz[1] = byte(len(body) >> 16)
	sz[2] = byte(len(body) >> 8)
	sz[3] = byte(len(body))
	out = append(out, sz...)
	out = append(out, body...)
	out = append(out, 0x01)
	return out, nil
}
