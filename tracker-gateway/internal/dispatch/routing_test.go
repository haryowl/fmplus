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
	if !isJT808Command("", "phone_callback") || !isJT808Command("", "jt808_8401") {
		t.Fatal("phone downlink aliases")
	}
	if !isJT808Command("", "terminal_upgrade") || !isJT808Command("", "jt808_8108") {
		t.Fatal("upgrade downlink aliases")
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
	tel := store.Command{Protocol: "teltonika", CommandType: "teltonika_codec12", PayloadText: "getinfo"}
	if downlinkCorr(tel, nil, nil) != "txt:GETINFO" {
		t.Fatalf("teltonika soft corr=%q", downlinkCorr(tel, nil, nil))
	}
	if downlinkCorr(store.Command{Protocol: "teltonika", CommandType: "teltonika_codec12"}, nil, nil) != "" {
		t.Fatal("teltonika empty payload → empty corr")
	}
	gs := store.Command{Protocol: "galileosky", CommandType: "galileosky_text", PayloadText: "GETVER"}
	if downlinkCorr(gs, nil, nil) != "txt:GETVER" {
		t.Fatal("galileosky soft corr")
	}
	if downlinkCorr(store.Command{Protocol: "ruptela", CommandType: "ruptela_sms"}, nil, nil) != "108" {
		t.Fatal("ruptela sms")
	}
	if downlinkCorr(store.Command{Protocol: "ruptela", CommandType: "ruptela_105"}, nil, nil) != "105" {
		t.Fatal("ruptela 105")
	}
	sess := &protocol.ConnSession{Meta: map[string]string{"seq": "9"}}
	if downlinkCorr(store.Command{Protocol: "other", CommandType: "raw"}, nil, sess) != "9" {
		t.Fatal("meta seq fallback")
	}
}
