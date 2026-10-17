package dispatch

import (
	"net"
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestIsJT808Command(t *testing.T) {
	if !isJT808Command("jt808", "text") {
		t.Fatal("protocol jt808")
	}
	if !isJT808Command("", "query_params") {
		t.Fatal("alias query_params")
	}
	if !isJT808Command("subiao", "jt808_8105") {
		t.Fatal("subiao 8105")
	}
	if isJT808Command("teltonika", "teltonika_codec12") {
		t.Fatal("teltonika should not match")
	}
}

func TestSessionReady(t *testing.T) {
	cmd := store.Command{Protocol: "jt808", CommandType: "text"}
	if sessionReady(cmd, nil) {
		t.Fatal("nil sess")
	}
	sess := &protocol.ConnSession{Conn: discardConn{}}
	if sessionReady(cmd, sess) {
		t.Fatal("jt808 needs phone")
	}
	sess.Meta = map[string]string{"phone": "13800138000"}
	if !sessionReady(cmd, sess) {
		t.Fatal("ready")
	}
	tel := store.Command{Protocol: "teltonika", CommandType: "teltonika_codec12"}
	if !sessionReady(tel, &protocol.ConnSession{Conn: discardConn{}}) {
		t.Fatal("teltonika ready without meta")
	}
}

type discardConn struct{}

func (discardConn) Read([]byte) (int, error)         { return 0, nil }
func (discardConn) Write(b []byte) (int, error)      { return len(b), nil }
func (discardConn) Close() error                     { return nil }
func (discardConn) LocalAddr() net.Addr              { return nil }
func (discardConn) RemoteAddr() net.Addr             { return nil }
func (discardConn) SetDeadline(time.Time) error      { return nil }
func (discardConn) SetReadDeadline(time.Time) error  { return nil }
func (discardConn) SetWriteDeadline(time.Time) error { return nil }

func TestDownlinkCorr_protocols(t *testing.T) {
	// Minimal JT808 escaped frame: 0x7e ... seq ... 0x7e — use empty when not framed.
	if downlinkCorr("teltonika", "teltonika_codec12", nil, nil) != "" {
		t.Fatal("teltonika corr must be empty")
	}
	if downlinkCorr("galileosky", "galileosky_text", nil, nil) != "" {
		t.Fatal("galileosky corr must be empty")
	}
	if downlinkCorr("ruptela", "ruptela_sms", nil, nil) != "108" {
		t.Fatal("ruptela sms")
	}
	if downlinkCorr("ruptela", "ruptela_105", nil, nil) != "105" {
		t.Fatal("ruptela 105")
	}
	sess := &protocol.ConnSession{Meta: map[string]string{"seq": "9"}}
	if downlinkCorr("other", "raw", nil, sess) != "9" {
		t.Fatal("meta seq fallback")
	}
}
