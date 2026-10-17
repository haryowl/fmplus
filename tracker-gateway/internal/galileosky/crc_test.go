package galileosky

import (
	"encoding/binary"
	"net"
	"testing"
	"time"
)

type memConn struct {
	in  []byte
	out []byte
	r   int
}

func (c *memConn) Read(b []byte) (int, error) {
	if c.r >= len(c.in) {
		return 0, net.ErrClosed
	}
	n := copy(b, c.in[c.r:])
	c.r += n
	return n, nil
}
func (c *memConn) Write(b []byte) (int, error) {
	c.out = append(c.out, b...)
	return len(b), nil
}
func (c *memConn) Close() error                     { return nil }
func (c *memConn) LocalAddr() net.Addr              { return nil }
func (c *memConn) RemoteAddr() net.Addr             { return &net.TCPAddr{} }
func (c *memConn) SetDeadline(time.Time) error      { return nil }
func (c *memConn) SetReadDeadline(time.Time) error  { return nil }
func (c *memConn) SetWriteDeadline(time.Time) error { return nil }

func TestWriteAck_OnBadCRC(t *testing.T) {
	// Build a valid 0x01 packet then flip CRC so Serve's CRC check fails.
	payload := []byte{0x03, '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5'}
	frame := buildFrame(payload)
	frame[len(frame)-1] ^= 0xff
	conn := &memConn{in: frame}
	// Only exercise writeAck helper path used on bad CRC.
	gotCRC := binary.LittleEndian.Uint16(frame[len(frame)-2:])
	if err := writeAck(conn, gotCRC); err != nil {
		t.Fatal(err)
	}
	if len(conn.out) != 3 || conn.out[0] != 0x02 {
		t.Fatalf("ack=%x", conn.out)
	}
	if binary.LittleEndian.Uint16(conn.out[1:3]) != gotCRC {
		t.Fatalf("ack crc=%x", conn.out)
	}
}
