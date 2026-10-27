package store

import "testing"

func TestValidCoords(t *testing.T) {
	cases := []struct {
		lat, lon float64
		ok       bool
	}{
		{0, 0, false},
		{-6.2, 106.8, true},
		{91, 0, false},
		{0, 181, false},
		{-90, 180, true},
		{90, -180, true},
		{108.3129532, 12.35597, false}, // swapped SE-Asia lon/lat
	}
	for _, c := range cases {
		if got := ValidCoords(c.lat, c.lon); got != c.ok {
			t.Fatalf("ValidCoords(%v,%v)=%v want %v", c.lat, c.lon, got, c.ok)
		}
	}
}

func TestNormalizeFixCoords_SwapsInvertedLonLat(t *testing.T) {
	fix := Fix{Lat: 108.3129532, Lon: 12.35597, RawAttrs: map[string]any{}}
	NormalizeFixCoords(&fix)
	if !ValidCoords(fix.Lat, fix.Lon) {
		t.Fatalf("still invalid lat=%v lon=%v", fix.Lat, fix.Lon)
	}
	if fix.Lat < 12 || fix.Lat > 13 || fix.Lon < 108 || fix.Lon > 109 {
		t.Fatalf("swap failed lat=%v lon=%v", fix.Lat, fix.Lon)
	}
	if fix.RawAttrs["gps.swapped"] != true {
		t.Fatalf("expected gps.swapped marker")
	}
}

func TestNormalizeFixCoords_LeavesValid(t *testing.T) {
	fix := Fix{Lat: -6.2, Lon: 106.8}
	NormalizeFixCoords(&fix)
	if fix.Lat != -6.2 || fix.Lon != 106.8 {
		t.Fatalf("mutated valid coords lat=%v lon=%v", fix.Lat, fix.Lon)
	}
}

func TestIsCookedAppParamKey_ExcludesOpaqueIO(t *testing.T) {
	if isCookedAppParamKey("io.66") || isCookedAppParamKey("io.239") {
		t.Fatal("io.* must not be treated as cooked (raw mV / bits)")
	}
	if isCookedAppParamKey("tag.0x41") || isCookedAppParamKey("add.0x01") {
		t.Fatal("tag/add dumps must not be cooked")
	}
	if !isCookedAppParamKey("voltage.ext") || !isCookedAppParamKey("status.ignition") {
		t.Fatal("semantic cooked keys required")
	}
}

func TestStripUnmappedGalileoskyIgnition(t *testing.T) {
	on := true
	fix := Fix{
		Ignition: &on,
		RawAttrs: map[string]any{"status.ignition": true, "status.engine": true},
		MappedAttrs: map[string]any{"status.ignition": true, "status.engine": true},
	}
	if !stripUnmappedGalileoskyIgnition("galileosky", "galileosky", &fix) {
		t.Fatal("expected clear")
	}
	if fix.Ignition != nil {
		t.Fatalf("ignition=%v", fix.Ignition)
	}
	if _, ok := fix.MappedAttrs["status.ignition"]; ok {
		t.Fatalf("stale mapped ignition: %v", fix.MappedAttrs)
	}
	if fix.MappedAttrs["status.engine"] != true {
		t.Fatal("engine flag must stay")
	}

	fix2 := Fix{MappedAttrs: map[string]any{"ignition": true}}
	if stripUnmappedGalileoskyIgnition("galileosky", "galileosky", &fix2) {
		t.Fatal("mapped ignition must be kept")
	}
	if stripUnmappedGalileoskyIgnition("teltonika", "", &Fix{MappedAttrs: map[string]any{}}) {
		t.Fatal("non-galileosky must not strip")
	}
}
