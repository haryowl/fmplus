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
	if phone == "" {
		return nil, fmt.Errorf("jt808: phone required for downlink")
	}
	var seq uint16
	out := encodeJT808Downlink(phone, &seq, &cmd)
	if len(out) == 0 {
		return nil, fmt.Errorf("jt808: empty downlink")
	}
	return out, nil
}
