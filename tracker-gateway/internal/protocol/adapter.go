// Package protocol defines the pluggable GPS protocol adapter contract.
// New vendors (TCP/UDP/HTTP) implement Adapter and register via Registry.
package protocol

import (
	"context"
	"net"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Completeness labels — never claim "full" until checklist is green.
const (
	StatusMVP          = "mvp"
	StatusPartial      = "partial"
	StatusCertified    = "certified"
	StatusExperimental = "experimental"
)

// Adapter is a pluggable protocol pack (Teltonika, JT808, HTTP, …).
type Adapter interface {
	Name() string
	DisplayName() string
	Status() string
	DefaultAddr() string
	Serve(ctx context.Context, addr string, deps Deps) error
}

// Deps shared by all adapters.
type Deps struct {
	Store    *store.Store
	Sessions *Registry
}

// DownlinkEncoder optional — adapters that support 2-way implement this.
type DownlinkEncoder interface {
	EncodeDownlink(cmd store.Command) ([]byte, error)
}

// ConnSession binds a live TCP connection for 2-way.
type ConnSession struct {
	DeviceID string
	IMEI     string
	Protocol string
	Conn     net.Conn
	Meta     map[string]string
}
