package jt1078

import (
	"encoding/binary"
	"fmt"
)

// buildSignalingPatch merges header/payload hints into a Device Manager status patch.
// Prefer ASCII payload SIM for merged av_sim; keep BCD/ASCII provenance separately.
func buildSignalingPatch(channel byte, dataType byte, frames int, hdr, sig map[string]any, simBCD, simASCII string) map[string]any {
	patch := map[string]any{}
	for k, v := range hdr {
		patch[k] = v
	}
	for k, v := range sig {
		patch[k] = v
	}
	patch["proto_msg"] = "jt1078_signaling"
	patch["av_channel"] = int(channel)
	patch["av_datatype"] = int(dataType)
	patch["av_kind"] = avDataKind(dataType & 0x0f)
	patch["av_frames"] = frames
	if simBCD != "" {
		patch["av_sim_bcd"] = simBCD
	}
	if simASCII != "" {
		patch["av_sim_ascii"] = simASCII
	}
	sim := simASCII
	if sim == "" {
		sim = simBCD
	}
	if sim != "" {
		patch["av_sim"] = sim
	}
	return patch
}

// parseSignalingHeader lifts common 16-byte JT1078-style header fields (experimental).
// Layout after magic: datatype(1) channel(1) length(2) then often BCD SIM(6) + seq/ts variants.
func parseSignalingHeader(hdr []byte) map[string]any {
	out := map[string]any{}
	if len(hdr) < 16 {
		return out
	}
	out["av_datatype"] = int(hdr[4])
	out["av_channel"] = int(hdr[5])
	out["av_payload_declared"] = int(binary.BigEndian.Uint16(hdr[6:8]))
	// Bytes 14–15 frequently carry a packet/sequence counter on vendor stacks.
	out["av_seq"] = int(binary.BigEndian.Uint16(hdr[14:16]))
	// Soft correlation hint for Admin/Device Manager after a 0x9101 live request.
	kind := hdr[4] & 0x0f
	if kind <= 0x03 {
		out["av_live"] = true
	}
	out["av_data_kind"] = avDataKind(kind)
	out["av_pack_mark"] = avPackMark(hdr[4] >> 4)
	return out
}

func avPackMark(nibble byte) string {
	switch nibble & 0x0f {
	case 0:
		return "atomic"
	case 1:
		return "first"
	case 2:
		return "last"
	case 3:
		return "middle"
	default:
		return fmt.Sprintf("mark_%d", nibble&0x0f)
	}
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
		if len(payload) >= 3 {
			out["av_ptz_speed"] = int(payload[2])
		}
		if len(payload) >= 4 {
			out["av_ptz_param"] = int(payload[3])
		}
	case 0x00, 0x01, 0x02: // video frames — SSRC sometimes first 4 bytes
		if len(payload) >= 4 {
			ssrc := uint32(payload[0])<<24 | uint32(payload[1])<<16 | uint32(payload[2])<<8 | uint32(payload[3])
			if ssrc != 0 {
				out["av_ssrc"] = ssrc
			}
		}
		// Some stacks put an 8-byte RTP/absolute timestamp after SSRC.
		if len(payload) >= 12 {
			ts := binary.BigEndian.Uint64(payload[4:12])
			if ts != 0 {
				out["av_timestamp"] = ts
			}
		}
	case 0x03: // audio
		if len(payload) >= 1 {
			out["av_audio_type"] = int(payload[0])
		}
		if len(payload) >= 9 {
			ts := binary.BigEndian.Uint64(payload[1:9])
			if ts != 0 {
				out["av_timestamp"] = ts
			}
		}
	}
	return out
}
