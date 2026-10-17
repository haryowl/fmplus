package galileosky

import (
	"context"
	"encoding/binary"
	"fmt"
	"strings"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type Adapter struct{}

func (Adapter) Name() string        { return "galileosky" }
func (Adapter) DisplayName() string { return "Galileosky Easy/Main (CRC-16 Modbus)" }
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":30175" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink wraps text/raw payload in a Galileosky 0x01 packet with CRC-16 Modbus.
// Text commands match the official command list (GETVER, MainPack, …) sent over the TCP session.
// SPA text without an explicit line ending gets "\r\n" appended (common Easy/Main expectation).
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	payload := cmd.PayloadBytes()
	if len(payload) == 0 && cmd.PayloadText != "" {
		payload = []byte(cmd.PayloadText)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("galileosky: empty command payload")
	}
	if cmd.PayloadHex == "" && looksLikeTextCommand(payload) && !hasLineEnding(payload) {
		payload = append(append([]byte{}, payload...), '\r', '\n')
	}
	if len(payload) > 1000 {
		return nil, fmt.Errorf("galileosky: command too long")
	}
	return buildFrame(payload), nil
}

func hasLineEnding(b []byte) bool {
	return strings.Contains(string(b), "\n") || strings.Contains(string(b), "\r")
}

func looksLikeTextCommand(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	printable := 0
	for _, c := range b {
		if c >= 0x20 && c < 0x7f {
			printable++
		}
	}
	return printable*100/len(b) >= 80
}

// buildFrame: [0x01][len LE = payload len][payload][crc16 Modbus over header+len+payload]
func buildFrame(payload []byte) []byte {
	out := make([]byte, 0, 3+len(payload)+2)
	out = append(out, 0x01)
	lenBuf := make([]byte, 2)
	binary.LittleEndian.PutUint16(lenBuf, uint16(len(payload)&0x7fff))
	out = append(out, lenBuf...)
	out = append(out, payload...)
	sum := crc16Modbus(out)
	crcBuf := make([]byte, 2)
	binary.LittleEndian.PutUint16(crcBuf, sum)
	out = append(out, crcBuf...)
	return out
}
