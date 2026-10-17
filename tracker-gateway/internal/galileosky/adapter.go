package galileosky

import (
	"context"
	"encoding/binary"
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type Adapter struct{}

func (Adapter) Name() string        { return "galileosky" }
func (Adapter) DisplayName() string { return "Galileosky Easy/Main (+compressed experimental)" }
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":30175" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink wraps text/raw payload in a Galileosky 0x01 framed packet (checksum XOR).
// Not a certified command tag set — devices that accept ASCII over the same TCP link can consume it.
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	payload := cmd.PayloadBytes()
	if len(payload) == 0 && cmd.PayloadText != "" {
		payload = []byte(cmd.PayloadText)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("galileosky: empty command payload")
	}
	if len(payload) > 1024 {
		return nil, fmt.Errorf("galileosky: command too long")
	}
	return buildFrame(payload), nil
}

func buildFrame(payload []byte) []byte {
	// length = payload + 1 checksum byte
	n := len(payload) + 1
	out := make([]byte, 0, 3+n)
	out = append(out, 0x01)
	lenBuf := make([]byte, 2)
	binary.LittleEndian.PutUint16(lenBuf, uint16(n))
	out = append(out, lenBuf...)
	out = append(out, payload...)
	var xor byte
	for _, b := range payload {
		xor ^= b
	}
	out = append(out, xor)
	return out
}
