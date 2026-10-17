package jt808

import (
	"context"
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type Adapter struct{}

func (Adapter) Name() string        { return "jt808" }
func (Adapter) DisplayName() string { return "JT/T 808 (MVP→partial)" }
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":7611" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}

// EncodeDownlink builds a JT808 frame using session phone from Meta (dispatch path).
func (Adapter) EncodeDownlink(cmd store.Command, phone string) ([]byte, error) {
	var seq uint16
	return Adapter{}.EncodeDownlinkSeq(cmd, phone, &seq, false)
}

// EncodeDownlinkSeq uses the session sequence counter and optional 2019 header.
func (Adapter) EncodeDownlinkSeq(cmd store.Command, phone string, seq *uint16, v2019 bool) ([]byte, error) {
	if phone == "" {
		return nil, fmt.Errorf("jt808: phone required for downlink")
	}
	if seq == nil {
		var n uint16
		seq = &n
	}
	out := encodeJT808DownlinkVer(phone, seq, &cmd, v2019)
	if len(out) == 0 {
		return nil, fmt.Errorf("jt808: empty downlink")
	}
	return out, nil
}

// DownlinkCorrID extracts the message serial from the first encoded JT808 frame
// (important when outbound subpackages concatenate multiple 0x7e frames).
func DownlinkCorrID(framed []byte) string {
	start := -1
	for i, b := range framed {
		if b != 0x7e {
			continue
		}
		if start < 0 {
			start = i
			continue
		}
		raw := unescape(framed[start : i+1])
		if len(raw) < 13 {
			return ""
		}
		h, ok := parseMessageHeader(raw[:len(raw)-1])
		if !ok {
			return ""
		}
		return fmt.Sprintf("%d", h.Seq)
	}
	return ""
}
