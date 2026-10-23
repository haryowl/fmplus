package avl

// Official Teltonika FMB AVL IO value descriptions (wiki Description column).
// Shared with Ruptela FM configs that reuse the same IO numbers.

func GreenDrivingLabel(v int) string {
	switch v {
	case 1:
		return "Harsh acceleration"
	case 2:
		return "Harsh braking"
	case 3:
		return "Harsh cornering"
	}
	return ""
}

func GreenDrivingAlarmType(v int) string {
	switch v {
	case 1:
		return "harsh_accel"
	case 2:
		return "harsh_brake"
	case 3:
		return "harsh_corner"
	}
	return ""
}

func CrashLabel(v int) string {
	switch v {
	case 1:
		return "Real crash detected (device is calibrated)"
	case 2:
		return "Limited crash trace (device not calibrated)"
	case 3:
		return "Limited crash trace (device is calibrated)"
	case 4:
		return "Full crash trace (device not calibrated)"
	case 5:
		return "Full crash trace (device is calibrated)"
	case 6:
		return "Real crash detected (device not calibrated)"
	case 9:
		return "Real crash detected (calibration off)"
	case 10:
		return "Limited crash trace (calibration off)"
	case 11:
		return "Full crash trace (calibration off)"
	case 12:
		return "Real crash detected (device is fully calibrated)"
	case 13:
		return "Limited crash trace (device is fully calibrated)"
	case 14:
		return "Full crash trace (device is fully calibrated)"
	}
	return ""
}

// RefineEvent maps a numeric IO value onto a specific alarm type + official label.
func RefineEvent(base string, ioID, value int) (alarmType, label string) {
	if ioID == 253 || base == "green_driving" {
		if t := GreenDrivingAlarmType(value); t != "" {
			return t, GreenDrivingLabel(value)
		}
		return "green_driving", "Green driving"
	}
	if ioID == 247 || base == "crash" {
		if l := CrashLabel(value); l != "" {
			return "crash", l
		}
		return "crash", "Crash"
	}
	if ioID == 239 || base == "ignition" {
		if l := PermanentLabel(239, value); l != "" {
			return "ignition", l
		}
		return "ignition", "Ignition"
	}
	if ioID == 240 || base == "movement" {
		if l := PermanentLabel(240, value); l != "" {
			return "movement", l
		}
		return "movement", "Movement"
	}
	if l := PermanentLabel(ioID, value); l != "" {
		return base, l
	}
	return base, ""
}

// EnrichSafetyRaw writes official IO value + description onto a safety event and
// returns the refined alarm type (harsh_brake, crash, …).
func EnrichSafetyRaw(raw map[string]any, base string, ioID, value int, hasValue bool) string {
	if raw == nil {
		return base
	}
	name, label := RefineEvent(base, ioID, value)
	if hasValue {
		raw["io_value"] = value
		if label != "" {
			raw["io_label"] = label
		}
		switch ioID {
		case 253, 243:
			raw["green_driving.value"] = value
			if label != "" {
				raw["green_driving.label"] = label
			}
		case 247:
			raw["crash.value"] = value
			if label != "" {
				raw["crash.label"] = label
			}
		case 239:
			raw["ignition.value"] = value
			if label != "" {
				raw["ignition.label"] = label
			}
		case 240:
			raw["movement.value"] = value
			if label != "" {
				raw["movement.label"] = label
			}
		}
	}
	return name
}
