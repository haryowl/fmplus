package concox

import (
	"context"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
)

type Adapter struct{}

func (Adapter) Name() string        { return "concox" }
func (Adapter) DisplayName() string { return "Concox / GT06 family" }
func (Adapter) Status() string      { return protocol.StatusMVP }
func (Adapter) DefaultAddr() string { return ":5023" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store)
}
