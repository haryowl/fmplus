package jt809

import (
	"encoding/binary"
	"fmt"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type infoTypeAlarm struct {
	name  string
	level int
	key   string
}

// knownInfoTypes maps JT/T 809 vehicle alarm info_type WORD → remappable alarm.* (partial).
var knownInfoTypes = map[int]infoTypeAlarm{
	1:  {"sos", 2, "alarm.sos"},
	2:  {"overspeed", 1, "alarm.overspeed"},
	3:  {"fatigue", 2, "alarm.fatigue"},
	4:  {"danger", 2, "alarm.danger"},
	5:  {"gnss_fault", 1, "alarm.gnss_fault"},
	6:  {"antenna_cut", 2, "alarm.gnss_antenna_cut"},
	7:  {"undervoltage", 1, "alarm.low_power"},
	8:  {"power_cut", 2, "alarm.power_cut"},
	9:  {"lcd_fault", 1, "alarm.lcd_fault"},
	10: {"tts_fault", 1, "alarm.tts_fault"},
	11: {"camera_fault", 1, "alarm.camera_fault"},
	12: {"road_trans_timeout", 1, "alarm.road_trans_timeout"},
	13: {"overspeed_warn", 1, "alarm.overspeed_warn"},
	14: {"fatigue_warn", 1, "alarm.fatigue_warn"},
	18: {"day_drive_timeout", 1, "alarm.day_drive_timeout"},
	19: {"parking_timeout", 1, "alarm.parking_timeout"},
	20: {"area_inout", 1, "alarm.area_in_out"},
	21: {"route_inout", 1, "alarm.route_inout"},
	22: {"route_deviation", 1, "alarm.route_deviation"},
	23: {"vss_fault", 1, "alarm.vss_fault"},
	24: {"fuel_abnormal", 2, "alarm.fuel_abnormal"},
	25: {"theft", 2, "alarm.theft"},
	26: {"illegal_ignition", 2, "alarm.illegal_ignition"},
	27: {"illegal_move", 2, "alarm.illegal_move"},
	28: {"collision", 2, "alarm.collision"},
}

// flatten809InfoType writes remappable alarm.* onto dest for known info_type values.
func flatten809InfoType(infoType int, dest map[string]any) {
	if dest == nil || infoType == 0 {
		return
	}
	k, ok := knownInfoTypes[infoType]
	if !ok {
		return
	}
	dest[k.key] = true
	dest["alarm_level"] = k.level
}

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
	if k, hit := knownInfoTypes[infoType]; hit {
		alarmType, level = k.name, k.level
	}
	raw := map[string]any{
		"proto_msg":     fmt.Sprintf("0x%04x", msgID),
		"vehicle_plate": plate,
		"vehicle_color": color,
		"info_type":     infoType,
		"body_len":      len(rest),
		"alarm_level":   level,
	}
	flatten809InfoType(infoType, raw)
	ev = &store.SafetyEvent{
		RecordedAt:     time.Now().UTC(),
		AlarmType:      alarmType,
		AlarmLevel:     level,
		RawAttrs:       raw,
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
