package jt809

import (
	"encoding/binary"
	"fmt"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// parseVehicleAlarm extracts plate + best-effort alarm type from 0x1400-family bodies.
// Layouts vary by interconnect; plate(21)+color(1) prefix is the common form.
func parseVehicleAlarm(msgID uint16, rest []byte) (plate string, ev *store.SafetyEvent, ok bool) {
	if len(rest) < 22 {
		return "", nil, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	color := int(rest[21])
	infoType := 0
	if len(rest) >= 24 {
		infoType = int(binary.BigEndian.Uint16(rest[22:24]))
	}
	alarmType := "vehicle_alarm"
	level := 1
	switch infoType {
	case 1:
		alarmType, level = "sos", 2
	case 2:
		alarmType, level = "overspeed", 1
	case 3:
		alarmType, level = "fatigue", 2
	case 4:
		alarmType, level = "danger", 2
	case 5:
		alarmType, level = "gnss_fault", 1
	}
	ev = &store.SafetyEvent{
		RecordedAt: time.Now().UTC(),
		AlarmType:  alarmType,
		AlarmLevel: level,
		RawAttrs: map[string]any{
			"proto_msg":     fmt.Sprintf("0x%04x", msgID),
			"vehicle_plate": plate,
			"vehicle_color": color,
			"info_type":     infoType,
			"body_len":      len(rest),
		},
		SourceProtocol: "jt809",
	}
	return plate, ev, plate != "" || infoType != 0
}

// parseVehicleStatic extracts plate + registration fields from 0x1201 bodies (experimental).
// Common prefix: plate(21)+color(1)+data_type(2)+data_len(4)+platform/producer/model/id/sim.
func parseVehicleStatic(rest []byte) (plate string, patch map[string]any, ok bool) {
	patch = map[string]any{"proto_msg": "0x1201", "body_len": len(rest)}
	if len(rest) < 21 {
		return "", patch, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	patch["vehicle_plate"] = plate
	if len(rest) >= 22 {
		patch["vehicle_color"] = int(rest[21])
	}
	if len(rest) >= 24 {
		patch["data_type"] = int(binary.BigEndian.Uint16(rest[22:24]))
	}
	if len(rest) >= 28 {
		patch["data_len"] = int(binary.BigEndian.Uint32(rest[24:28]))
	}
	data := []byte(nil)
	if len(rest) > 28 {
		data = rest[28:]
	}
	trimZ := func(b []byte) string {
		return strings.TrimRight(string(b), "\x00 ")
	}
	if len(data) >= 11 {
		if s := trimZ(data[0:11]); s != "" {
			patch["platform_id"] = s
		}
	}
	if len(data) >= 22 {
		if s := trimZ(data[11:22]); s != "" {
			patch["producer_id"] = s
		}
	}
	if len(data) >= 42 {
		if s := trimZ(data[22:42]); s != "" {
			patch["terminal_model"] = s
		}
	}
	if len(data) >= 49 {
		if s := trimZ(data[42:49]); s != "" {
			patch["terminal_id"] = s
		}
	}
	if len(data) >= 61 {
		if s := trimZ(data[49:61]); s != "" {
			patch["terminal_sim"] = s
		}
	}
	return plate, patch, plate != "" || len(data) > 0
}

// parseVehicleUplink extracts an experimental Fix from JT809 0x1200 / 0x1202 bodies.
// Layouts vary by interconnect; this covers the common plate(21)+color(1)+data_type(2)+GNSS form.
func parseVehicleUplink(msgID uint16, rest []byte) (store.Fix, string, bool) {
	out := store.Fix{
		RecordedAt:     time.Now().UTC(),
		SourceProtocol: "jt809",
		RawAttrs: map[string]any{
			"proto_msg": fmt.Sprintf("0x%04x", msgID),
			"body_len":  len(rest),
		},
	}
	if len(rest) < 28 {
		return out, "", false
	}
	plate := strings.TrimRight(string(rest[0:21]), "\x00 ")
	color := int(rest[21])
	dataType := binary.BigEndian.Uint16(rest[22:24])
	out.RawAttrs["vehicle_plate"] = plate
	out.RawAttrs["vehicle_color"] = color
	out.RawAttrs["data_type"] = int(dataType)
	gnss := rest[24:]
	// REAL_LOCATION-style GNSS blob: encrypt(1) + datetime(6/7) + lon(4) + lat(4) …
	off := 0
	if len(gnss) < 15 {
		return out, plate, plate != ""
	}
	out.RawAttrs["encrypt"] = int(gnss[0])
	off = 1
	// Prefer 6-byte BCD datetime; skip if not plausible.
	if off+6 <= len(gnss) {
		out.RawAttrs["gnss_time_bcd"] = fmt.Sprintf("%x", gnss[off:off+6])
		off += 6
	}
	if off+8 > len(gnss) {
		return out, plate, plate != ""
	}
	lonRaw := int32(binary.BigEndian.Uint32(gnss[off : off+4]))
	latRaw := int32(binary.BigEndian.Uint32(gnss[off+4 : off+8]))
	off += 8
	lon := float64(lonRaw) / 1e6
	lat := float64(latRaw) / 1e6
	if lon < -180 || lon > 180 || lat < -90 || lat > 90 {
		return out, plate, plate != ""
	}
	out.Lon, out.Lat = lon, lat
	if off+2 <= len(gnss) {
		spd := float64(binary.BigEndian.Uint16(gnss[off:off+2])) / 10.0
		out.Speed = &spd
		off += 2
	}
	if off+2 <= len(gnss) {
		hdg := float64(binary.BigEndian.Uint16(gnss[off : off+2]))
		out.Heading = &hdg
	}
	return out, plate, true
}
