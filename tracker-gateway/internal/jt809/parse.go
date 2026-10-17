package jt809

import (
	"encoding/binary"
	"fmt"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/jt808"
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
	recorded := time.Now().UTC()
	// Common interconnect tail: warn_time BCD[6] + info_id DWORD + info_len DWORD + content.
	if len(rest) >= 30 {
		raw["warn_time_bcd"] = fmt.Sprintf("%x", rest[24:30])
		if ts, ok := parseWarnBcdTime(rest[24:30]); ok {
			recorded = ts
			raw["warn_time"] = ts.Format(time.RFC3339)
		}
	}
	if len(rest) >= 34 {
		infoID := binary.BigEndian.Uint32(rest[30:34])
		raw["info_id"] = int(infoID)
	}
	contentOff := 38
	if len(rest) >= 38 {
		infoLen := int(binary.BigEndian.Uint32(rest[34:38]))
		raw["info_len"] = infoLen
		end := 38 + infoLen
		if end > len(rest) {
			end = len(rest)
		}
		if end > 38 {
			snippet := rest[38:end]
			if len(snippet) > 64 {
				snippet = snippet[:64]
			}
			raw["info_content_hex"] = fmt.Sprintf("%x", snippet)
			if s := strings.TrimRight(string(rest[38:end]), "\x00 "); s != "" && isMostlyPrintable(s) {
				raw["info_content"] = s
			}
			contentOff = end
		}
	}
	var latPtr, lonPtr *float64
	if lat, lon, hit := tryWarnGNSS(rest, contentOff); hit {
		latPtr, lonPtr = &lat, &lon
		raw["lat"] = lat
		raw["lon"] = lon
	}
	ev = &store.SafetyEvent{
		RecordedAt:     recorded,
		AlarmType:      alarmType,
		AlarmLevel:     level,
		Lat:            latPtr,
		Lon:            lonPtr,
		RawAttrs:       raw,
		SourceProtocol: "jt809",
	}
	if id, ok := raw["info_id"].(int); ok && id != 0 {
		ev.AttachmentID = fmt.Sprintf("%d", id)
	}
	return plate, ev, plate != "" || infoType != 0
}

func parseWarnBcdTime(b []byte) (time.Time, bool) {
	if len(b) < 6 {
		return time.Time{}, false
	}
	decode := func(v byte) int { return int(v>>4)*10 + int(v&0x0f) }
	year := 2000 + decode(b[0])
	month := decode(b[1])
	day := decode(b[2])
	hour := decode(b[3])
	min := decode(b[4])
	sec := decode(b[5])
	if month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59 {
		return time.Time{}, false
	}
	return time.Date(year, time.Month(month), day, hour, min, sec, 0, time.UTC), true
}

func isMostlyPrintable(s string) bool {
	if s == "" {
		return false
	}
	ok := 0
	for _, r := range s {
		if r >= 32 && r < 127 {
			ok++
		}
	}
	return ok*2 >= len(s)
}

// tryWarnGNSS reads optional lon/lat int32×1e-6 after the warn content region.
func tryWarnGNSS(rest []byte, off int) (lat, lon float64, ok bool) {
	if off+8 > len(rest) {
		return 0, 0, false
	}
	lonRaw := int32(binary.BigEndian.Uint32(rest[off : off+4]))
	latRaw := int32(binary.BigEndian.Uint32(rest[off+4 : off+8]))
	lon = float64(lonRaw) / 1e6
	lat = float64(latRaw) / 1e6
	if lon < -180 || lon > 180 || lat < -90 || lat > 90 {
		return 0, 0, false
	}
	if lon == 0 && lat == 0 {
		return 0, 0, false
	}
	return lat, lon, true
}

// parsePhotoNotify1209 extracts plate/color/lens/size/file from 0x1209 photo notify.
func parsePhotoNotify1209(rest []byte) (plate string, patch map[string]any, ok bool) {
	patch = map[string]any{
		"proto_msg":    "0x1209",
		"body_len":     len(rest),
		"photo_notify": true,
	}
	if len(rest) < 21 {
		return "", patch, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	patch["vehicle_plate"] = plate
	if len(rest) >= 22 {
		patch["vehicle_color"] = int(rest[21])
	}
	if len(rest) >= 23 {
		patch["photo_lens"] = int(rest[22])
	}
	if len(rest) >= 27 {
		patch["photo_size"] = int(binary.BigEndian.Uint32(rest[23:27]))
	}
	if len(rest) > 27 {
		name := strings.TrimRight(string(rest[27:]), "\x00 ")
		if len(name) > 128 {
			name = name[:128]
		}
		if name != "" && isMostlyPrintable(name) {
			patch["photo_file"] = name
		}
	}
	return plate, patch, plate != ""
}

// parseVehicleOnline extracts plate/color/online flag from 0x1205/0x1206.
func parseVehicleOnline(msgID uint16, rest []byte) (plate string, patch map[string]any, ok bool) {
	online := msgID == 0x1205
	patch = map[string]any{
		"proto_msg":      fmt.Sprintf("0x%04x", msgID),
		"body_len":       len(rest),
		"vehicle_online": online,
	}
	if len(rest) < 21 {
		return "", patch, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	patch["vehicle_plate"] = plate
	if len(rest) >= 22 {
		patch["vehicle_color"] = int(rest[21])
	}
	if len(rest) >= 28 {
		patch["online_time_bcd"] = fmt.Sprintf("%x", rest[22:28])
		if ts, hit := parseWarnBcdTime(rest[22:28]); hit {
			patch["online_time"] = ts.Format(time.RFC3339)
		}
	}
	return plate, patch, plate != ""
}

// parseVehicleList1500 extracts plate/color from 0x1500 vehicle-list notifies.
func parseVehicleList1500(rest []byte) (plate string, patch map[string]any, ok bool) {
	patch = map[string]any{"proto_msg": "0x1500", "body_len": len(rest), "vehicle_list": true}
	if len(rest) < 21 {
		return "", patch, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	patch["vehicle_plate"] = plate
	if len(rest) >= 22 {
		patch["vehicle_color"] = int(rest[21])
	}
	if len(rest) >= 23 {
		patch["vehicle_flag"] = int(rest[22])
	}
	return plate, patch, plate != ""
}

// parseMediaUpload160x extracts plate + media type/size/name from 0x1601/0x1602.
func parseMediaUpload160x(msgID uint16, rest []byte) (plate string, patch map[string]any, ok bool) {
	patch = map[string]any{
		"proto_msg": fmt.Sprintf("0x%04x", msgID),
		"body_len":  len(rest),
	}
	if msgID == 0x1602 {
		patch["media_complete"] = true
	} else {
		patch["media_upload"] = true
	}
	if len(rest) < 21 {
		return "", patch, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	patch["vehicle_plate"] = plate
	if len(rest) >= 22 {
		patch["media_type"] = int(rest[21])
	}
	if len(rest) >= 26 {
		patch["media_size"] = int(binary.BigEndian.Uint32(rest[22:26]))
	}
	if len(rest) > 26 {
		name := strings.TrimRight(string(rest[26:]), "\x00 ")
		if len(name) > 128 {
			name = name[:128]
		}
		if name != "" && isMostlyPrintable(name) {
			patch["media_file"] = name
		}
	}
	return plate, patch, plate != "" || len(rest) >= 22
}

// parseMediaAttach1210 extracts plate + attach length / optional filename from 0x1210.
func parseMediaAttach1210(rest []byte) (plate string, patch map[string]any, ok bool) {
	patch = map[string]any{
		"proto_msg":    "0x1210",
		"body_len":     len(rest),
		"media_attach": true,
	}
	if len(rest) < 21 {
		return "", patch, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	patch["vehicle_plate"] = plate
	if len(rest) >= 22 {
		patch["vehicle_color"] = int(rest[21])
	}
	if len(rest) >= 26 {
		patch["attach_info_len"] = int(binary.BigEndian.Uint32(rest[22:26]))
	}
	if len(rest) > 26 {
		name := strings.TrimRight(string(rest[26:]), "\x00 ")
		if len(name) > 128 {
			name = name[:128]
		}
		if name != "" && isMostlyPrintable(name) {
			patch["attach_file"] = name
		} else if len(rest) > 26 {
			n := len(rest) - 26
			if n > 32 {
				n = 32
			}
			patch["attach_hex"] = fmt.Sprintf("%x", rest[26:26+n])
		}
	}
	return plate, patch, plate != "" || len(rest) >= 26
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

// parseDriverReport extracts plate/color/state and fixed-width driver identity fields from 0x1208.
// Layout (common interconnect): plate[21]+color[1]+state[1]+name[16]+id[20]+licence[40]+org[…].
func parseDriverReport(rest []byte) (plate string, patch map[string]any, ok bool) {
	patch = map[string]any{
		"proto_msg":     "0x1208",
		"body_len":      len(rest),
		"driver_report": true,
	}
	if len(rest) < 21 {
		return "", patch, false
	}
	plate = strings.TrimRight(string(rest[0:21]), "\x00 ")
	patch["vehicle_plate"] = plate
	if len(rest) >= 22 {
		patch["vehicle_color"] = int(rest[21])
	}
	if len(rest) >= 23 {
		patch["driver_state"] = int(rest[22])
	}
	trimZ := func(b []byte) string {
		return strings.TrimRight(string(b), "\x00 ")
	}
	if len(rest) >= 39 {
		if s := trimZ(rest[23:39]); s != "" {
			patch["driver_name"] = s
		}
	}
	if len(rest) >= 59 {
		if s := trimZ(rest[39:59]); s != "" {
			patch["driver_id"] = s
		}
	}
	if len(rest) >= 99 {
		if s := trimZ(rest[59:99]); s != "" {
			patch["driver_licence"] = s
		}
	}
	if len(rest) > 99 {
		if s := trimZ(rest[99:]); s != "" {
			patch["driver_org"] = s
		}
	}
	return plate, patch, plate != "" || len(rest) >= 23
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
	switch msgID {
	case 0x1200:
		out.RawAttrs["location_realtime"] = true
	case 0x1203:
		out.RawAttrs["location_history"] = true
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
		off += 2
	}
	// Optional REAL_LOCATION tail: altitude(WORD) + vehicle_state(DWORD) + alarm(DWORD).
	if off+2 <= len(gnss) {
		alt := float64(int16(binary.BigEndian.Uint16(gnss[off : off+2])))
		out.Altitude = &alt
		out.RawAttrs["gnss_altitude"] = alt
		off += 2
	}
	if off+4 <= len(gnss) {
		st := binary.BigEndian.Uint32(gnss[off : off+4])
		out.RawAttrs["vehicle_state"] = int(st)
		out.RawAttrs["status.acc"] = st&0x01 != 0
		off += 4
	}
	if off+4 <= len(gnss) {
		al := binary.BigEndian.Uint32(gnss[off : off+4])
		out.RawAttrs["gnss_alarm"] = int(al)
		if al != 0 {
			out.RawAttrs["alarm.gnss"] = true
			jt808.FlattenAlarmBits(al, out.RawAttrs)
		}
	}
	return out, plate, true
}
