package jt808

import (
	"context"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
)

type Adapter struct{}

func (Adapter) Name() string        { return "jt808" }
func (Adapter) DisplayName() string { return "JT/T 808 (MVP→partial)" }
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":7611" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}
