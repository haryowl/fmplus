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
func (Adapter) DisplayName() string { return "Ruptela FM (CRC-CCITT Kermit)" }
func (Adapter) Status() string      { return protocol.StatusPartial } // records + IO + cmd 108/105/107
func (Adapter) DefaultAddr() string { return ":3047" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink builds command 108 (0x6C) SMS-via-GPRS by default.
// Command types ruptela_105 / ruptela_107 use cmd bytes 105 / 107.
func (Adapter) EncodeDownlink(cmd store.Command) ([]byte, error) {
	return EncodeCmd(cmd, cmdByteForType(cmd.CommandType))
}

func cmdByteForType(commandType string) byte {
	switch commandType {
	case "ruptela_105", "config":
		return 105
	case "ruptela_107":
		return 107
	default:
		return 108 // SMS via GPRS
	}
}

// DownlinkCorrID returns the Ruptela command byte as corr string.
func DownlinkCorrID(commandType string) string {
	return fmt.Sprintf("%d", cmdByteForType(commandType))
}

// EncodeCmd builds [len BE][cmd][ASCII payload][CRC16 Kermit over cmd+payload].
func EncodeCmd(cmd store.Command, cmdByte byte) ([]byte, error) {
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
	body := append([]byte{cmdByte}, []byte(text)...)
	plen := len(body)
	lenBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(lenBuf, uint16(plen))
	crc := crc16Kermit(body)
	out := make([]byte, 0, 2+plen+2)
	out = append(out, lenBuf...)
	out = append(out, body...)
	crcBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(crcBuf, crc)
	out = append(out, crcBuf...)
	return out, nil
}
