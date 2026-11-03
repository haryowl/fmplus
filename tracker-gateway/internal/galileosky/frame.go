package galileosky

import (
	"encoding/binary"
)

const (
	// Wire LENGTH is 15 bits. Match LinuxOHW (32767) and resync when exceeded.
	maxFrameDataLen = 0x7fff
)

// frameResult is one complete Galileosky TCP frame (HEAD+LEN+DATA+CRC).
type frameResult struct {
	Hdr     byte
	Archive bool
	Tags    []byte // DATA only (no CRC)
	CRC     uint16 // little-endian value of the two CRC bytes on the wire
	CRCRaw  [2]byte
	Raw     []byte // full frame including CRC
}

// extractFrames pulls complete packets from a TCP stream buffer (LinuxOHW extractPackets).
// Incomplete trailing bytes are returned as rest. Absurd LENGTH values discard bytes
// until the next plausible HEAD (0x01/0x07/0x08) so the session can recover.
func extractFrames(buf []byte) (frames []frameResult, rest []byte) {
	for len(buf) >= 3 {
		hdr := buf[0]
		rawLen := binary.LittleEndian.Uint16(buf[1:3])
		dataLen := int(rawLen & 0x7fff)
		archive := rawLen&0x8000 != 0
		need := 3 + dataLen + 2 // HEAD + LEN + DATA + CRC

		if dataLen > maxFrameDataLen {
			next := findNextFrameStart(buf, 1)
			if next < 0 {
				return frames, nil
			}
			buf = buf[next:]
			continue
		}
		if len(buf) < need {
			return frames, buf
		}

		raw := append([]byte(nil), buf[:need]...)
		var crcRaw [2]byte
		crcRaw[0] = raw[need-2]
		crcRaw[1] = raw[need-1]
		frames = append(frames, frameResult{
			Hdr:     hdr,
			Archive: archive,
			Tags:    append([]byte(nil), raw[3:3+dataLen]...),
			CRC:     binary.LittleEndian.Uint16(crcRaw[:]),
			CRCRaw:  crcRaw,
			Raw:     raw,
		})
		buf = buf[need:]
	}
	return frames, buf
}

func findNextFrameStart(buf []byte, from int) int {
	for i := from; i < len(buf); i++ {
		switch buf[i] {
		case 0x01, 0x07, 0x08:
			// ok
		default:
			continue
		}
		if i+3 > len(buf) {
			return i
		}
		n := int(binary.LittleEndian.Uint16(buf[i+1:i+3]) & 0x7fff)
		if n <= maxFrameDataLen {
			return i
		}
	}
	return -1
}
