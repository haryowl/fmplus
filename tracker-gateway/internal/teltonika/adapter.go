package teltonika

import (
	"context"
	"encoding/binary"
	"fmt"
	"strconv"
	"strings"
	"time"

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

// EncodeDownlink wraps Codec 12 GPRS by default; teltonika_codec14 embeds IMEI (8-byte hex).
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	return EncodeGPRS(cmd, "")
}

// EncodeGPRS builds Codec12 or Codec14. For Codec14, imei must be 15 digits (session IMEI).
func EncodeGPRS(cmd store.Command, imei string) ([]byte, error) {
	text := cmd.PayloadText
	if text == "" {
		text = string(cmd.PayloadBytes())
	}
	switch cmd.CommandType {
	case "teltonika_codec14":
		return encodeCodec14(text, imei)
	case "teltonika_codec13":
		return encodeCodec13(text)
	}
	return encodeCodec12(text)
}

func encodeCodec12(text string) ([]byte, error) {
	body := []byte(text)
	// Codec 12 payload: 0x0C | qty=1 | type=5 | size u32 BE | body | qty=1
	avl := make([]byte, 0, 8+len(body))
	avl = append(avl, 0x0c, 0x01, 0x05)
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(len(body)))
	avl = append(avl, sz...)
	avl = append(avl, body...)
	avl = append(avl, 0x01)
	return wrapAVLPacket(avl), nil
}

// encodeCodec13 builds Codec 13 GPRS command (unix timestamp before ASCII body).
func encodeCodec13(text string) ([]byte, error) {
	body := []byte(text)
	ts := make([]byte, 4)
	binary.BigEndian.PutUint32(ts, uint32(time.Now().UTC().Unix()))
	avl := make([]byte, 0, 8+4+len(body))
	avl = append(avl, 0x0d, 0x01, 0x05)
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(4+len(body)))
	avl = append(avl, sz...)
	avl = append(avl, ts...)
	avl = append(avl, body...)
	avl = append(avl, 0x01)
	return wrapAVLPacket(avl), nil
}

func encodeCodec14(text, imei string) ([]byte, error) {
	imeiBytes, err := imeiToCodec14(imei)
	if err != nil {
		return nil, err
	}
	body := []byte(text)
	// size = 8 (IMEI) + command length
	avl := make([]byte, 0, 8+8+len(body))
	avl = append(avl, 0x0e, 0x01, 0x05)
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(8+len(body)))
	avl = append(avl, sz...)
	avl = append(avl, imeiBytes...)
	avl = append(avl, body...)
	avl = append(avl, 0x01)
	return wrapAVLPacket(avl), nil
}

func wrapAVLPacket(avl []byte) []byte {
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
	return out
}

// imeiToCodec14 packs a 15-digit IMEI into 8 bytes (leading 0 nibble) per Teltonika wiki.
func imeiToCodec14(imei string) ([]byte, error) {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, imei)
	if len(digits) < 14 || len(digits) > 15 {
		return nil, fmt.Errorf("teltonika codec14: IMEI required (14–15 digits), got %q", imei)
	}
	if len(digits) == 14 {
		digits = "0" + digits
	}
	// 15 digits → 8 bytes: high nibble of first byte is 0, then packed BCD-ish as hex digits.
	// Wiki example IMEI 352093081452251 → 03 52 09 30 81 45 22 51
	padded := "0" + digits // 16 hex digits
	out := make([]byte, 8)
	for i := 0; i < 8; i++ {
		v, err := strconv.ParseUint(padded[i*2:i*2+2], 16, 8)
		if err != nil {
			return nil, fmt.Errorf("teltonika codec14: bad IMEI digit")
		}
		out[i] = byte(v)
	}
	return out, nil
}
