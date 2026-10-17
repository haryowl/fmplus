package subiao

import (
	"context"

	"github.com/haryowl/fmplus/tracker-gateway/internal/jt808"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
)

// Adapter is JT/T 808 framing with Su Biao active-safety labeling.
type Adapter struct{}

func (Adapter) Name() string        { return "subiao" }
func (Adapter) DisplayName() string { return "Su Biao / regional active safety (JT808 overlay)" }
func (Adapter) Status() string      { return protocol.StatusMVP }
func (Adapter) DefaultAddr() string { return ":7612" }

func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error {
	return jt808.ServeSuBiao(ctx, addr, deps.Store, deps.Sessions)
}
