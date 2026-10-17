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
