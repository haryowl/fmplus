package jt1078

import (
	"encoding/binary"
	"fmt"
)

// parseSignalingHeader lifts common 16-byte JT1078-style header fields (experimental).
// Layout after magic: datatype(1) channel(1) length(2) then often BCD SIM(6) + seq/ts variants.
func parseSignalingHeader(hdr []byte) map[string]any {
	out := map[string]any{}
	if len(hdr) < 16 {
		return out
	}
	out["av_payload_declared"] = int(binary.BigEndian.Uint16(hdr[6:8]))
	// Bytes 14–15 frequently carry a packet/sequence counter on vendor stacks.
	out["av_seq"] = int(binary.BigEndian.Uint16(hdr[14:16]))
	return out
}

// parseSignalingPayload extracts experimental status hints from the post-header payload.
// JT/T 1078 layouts vary by vendor; this is best-effort (no RTP decode).
func parseSignalingPayload(dataType byte, payload []byte) map[string]any {
	out := map[string]any{
		"av_payload_len": len(payload),
	}
	if len(payload) == 0 {
		return out
	}
	snip := payload
	if len(snip) > 32 {
		snip = snip[:32]
	}
	out["av_payload_hex"] = fmt.Sprintf("%x", snip)

	kind := dataType & 0x0f
	switch kind {
	case 0x04: // passthrough / control — often PTZ or stream control
		if len(payload) >= 1 {
			out["av_ptz_cmd"] = int(payload[0])
		}
		if len(payload) >= 2 {
			out["av_stream"] = int(payload[1])
		}
	case 0x00, 0x01, 0x02: // video frames — SSRC sometimes first 4 bytes
		if len(payload) >= 4 {
			ssrc := uint32(payload[0])<<24 | uint32(payload[1])<<16 | uint32(payload[2])<<8 | uint32(payload[3])
			if ssrc != 0 {
				out["av_ssrc"] = ssrc
			}
		}
	case 0x03: // audio
		if len(payload) >= 1 {
			out["av_audio_type"] = int(payload[0])
		}
	}
	return out
}
