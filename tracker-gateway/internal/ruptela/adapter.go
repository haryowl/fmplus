package ruptela

import (
	"context"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
)

type Adapter struct{}

func (Adapter) Name() string        { return "ruptela" }
func (Adapter) DisplayName() string { return "Ruptela FM" }
func (Adapter) Status() string      { return protocol.StatusMVP }
func (Adapter) DefaultAddr() string { return ":3047" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store)
}
