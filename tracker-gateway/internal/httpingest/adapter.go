package httpingest

import (
	"context"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
)

type Adapter struct{}

func (Adapter) Name() string        { return "json" }
func (Adapter) DisplayName() string { return "HTTP / JSON ingest" }
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":5080" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}
