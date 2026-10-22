package teltonika

import (
	"encoding/binary"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/avl"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// CRC16 IBM / ARC used by Teltonika AVL (poly 0xA001).
func crc16IBM(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

func verifyAVLCRC(payload, crcBuf []byte) bool {
	if len(crcBuf) < 4 {
		return false
	}
	got := binary.BigEndian.Uint32(crcBuf)
	want := uint32(crc16IBM(payload))
	return got == want
}

func parseAVL(payload []byte) (int, []store.Fix) {
	if len(payload) < 2 {
		return 0, nil
	}
	codec := payload[0]
	// Official Codec wiki (Codec 8 / 8 Extended / 16): Number of Data 1 is always 1 byte.
	// Codec 8E only widens IO IDs/counts — not the record-count field.
	// Mis-reading 8E as uint16 shifts Longitude/Latitude and corrupts the whole AVL.
	n := int(payload[1])
	off := 2
	if n == 0 {
		return 0, nil
	}
	var fixes []store.Fix
	for i := 0; i < n && off+24 <= len(payload); i++ {
		tsMs := int64(binary.BigEndian.Uint64(payload[off : off+8]))
		off += 8
		off++ // priority
		if off+15 > len(payload) {
			break
		}
		// GPS Element (official order): Longitude, Latitude, Altitude, Angle, Satellites, Speed.
		// Coordinates are signed int32 / 10_000_000 (two's complement; MSB set ⇒ south/west).
		lonRaw := int32(binary.BigEndian.Uint32(payload[off : off+4]))
		off += 4
		latRaw := int32(binary.BigEndian.Uint32(payload[off : off+4]))
		off += 4
		alt := int16(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2
		angle := int(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2
		sats := int(payload[off])
		off++
		speed := int(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2

		// Official: signed int32 / 10_000_000 (two's complement).
		lon := float64(lonRaw) / 10_000_000
		lat := float64(latRaw) / 10_000_000
		spd := float64(speed)
		// Angle = degrees from north (0–360), unsigned — this is course/heading.
		hdg := float64(angle)
		altF := float64(alt)
		io := map[string]any{}
		var eventID any
		var genType any

		var ioOK bool
		switch codec {
		case 0x08:
			off, eventID, io = extractIO8(payload, off)
			ioOK = true
		case 0x8e:
			off, eventID, io = extractIO8E(payload, off)
			ioOK = true
		case 0x10:
			// Codec 16: Event IO u16 + Generation Type u8 + IO groups (no NX).
			off, eventID, genType, io = extractIO16(payload, off)
			ioOK = true
		}
		if !ioOK {
			// Unknown AVL codec: keep GPS fix, stop record loop (IO length unknown).
			fixes = append(fixes, store.Fix{
				Lat: lat, Lon: lon, RecordedAt: time.UnixMilli(tsMs).UTC(),
				Speed: &spd, Heading: &hdg, Altitude: &altF, Satellites: &sats,
				RawAttrs: map[string]any{"codec": codec, "io": io, "codec_unsupported": true},
			})
			break
		}

		raw := map[string]any{
			"codec":        codec,
			"io":           io,
			"event_io":     eventID,
			"record_index": i,
			// Official GPS Element fields (Codec wiki) — scaled for Live / Terminal.
			"gps.longitude":      lon,
			"gps.latitude":       lat,
			"gps.altitude":       altF,
			"gps.angle":          hdg, // degrees from north = heading
			"gps.satellites":     sats,
			"gps.speed":          spd, // km/h from satellites
			"gps.longitude_raw":  lonRaw, // signed int32 before /1e7
			"gps.latitude_raw":   latRaw,
			"gps.altitude_raw":   alt,
			"gps.angle_raw":      angle,
		}
		if genType != nil {
			raw["generation_type"] = genType
		}
		// Flatten io.* for Device Manager remap vendor keys (raw AVL units).
		for k, v := range io {
			raw["io."+k] = v
		}
		promoteTeltonikaScalars(raw, io)
		flattenEventAlarm(raw)
		flattenIOAlarms(raw, io)

		// AVL 387 ISO6709 (Codec 8E): official string form is +lat+lon+alt/.
		// When present, prefer it over the GPS Element (wiki ISO6709 page).
		if iso, ok := io["387"].(string); ok {
			if ilat, ilon, ialt, ok := parseTeltonikaISO6709(iso); ok {
				lat, lon = ilat, ilon
				altF = ialt
				raw["gps.latitude"] = lat
				raw["gps.longitude"] = lon
				raw["gps.altitude"] = altF
				raw["gps.source"] = "iso6709"
			}
		}

		fix := store.Fix{
			Lat: lat, Lon: lon, RecordedAt: time.UnixMilli(tsMs).UTC(),
			Speed: &spd, Heading: &hdg, Altitude: &altF, Satellites: &sats,
			RawAttrs: raw,
		}
		if v, ok := io["239"]; ok {
			b := asIOBool(v)
			fix.Ignition = &b
		} else if v, ok := io["1"]; ok {
			b := asIOBool(v)
			fix.Ignition = &b
		}
		// AVL 16 Total Odometer = metres (FMB wiki) → km; AVL 389 OEM mileage already km.
		if v, ok := io["16"]; ok {
			f := asIOFloat(v) / 1000.0
			fix.Odometer = &f
		} else if v, ok := io["389"]; ok {
			f := asIOFloat(v)
			fix.Odometer = &f
		}
		fixes = append(fixes, fix)
	}
	return n, fixes
}

// parseTeltonikaISO6709 decodes AVL 387 per https://wiki.teltonika-gps.com/view/ISO6709
// Example: +547010.2667+0252596.7000+000.136/ → lat 54.70102667°, lon 25.25967°, alt 136 m
// Lat/lon are ±deg×10000; altitude in the wiki example is kilometres (0.136 km = 136 m)
// matching GPS Element altitude 0x0088.
func parseTeltonikaISO6709(s string) (lat, lon, alt float64, ok bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, 0, 0, false
	}
	s = strings.TrimSuffix(s, "/")
	parts := splitISO6709Parts(s)
	if len(parts) < 2 {
		return 0, 0, 0, false
	}
	latRaw, err1 := strconv.ParseFloat(parts[0], 64)
	lonRaw, err2 := strconv.ParseFloat(parts[1], 64)
	if err1 != nil || err2 != nil {
		return 0, 0, 0, false
	}
	lat = latRaw / 10000.0
	lon = lonRaw / 10000.0
	if len(parts) >= 3 {
		if a, err := strconv.ParseFloat(parts[2], 64); err == nil {
			// Wiki sample +000.136/ ↔ GPS Element 136 m ⇒ kilometres in the string.
			alt = a * 1000.0
		}
	}
	if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return 0, 0, 0, false
	}
	return lat, lon, alt, true
}

func splitISO6709Parts(s string) []string {
	// Keep leading sign on each component: +547010.2667+0252596.7000+000.136
	var parts []string
	start := 0
	for i := 1; i < len(s); i++ {
		if s[i] == '+' || s[i] == '-' {
			parts = append(parts, s[start:i])
			start = i
		}
	}
	if start < len(s) {
		parts = append(parts, s[start:])
	}
	return parts
}

// promoteTeltonikaScalars lifts common FMB AVL IDs onto remappable raw keys (partial set).
func promoteTeltonikaScalars(raw map[string]any, io map[string]any) {
	if raw == nil || io == nil {
		return
	}
	if v, ok := io["66"]; ok {
		raw["voltage.ext"] = asIOFloat(v) / 1000.0 // mV → V
	}
	if v, ok := io["67"]; ok {
		raw["voltage.batt"] = asIOFloat(v) / 1000.0
	}
	if v, ok := io["9"]; ok {
		raw["voltage.ain1"] = asIOFloat(v) / 1000.0 // AVL 9 Analog Input 1, ×0.001 V
	}
	// AVL 6 = Analog Input 2 (FMB140/125/150 wiki). AVL 10 = SD Status — not AIN2.
	if v, ok := io["6"]; ok {
		raw["voltage.ain2"] = asIOFloat(v) / 1000.0
	}
	if v, ok := io["10"]; ok {
		raw["sd.status"] = asIOFloat(v)
	}
	if v, ok := io["21"]; ok {
		raw["gsm.signal"] = asIOFloat(v)
	}
	if v, ok := io["241"]; ok {
		raw["gsm.operator"] = asIOFloat(v)
	}
	if v, ok := io["205"]; ok {
		raw["gsm.cell_id"] = asIOFloat(v)
	}
	if v, ok := io["206"]; ok {
		raw["gsm.lac"] = asIOFloat(v)
	}
	if v, ok := io["237"]; ok {
		raw["network.type"] = asIOFloat(v)
	}
	if v, ok := io["11"]; ok {
		raw["gsm.iccid"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["78"]; ok {
		raw["ibutton.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["207"]; ok {
		raw["rfid.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["238"]; ok {
		raw["user.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["256"]; ok {
		raw["vehicle.vin"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["281"]; ok {
		raw["obd.fault_codes"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["263"]; ok {
		raw["bt.status"] = asIOFloat(v)
	}
	if v, ok := io["264"]; ok {
		raw["barcode.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["201"]; ok {
		raw["fuel.lls1"] = float64(int16(uint16(asIOFloat(v))))
	}
	if v, ok := io["202"]; ok {
		raw["fuel.lls_temp1"] = float64(int8(uint8(asIOFloat(v))))
	}
	if v, ok := io["203"]; ok {
		raw["fuel.lls2"] = float64(int16(uint16(asIOFloat(v))))
	}
	if v, ok := io["204"]; ok {
		raw["fuel.lls_temp2"] = float64(int8(uint8(asIOFloat(v))))
	}
	if v, ok := io["210"]; ok {
		raw["fuel.lls3"] = float64(int16(uint16(asIOFloat(v))))
	}
	if v, ok := io["211"]; ok {
		raw["fuel.lls_temp3"] = float64(int8(uint8(asIOFloat(v))))
	}
	if v, ok := io["212"]; ok {
		raw["fuel.lls4"] = float64(int16(uint16(asIOFloat(v))))
	}
	if v, ok := io["213"]; ok {
		raw["fuel.lls_temp4"] = float64(int8(uint8(asIOFloat(v))))
	}
	if v, ok := io["214"]; ok {
		raw["fuel.lls5"] = float64(int16(uint16(asIOFloat(v))))
	}
	if v, ok := io["215"]; ok {
		raw["fuel.lls_temp5"] = float64(int8(uint8(asIOFloat(v))))
	}
	if v, ok := io["155"]; ok {
		raw["geofence.zone1"] = asIOFloat(v)
	}
	if v, ok := io["156"]; ok {
		raw["geofence.zone2"] = asIOFloat(v)
	}
	if v, ok := io["157"]; ok {
		raw["geofence.zone3"] = asIOFloat(v)
	}
	if v, ok := io["158"]; ok {
		raw["geofence.zone4"] = asIOFloat(v)
	}
	if v, ok := io["159"]; ok {
		raw["geofence.zone5"] = asIOFloat(v)
	}
	if v, ok := io["61"]; ok {
		raw["geofence.zone6"] = asIOFloat(v)
	}
	if v, ok := io["62"]; ok {
		raw["geofence.zone7"] = asIOFloat(v)
	}
	if v, ok := io["63"]; ok {
		raw["geofence.zone8"] = asIOFloat(v)
	}
	if v, ok := io["64"]; ok {
		raw["geofence.zone9"] = asIOFloat(v)
	}
	if v, ok := io["65"]; ok {
		raw["geofence.zone10"] = asIOFloat(v) // FMB geofence zone 10 event (not odometer)
	}
	// AVL 70 = Geofence zone 11 on FMB140/125/150 wiki (PCB temp is AVL 13201).
	if v, ok := io["70"]; ok {
		raw["geofence.zone11"] = asIOFloat(v)
	}
	if v, ok := io["88"]; ok {
		raw["geofence.zone12"] = asIOFloat(v)
	}
	if v, ok := io["91"]; ok {
		raw["geofence.zone13"] = asIOFloat(v)
	}
	if v, ok := io["92"]; ok {
		raw["geofence.zone14"] = asIOFloat(v)
	}
	if v, ok := io["93"]; ok {
		raw["geofence.zone15"] = asIOFloat(v)
	}
	if v, ok := io["94"]; ok {
		raw["geofence.zone16"] = asIOFloat(v)
	}
	if v, ok := io["95"]; ok {
		raw["geofence.zone17"] = asIOFloat(v)
	}
	if v, ok := io["96"]; ok {
		raw["geofence.zone18"] = asIOFloat(v)
	}
	if v, ok := io["97"]; ok {
		raw["geofence.zone19"] = asIOFloat(v)
	}
	if v, ok := io["98"]; ok {
		raw["geofence.zone20"] = asIOFloat(v)
	}
	if v, ok := io["99"]; ok {
		raw["geofence.zone21"] = asIOFloat(v)
	}
	if v, ok := io["153"]; ok {
		raw["geofence.zone22"] = asIOFloat(v)
	}
	if v, ok := io["154"]; ok {
		raw["geofence.zone23"] = asIOFloat(v)
	}
	if v, ok := io["190"]; ok {
		raw["geofence.zone24"] = asIOFloat(v)
	}
	if v, ok := io["191"]; ok {
		raw["geofence.zone25"] = asIOFloat(v)
	}
	if v, ok := io["192"]; ok {
		raw["geofence.zone26"] = asIOFloat(v)
	}
	if v, ok := io["193"]; ok {
		raw["geofence.zone27"] = asIOFloat(v)
	}
	if v, ok := io["194"]; ok {
		raw["geofence.zone28"] = asIOFloat(v)
	}
	if v, ok := io["195"]; ok {
		raw["geofence.zone29"] = asIOFloat(v)
	}
	if v, ok := io["196"]; ok {
		raw["geofence.zone30"] = asIOFloat(v)
	}
	if v, ok := io["197"]; ok {
		raw["geofence.zone31"] = asIOFloat(v)
	}
	if v, ok := io["198"]; ok {
		raw["geofence.zone32"] = asIOFloat(v)
	}
	if v, ok := io["208"]; ok {
		raw["geofence.zone33"] = asIOFloat(v)
	}
	if v, ok := io["209"]; ok {
		raw["geofence.zone34"] = asIOFloat(v)
	}
	if v, ok := io["216"]; ok {
		raw["geofence.zone35"] = asIOFloat(v)
	}
	if v, ok := io["217"]; ok {
		raw["geofence.zone36"] = asIOFloat(v)
	}
	if v, ok := io["218"]; ok {
		raw["geofence.zone37"] = asIOFloat(v)
	}
	if v, ok := io["219"]; ok {
		raw["geofence.zone38"] = asIOFloat(v)
	}
	if v, ok := io["220"]; ok {
		raw["geofence.zone39"] = asIOFloat(v)
	}
	if v, ok := io["221"]; ok {
		raw["geofence.zone40"] = asIOFloat(v)
	}
	if v, ok := io["222"]; ok {
		raw["geofence.zone41"] = asIOFloat(v)
	}
	if v, ok := io["223"]; ok {
		raw["geofence.zone42"] = asIOFloat(v)
	}
	if v, ok := io["224"]; ok {
		raw["geofence.zone43"] = asIOFloat(v)
	}
	if v, ok := io["225"]; ok {
		raw["geofence.zone44"] = asIOFloat(v)
	}
	if v, ok := io["226"]; ok {
		raw["geofence.zone45"] = asIOFloat(v)
	}
	if v, ok := io["227"]; ok {
		raw["geofence.zone46"] = asIOFloat(v)
	}
	if v, ok := io["228"]; ok {
		raw["geofence.zone47"] = asIOFloat(v)
	}
	if v, ok := io["229"]; ok {
		raw["geofence.zone48"] = asIOFloat(v)
	}
	if v, ok := io["230"]; ok {
		raw["geofence.zone49"] = asIOFloat(v)
	}
	if v, ok := io["231"]; ok {
		raw["geofence.zone50"] = asIOFloat(v)
	}
	if v, ok := io["175"]; ok {
		raw["geofence.auto"] = asIOFloat(v)
	}
	if v, ok := io["236"]; ok {
		raw["alarm.event"] = asIOBool(v)
	}
	if v, ok := io["254"]; ok {
		// Wiki magnitude; AVL 253 already hoisted as green_driving.value (type) — do not remap.
		raw["green_driving.magnitude"] = asIOFloat(v) / 100.0
	}
	if v, ok := io["257"]; ok {
		raw["crash.trace"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["391"]; ok {
		raw["status.private_mode"] = asIOBool(v)
	}
	if v, ok := io["14"]; ok {
		raw["gsm.iccid2"] = fmt.Sprintf("%v", v)
	}
	// FMB150/FMC250 CAN chip (distinct from classic OBD AVL 30–60).
	if v, ok := io["81"]; ok {
		raw["can.vehicle_speed"] = asIOFloat(v)
	}
	if v, ok := io["82"]; ok {
		raw["can.throttle"] = asIOFloat(v)
	}
	if v, ok := io["83"]; ok {
		raw["can.fuel_consumed"] = asIOFloat(v) / 10.0 // L ×0.1
	}
	if v, ok := io["85"]; ok {
		raw["can.engine_rpm"] = asIOFloat(v)
	}
	if v, ok := io["87"]; ok {
		raw["can.mileage"] = asIOFloat(v)
	}
	if v, ok := io["105"]; ok {
		raw["can.mileage_counted"] = asIOFloat(v)
	}
	if v, ok := io["107"]; ok {
		raw["can.fuel_counted"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["115"]; ok {
		raw["can.coolant_temp"] = asIOFloat(v) / 10.0 // °C ×0.1
	}
	if v, ok := io["168"]; ok {
		raw["can.battery_voltage"] = asIOFloat(v)
	}
	if v, ok := io["118"]; ok {
		raw["axle.load1"] = asIOFloat(v)
	}
	if v, ok := io["119"]; ok {
		raw["axle.load2"] = asIOFloat(v)
	}
	if v, ok := io["120"]; ok {
		raw["axle.load3"] = asIOFloat(v)
	}
	if v, ok := io["121"]; ok {
		raw["axle.load4"] = asIOFloat(v)
	}
	if v, ok := io["122"]; ok {
		raw["axle.load5"] = asIOFloat(v)
	}
	if v, ok := io["76"]; ok {
		raw["temp.id1"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["77"]; ok {
		raw["temp.id2"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["79"]; ok {
		raw["temp.id3"] = fmt.Sprintf("%v", v)
	}
	// AVL 71 = Dallas temp ID 4 — skipped (constraint).
	if v, ok := io["381"]; ok {
		raw["ground.sense"] = asIOBool(v)
	}
	if v, ok := io["385"]; ok {
		raw["beacon.ids"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["387"]; ok {
		raw["gnss.iso6709"] = fmt.Sprintf("%v", v)
	}
	// AVL 250 = Trip event (0 stop / 1 start), not distance. Distance = AVL 199 trip.odometer.
	if v, ok := io["250"]; ok {
		raw["trip.event"] = asIOFloat(v)
	}
	// AVL 255 = overspeed event speed (km/h), not a configured threshold.
	if v, ok := io["255"]; ok {
		raw["overspeed.speed"] = asIOFloat(v)
	}
	if v, ok := io["269"]; ok {
		raw["ble.fuel_temp1"] = float64(int16(uint16(asIOFloat(v)))) // Escort LLS °C signed
	}
	if v, ok := io["270"]; ok {
		raw["ble.fuel1"] = asIOFloat(v)
	}
	if v, ok := io["271"]; ok {
		raw["ble.fuel_batt1"] = asIOFloat(v) / 100.0 // V ×0.01
	}
	if v, ok := io["272"]; ok {
		raw["ble.fuel_temp2"] = float64(int16(uint16(asIOFloat(v)))) // Escort LLS °C signed
	}
	if v, ok := io["273"]; ok {
		raw["ble.fuel2"] = asIOFloat(v)
	}
	if v, ok := io["274"]; ok {
		raw["ble.fuel_batt2"] = asIOFloat(v) / 100.0 // V ×0.01
	}
	if v, ok := io["275"]; ok {
		raw["ble.fuel_temp3"] = float64(int16(uint16(asIOFloat(v))))
	}
	if v, ok := io["276"]; ok {
		raw["ble.fuel3"] = asIOFloat(v)
	}
	if v, ok := io["277"]; ok {
		raw["ble.fuel_batt3"] = asIOFloat(v) / 100.0
	}
	if v, ok := io["278"]; ok {
		raw["ble.fuel_temp4"] = float64(int16(uint16(asIOFloat(v))))
	}
	if v, ok := io["279"]; ok {
		raw["ble.fuel4"] = asIOFloat(v)
	}
	if v, ok := io["280"]; ok {
		raw["ble.fuel_batt4"] = asIOFloat(v) / 100.0
	}
	if v, ok := io["306"]; ok {
		raw["ble.fuel_freq1"] = asIOFloat(v)
	}
	if v, ok := io["307"]; ok {
		raw["ble.fuel_freq2"] = asIOFloat(v)
	}
	if v, ok := io["308"]; ok {
		raw["ble.fuel_freq3"] = asIOFloat(v)
	}
	if v, ok := io["309"]; ok {
		raw["ble.fuel_freq4"] = asIOFloat(v)
	}
	if v, ok := io["331"]; ok {
		raw["ble.custom1_1"] = asIOFloat(v)
	}
	if v, ok := io["332"]; ok {
		raw["ble.custom1_2"] = asIOFloat(v)
	}
	if v, ok := io["333"]; ok {
		raw["ble.custom1_3"] = asIOFloat(v)
	}
	if v, ok := io["334"]; ok {
		raw["ble.custom1_4"] = asIOFloat(v)
	}
	if v, ok := io["335"]; ok {
		raw["ble.luminosity1"] = asIOFloat(v)
	}
	if v, ok := io["336"]; ok {
		raw["ble.luminosity2"] = asIOFloat(v)
	}
	if v, ok := io["337"]; ok {
		raw["ble.luminosity3"] = asIOFloat(v)
	}
	if v, ok := io["338"]; ok {
		raw["ble.luminosity4"] = asIOFloat(v)
	}
	if v, ok := io["463"]; ok {
		raw["ble.custom2_1"] = asIOFloat(v)
	}
	if v, ok := io["464"]; ok {
		raw["ble.custom2_2"] = asIOFloat(v)
	}
	if v, ok := io["465"]; ok {
		raw["ble.custom2_3"] = asIOFloat(v)
	}
	if v, ok := io["466"]; ok {
		raw["ble.custom2_4"] = asIOFloat(v)
	}
	if v, ok := io["467"]; ok {
		raw["ble.custom3_1"] = asIOFloat(v)
	}
	if v, ok := io["468"]; ok {
		raw["ble.custom3_2"] = asIOFloat(v)
	}
	if v, ok := io["469"]; ok {
		raw["ble.custom3_3"] = asIOFloat(v)
	}
	if v, ok := io["470"]; ok {
		raw["ble.custom3_4"] = asIOFloat(v)
	}
	if v, ok := io["471"]; ok {
		raw["ble.custom4_1"] = asIOFloat(v)
	}
	if v, ok := io["472"]; ok {
		raw["ble.custom4_2"] = asIOFloat(v)
	}
	if v, ok := io["473"]; ok {
		raw["ble.custom4_3"] = asIOFloat(v)
	}
	if v, ok := io["474"]; ok {
		raw["ble.custom4_4"] = asIOFloat(v)
	}
	if v, ok := io["475"]; ok {
		raw["ble.custom5_1"] = asIOFloat(v)
	}
	if v, ok := io["476"]; ok {
		raw["ble.custom5_2"] = asIOFloat(v)
	}
	if v, ok := io["477"]; ok {
		raw["ble.custom5_3"] = asIOFloat(v)
	}
	if v, ok := io["478"]; ok {
		raw["ble.custom5_4"] = asIOFloat(v)
	}
	if v, ok := io["390"]; ok {
		raw["fuel.oem_level"] = asIOFloat(v) / 10.0 // L ×0.1
	}
	if v, ok := io["24"]; ok {
		raw["speed.io"] = asIOFloat(v)
	}
	if v, ok := io["199"]; ok {
		raw["trip.odometer"] = asIOFloat(v) // metres (trip)
	}
	// AVL 16 Total Odometer = metres → km; AVL 389 OBD OEM Total Mileage already km.
	if v, ok := io["16"]; ok {
		raw["odometer"] = asIOFloat(v) / 1000.0
	} else if v, ok := io["389"]; ok {
		raw["odometer"] = asIOFloat(v)
	}
	if v, ok := io["89"]; ok {
		raw["fuel.level"] = asIOFloat(v)
	}
	if v, ok := io["759"]; ok {
		raw["fuel.type"] = asIOFloat(v)
	}
	if v, ok := io["84"]; ok {
		raw["fuel.volume"] = asIOFloat(v)
	}
	if v, ok := io["36"]; ok {
		raw["engine.rpm"] = asIOFloat(v)
	}
	if v, ok := io["37"]; ok {
		raw["speed.obd"] = asIOFloat(v)
	}
	if v, ok := io["38"]; ok {
		raw["engine.timing_advance"] = asIOFloat(v)
	}
	if v, ok := io["43"]; ok {
		raw["obd.mil_distance"] = asIOFloat(v)
	}
	if v, ok := io["44"]; ok {
		raw["fuel.rail_relative"] = asIOFloat(v) / 10.0 // kPa ×0.1
	}
	if v, ok := io["45"]; ok {
		raw["fuel.rail_direct"] = asIOFloat(v) * 10.0 // kPa ×10
	}
	if v, ok := io["46"]; ok {
		raw["engine.egr_commanded"] = asIOFloat(v)
	}
	if v, ok := io["47"]; ok {
		raw["engine.egr_error"] = asIOFloat(v)
	}
	if v, ok := io["54"]; ok {
		raw["obd.mil_time"] = asIOFloat(v) // minutes
	}
	if v, ok := io["55"]; ok {
		raw["obd.codes_cleared_time"] = asIOFloat(v) // minutes
	}
	if v, ok := io["56"]; ok {
		raw["fuel.rail_absolute"] = asIOFloat(v) * 10.0 // kPa ×10
	}
	if v, ok := io["49"]; ok {
		raw["obd.codes_cleared_distance"] = asIOFloat(v) // km
	}
	if v, ok := io["57"]; ok {
		raw["hybrid.battery_life"] = asIOFloat(v) // %
	}
	if v, ok := io["59"]; ok {
		raw["engine.injection_timing"] = asIOFloat(v) / 100.0 // ° ×0.01
	}
	if v, ok := io["60"]; ok {
		raw["engine.fuel_rate"] = asIOFloat(v) / 100.0 // L/h ×0.01 (distinct from AVL13 fuel.rate)
	}
	if v, ok := io["68"]; ok {
		raw["battery.current"] = asIOFloat(v) / 1000.0 // A ×0.001
	}
	if v, ok := io["80"]; ok {
		raw["network.data_mode"] = asIOFloat(v)
	}
	if v, ok := io["541"]; ok {
		raw["fuel.air_equivalence"] = asIOFloat(v) / 100.0 // ×0.01
	}
	if v, ok := io["543"]; ok {
		raw["hybrid.system_voltage"] = asIOFloat(v)
	}
	if v, ok := io["544"]; ok {
		raw["hybrid.system_current"] = float64(int16(uint16(asIOFloat(v)))) // signed A
	}
	if v, ok := io["34"]; ok {
		raw["fuel.pressure"] = asIOFloat(v)
	}
	if v, ok := io["35"]; ok {
		raw["engine.map"] = asIOFloat(v)
	}
	if v, ok := io["39"]; ok {
		raw["engine.intake_temp"] = asIOFloat(v)
	}
	if v, ok := io["40"]; ok {
		raw["engine.maf"] = asIOFloat(v) / 100.0 // g/s ×0.01
	}
	if v, ok := io["50"]; ok {
		raw["engine.baro"] = asIOFloat(v)
	}
	if v, ok := io["51"]; ok {
		raw["obd.ecu_voltage"] = asIOFloat(v) / 1000.0 // mV → V
	}
	if v, ok := io["53"]; ok {
		raw["engine.ambient_temp"] = asIOFloat(v)
	}
	if v, ok := io["58"]; ok {
		raw["engine.oil_temp"] = asIOFloat(v)
	}
	if v, ok := io["32"]; ok {
		raw["engine.coolant_temp"] = asIOFloat(v)
	}
	if v, ok := io["33"]; ok {
		raw["engine.short_fuel_trim"] = asIOFloat(v)
	}
	if v, ok := io["30"]; ok {
		raw["obd.dtc_count"] = asIOFloat(v)
	}
	if v, ok := io["31"]; ok {
		raw["engine.load"] = asIOFloat(v)
	}
	if v, ok := io["41"]; ok {
		raw["engine.throttle"] = asIOFloat(v)
	}
	if v, ok := io["42"]; ok {
		raw["engine.runtime"] = asIOFloat(v)
	}
	// AVL 12 Fuel Used GPS ×0.001 L; AVL 13 Fuel Rate GPS ×0.01 l/100km (FMB wiki).
	if v, ok := io["12"]; ok {
		raw["fuel.used"] = asIOFloat(v) / 1000.0
	}
	if v, ok := io["13"]; ok {
		raw["fuel.rate"] = asIOFloat(v) / 100.0
	}
	// AVL 48 = OBD Fuel Level (%) on FMB wiki — do not remap (hoist/constraint).
	if v, ok := io["239"]; ok {
		raw["status.ignition"] = asIOBool(v)
		if l := avl.IgnitionLabel(int(asIOFloat(v))); l != "" {
			raw["ignition.label"] = l
		}
	} else if v, ok := io["1"]; ok {
		raw["status.ignition"] = asIOBool(v)
	}
	// FMB140 wiki: AVL 1/2/3 = Digital Input 1/2/3 only.
	// AVL 4/5 = Pulse Counter Din1/Din2; AVL 6 = Analog Input 2 — not DINs.
	for i, id := range []string{"1", "2", "3"} {
		if v, ok := io[id]; ok {
			raw[fmt.Sprintf("status.din%d", i+1)] = asIOBool(v)
		}
	}
	if v, ok := io["4"]; ok {
		raw["pulse.din1"] = asIOFloat(v)
	}
	if v, ok := io["5"]; ok {
		raw["pulse.din2"] = asIOFloat(v)
	}
	if v, ok := io["179"]; ok {
		raw["status.dout1"] = asIOBool(v)
	}
	if v, ok := io["180"]; ok {
		raw["status.dout2"] = asIOBool(v)
	}
	if v, ok := io["380"]; ok {
		raw["status.dout3"] = asIOBool(v)
	}
	// AVL 447 is not on FMB140 Data Sending Parameters wiki — do not invent dout4.
	if v, ok := io["200"]; ok {
		raw["sleep.mode"] = asIOFloat(v)
		raw["status.sleeping"] = asIOFloat(v) != 0
	}
	if v, ok := io["251"]; ok {
		raw["idling"] = asIOBool(v)
		raw["status.idling"] = asIOBool(v)
	}
	// Dallas Temperature 1–4: AVL 72–75, signed, ×0.1 °C (FMB140/125/150 wiki).
	if v, ok := io["72"]; ok {
		raw["temp.1"] = asIOInt32(v) / 10.0
	}
	if v, ok := io["73"]; ok {
		raw["temp.2"] = asIOInt32(v) / 10.0
	}
	if v, ok := io["74"]; ok {
		raw["temp.3"] = asIOInt32(v) / 10.0
	}
	if v, ok := io["75"]; ok {
		raw["temp.4"] = asIOInt32(v) / 10.0
	}
	// BLE Temperature #1–4: AVL 25–28, signed, ×0.01 °C.
	if v, ok := io["25"]; ok {
		raw["ble.temp1"] = asIOInt16(v) / 100.0
	}
	if v, ok := io["26"]; ok {
		raw["ble.temp2"] = asIOInt16(v) / 100.0
	}
	if v, ok := io["27"]; ok {
		raw["ble.temp3"] = asIOInt16(v) / 100.0
	}
	if v, ok := io["28"]; ok {
		raw["ble.temp4"] = asIOInt16(v) / 100.0
	}
	// BLE Battery #1 = AVL 29 (%); Humidity #1 = AVL 86 (×0.1 %RH) — do not swap.
	if v, ok := io["29"]; ok {
		raw["ble.battery"] = asIOFloat(v)
	}
	if v, ok := io["86"]; ok {
		raw["ble.humidity"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["104"]; ok {
		raw["ble.humidity2"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["106"]; ok {
		raw["ble.humidity3"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["108"]; ok {
		raw["ble.humidity4"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["20"]; ok {
		raw["ble.battery2"] = asIOFloat(v)
	}
	if v, ok := io["22"]; ok {
		raw["ble.battery3"] = asIOFloat(v)
	}
	if v, ok := io["23"]; ok {
		raw["ble.battery4"] = asIOFloat(v)
	}
	if v, ok := io["113"]; ok {
		raw["battery.level"] = asIOFloat(v) // AVL 113 Battery Level %
	}
	// AVL 114 on FMB140 wiki is NOT battery voltage (ALLCAN Engine Load on some pages).
	// Battery voltage is AVL 67 → voltage.batt above.
	// Green driving / eco metrics (AVL IDs — config dependent).
	if v, ok := io["253"]; ok {
		raw["green_driving.value"] = asIOFloat(v)
		if l := avl.GreenDrivingLabel(int(asIOFloat(v))); l != "" {
			raw["green_driving.label"] = l
		}
	}
	if v, ok := io["243"]; ok {
		raw["green_driving.duration"] = asIOFloat(v)
	}
	// AVL 15 Eco Score ×0.01 (FMB140 wiki).
	if v, ok := io["15"]; ok {
		raw["eco.score"] = asIOFloat(v) / 100.0
	}
	// Axis X/Y/Z: AVL 17/18/19, signed mG (FMB wiki).
	if v, ok := io["17"]; ok {
		raw["accel.x"] = asIOInt16(v)
	}
	if v, ok := io["18"]; ok {
		raw["accel.y"] = asIOInt16(v)
	}
	if v, ok := io["19"]; ok {
		raw["accel.z"] = asIOInt16(v)
	}
	if v, ok := io["181"]; ok {
		raw["gnss.pdop"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["182"]; ok {
		raw["gnss.hdop"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["183"]; ok {
		raw["gnss.vdop"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["69"]; ok {
		raw["gnss.status"] = asIOFloat(v)
	}
	// PCB Temperature: AVL 13201 on FMB140/125/150 wiki (signed ×0.1 °C).
	// Older PRO/FT docs used AVL 70; on FMB wiki AVL 70 is geofence zone 11.
	if v, ok := io["13201"]; ok {
		raw["pcb.temp"] = asIOInt16(v) / 10.0
	}
	if v, ok := io["246"]; ok {
		raw["status.towing"] = asIOBool(v)
	}
	if v, ok := io["247"]; ok {
		raw["crash.value"] = asIOFloat(v)
		raw["status.crash"] = asIOBool(v)
		if l := avl.CrashLabel(int(asIOFloat(v))); l != "" {
			raw["crash.label"] = l
		}
	}
	if v, ok := io["248"]; ok {
		raw["status.geofence"] = asIOBool(v)
	}
	if v, ok := io["249"]; ok {
		raw["status.jamming"] = asIOBool(v)
	}
	if v, ok := io["252"]; ok {
		raw["status.unplug"] = asIOBool(v)
	}
	if v, ok := io["240"]; ok {
		raw["status.movement"] = asIOBool(v)
		if l := avl.PermanentLabel(240, int(asIOFloat(v))); l != "" {
			raw["movement.label"] = l
		}
	}
}

func extractIO8(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off >= len(b) {
		return off, event, io
	}
	event = int(b[off])
	off++
	if off >= len(b) {
		return off, event, io
	}
	off++ // total IO count (informational)
	off = readSizedIO8(b, off, 1, io)
	off = readSizedIO8(b, off, 2, io)
	off = readSizedIO8(b, off, 4, io)
	off = readSizedIO8(b, off, 8, io)
	return off, event, io
}

func readSizedIO8(b []byte, off, size int, io map[string]any) int {
	if off >= len(b) {
		return off
	}
	n := int(b[off])
	off++
	for i := 0; i < n && off+1+size <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

// extractIO16: Event IO ID u16, Generation Type u8, N total u8, then sized groups
// with AVL ID u16 + value. Codec 16 does not include NX (official Codec wiki).
func extractIO16(b []byte, off int) (int, any, any, map[string]any) {
	io := map[string]any{}
	var event any
	var genType any
	if off+2 > len(b) {
		return off, event, genType, io
	}
	event = int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	if off >= len(b) {
		return off, event, genType, io
	}
	genType = int(b[off])
	off++
	if off >= len(b) {
		return off, event, genType, io
	}
	off++ // total IO count (1 byte per Codec 16 structure + wiki hex examples)
	off = readSizedIO16(b, off, 1, io)
	off = readSizedIO16(b, off, 2, io)
	off = readSizedIO16(b, off, 4, io)
	off = readSizedIO16(b, off, 8, io)
	return off, event, genType, io
}

func readSizedIO16(b []byte, off, size int, io map[string]any) int {
	if off >= len(b) {
		return off
	}
	n := int(b[off])
	off++
	for i := 0; i < n && off+2+size <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

func extractIO8E(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off+2 > len(b) {
		return off, event, io
	}
	event = int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	if off+2 > len(b) {
		return off, event, io
	}
	off += 2 // total IO u16
	off = readSizedIO8E(b, off, 1, io)
	off = readSizedIO8E(b, off, 2, io)
	off = readSizedIO8E(b, off, 4, io)
	off = readSizedIO8E(b, off, 8, io)
	// NX variable
	if off+2 > len(b) {
		return off, event, io
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	for i := 0; i < n && off+4 <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		l := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		if off+l > len(b) {
			break
		}
		key := fmt.Sprintf("%d", id)
		switch l {
		case 0:
			io[key] = 0
		case 1, 2, 4, 8:
			io[key] = readIntBE(b[off:off+l], l)
		default:
			chunk := b[off : off+l]
			if isPrintableASCII(chunk) {
				io[key] = string(chunk)
			} else {
				io[key] = fmt.Sprintf("%x", chunk)
			}
		}
		off += l
	}
	return off, event, io
}

func readSizedIO8E(b []byte, off, size int, io map[string]any) int {
	if off+2 > len(b) {
		return off
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	for i := 0; i < n && off+2+size <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

func readIntBE(b []byte, size int) any {
	switch size {
	case 1:
		return int(b[0])
	case 2:
		return int(binary.BigEndian.Uint16(b))
	case 4:
		return int64(binary.BigEndian.Uint32(b))
	case 8:
		return int64(binary.BigEndian.Uint64(b))
	default:
		return fmt.Sprintf("%x", b)
	}
}

func isPrintableASCII(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	for _, c := range b {
		if c < 0x20 || c > 0x7e {
			return false
		}
	}
	return true
}

func asIOBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int:
		return t != 0
	case int64:
		return t != 0
	default:
		return false
	}
}

func asIOFloat(v any) float64 {
	switch t := v.(type) {
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float64:
		return t
	default:
		return 0
	}
}

// asIOInt16 reinterprets an IO numeric as signed int16 (Teltonika signed 2-byte elements).
func asIOInt16(v any) float64 {
	f := asIOFloat(v)
	if f < 0 {
		return f
	}
	return float64(int16(uint16(f)))
}

// asIOInt32 reinterprets an IO numeric as signed int32 (Teltonika signed 4-byte elements).
func asIOInt32(v any) float64 {
	f := asIOFloat(v)
	if f < 0 {
		return f
	}
	return float64(int32(uint32(f)))
}
