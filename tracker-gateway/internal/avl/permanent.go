package avl

// Official FMB Permanent I/O Description-column enums (wiki FMB.Ver.03.29+).
var permanentIO = map[int]map[int]string{
	239: {0: "Ignition off", 1: "Ignition on"},
	240: {0: "Movement off", 1: "Movement on"},
	80: {
		0: "Home on stop",
		1: "Home on moving",
		2: "Roaming on stop",
		3: "Roaming on moving",
		4: "Unknown on stop",
		5: "Unknown on moving",
	},
	200: {
		0: "No sleep",
		1: "GPS sleep",
		2: "Deep sleep",
		3: "Online sleep",
		4: "Ultra sleep",
	},
	69: {
		0: "GNSS off",
		1: "GNSS on with fix",
		2: "GNSS on without fix",
		3: "GNSS sleep",
		4: "GNSS on with fix, invalid data",
	},
	10: {0: "SD not present", 1: "SD present"},
	1:   {0: "Off", 1: "On"},
	2:   {0: "Off", 1: "On"},
	3:   {0: "Off", 1: "On"},
	179: {0: "Off", 1: "On"},
	180: {0: "Off", 1: "On"},
	380: {0: "Off", 1: "On"},
	381: {0: "Off", 1: "On"},
	303: {0: "Movement off", 1: "Movement on"},
	237: {
		0:  "3G",
		1:  "GSM",
		2:  "4G",
		3:  "LTE CAT M1",
		4:  "LTE CAT NB1",
		99: "Unknown",
	},
	263: {
		0: "BT disabled",
		1: "BT enabled, not connected",
		2: "Device connected, BTv3 only",
		3: "Device connected, BLE only",
		4: "Device connected, BLE + BT",
	},
	404: {
		0: "None",
		1: "B.1 license",
		2: "B.2 license",
		3: "B.3 license",
		4: "B.4 license",
		5: "T.1 license",
		6: "T.2 license",
		7: "T.3 license",
		8: "T.4 license",
	},
	405: {0: "None", 1: "Male", 2: "Female"},
	409: {0: "Registered", 1: "Deregistered", 2: "Swapping"},
	383: {0: "No calibration", 1: "Calibrated", 2: "Not configured", 3: "Fully calibrated"},
	637: {0: "Not RTC wake", 1: "Woken by RTC alarm"},
	502: {0: "Speed sensor off", 1: "Speed sensor on"},
}

func PermanentLabel(ioID, value int) string {
	if m, ok := permanentIO[ioID]; ok {
		return m[value]
	}
	return ""
}

func IgnitionLabel(v int) string { return PermanentLabel(239, v) }
