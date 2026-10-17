package galileosky

import (
	"context"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
)

type Adapter struct{}

func (Adapter) Name() string        { return "galileosky" }
func (Adapter) DisplayName() string { return "Galileosky Easy/Main (+compressed experimental)" }
func (Adapter) Status() string      { return protocol.StatusPartial }
func (Adapter) DefaultAddr() string { return ":30175" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return Serve(ctx, addr, deps.Store, deps.Sessions)
}
