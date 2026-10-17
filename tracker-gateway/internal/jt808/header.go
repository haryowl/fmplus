package jt808

import "encoding/binary"

// messageHeader is the JT/T 808 (2011) or 2019 message header after unescape (excl BCC).
type messageHeader struct {
	MsgID        uint16
	BodyProps    uint16
	BodyLen      int
	Phone        string
	Seq          uint16
	HeaderLen    int
	Version2019  bool
	Subpackaged  bool
	TotalPkgs    int
	PkgIndex     int // 1-based when Subpackaged
	ProtocolVer  byte
}

// parseMessageHeader parses 2011 (12-byte) or 2019 (17-byte) headers + optional subpackage.
func parseMessageHeader(msg []byte) (messageHeader, bool) {
	var h messageHeader
	if len(msg) < 12 {
		return h, false
	}
	h.MsgID = binary.BigEndian.Uint16(msg[0:2])
	h.BodyProps = binary.BigEndian.Uint16(msg[2:4])
	h.BodyLen = int(h.BodyProps & 0x3ff)
	h.Subpackaged = h.BodyProps&0x2000 != 0
	h.Version2019 = h.BodyProps&0x4000 != 0

	off := 4
	if h.Version2019 {
		if len(msg) < 5 {
			return h, false
		}
		h.ProtocolVer = msg[off]
		off++
		// 2019 terminal phone is 10 BCD bytes
		if len(msg) < off+10+2 {
			return h, false
		}
		h.Phone = bcdPhone(msg[off : off+10])
		off += 10
	} else {
		if len(msg) < 12 {
			return h, false
		}
		h.Phone = bcdPhone(msg[4:10])
		off = 10
	}
	if len(msg) < off+2 {
		return h, false
	}
	h.Seq = binary.BigEndian.Uint16(msg[off : off+2])
	off += 2
	if h.Subpackaged {
		if len(msg) < off+4 {
			return h, false
		}
		h.TotalPkgs = int(binary.BigEndian.Uint16(msg[off : off+2]))
		h.PkgIndex = int(binary.BigEndian.Uint16(msg[off+2 : off+4]))
		off += 4
	}
	h.HeaderLen = off
	return h, true
}

func (h messageHeader) Body(msg []byte) []byte {
	if h.HeaderLen > len(msg) {
		return nil
	}
	body := msg[h.HeaderLen:]
	n := h.BodyLen
	if n > len(body) {
		n = len(body)
	}
	if n < 0 {
		return nil
	}
	return body[:n]
}
