import fs from "fs";

const wikiPath =
  process.env.WIKI_PATH ||
  String.raw`C:\Users\haryo\.cursor\projects\c-Users-haryo-fms-embed\agent-tools\f6c99b4a-8f0c-43fd-a7ba-d59901673c27.txt`;
const wiki = fs.readFileSync(wikiPath, "utf8");
const avlIds = [
  ...new Set([...wiki.matchAll(/^\| (\d+) \|/gm)].map((m) => +m[1])),
].sort((a, b) => a - b);
if (avlIds.length < 500) {
  throw new Error(`expected ~634 AVL IDs, got ${avlIds.length}`);
}

const names = new Map();
for (const m of wiki.matchAll(/^\| (\d+) \| ([^|]+?) \|/gm)) {
  const id = +m[1];
  const name = m[2].trim();
  if (!names.has(id)) names.set(id, name);
}

const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const cooked = [
  "voltage.ext",
  "voltage.batt",
  "voltage.ain1",
  "voltage.ain2",
  "sd.status",
  "gsm.signal",
  "gsm.operator",
  "gsm.cell_id",
  "gsm.lac",
  "network.type",
  "gsm.iccid",
  "ibutton.id",
  "rfid.id",
  "user.id",
  "vehicle.vin",
  "obd.fault_codes",
  "bt.status",
  "barcode.id",
  "fuel.lls1",
  "fuel.lls_temp1",
  "fuel.lls2",
  "fuel.lls_temp2",
  "fuel.lls3",
  "fuel.lls_temp3",
  "fuel.lls4",
  "fuel.lls_temp4",
  "fuel.lls5",
  "fuel.lls_temp5",
  ...Array.from({ length: 50 }, (_, i) => `geofence.zone${i + 1}`),
  "geofence.auto",
  "alarm.event",
  "green_driving.magnitude",
  "crash.trace",
  "status.private_mode",
  "gsm.iccid2",
  "can.vehicle_speed",
  "can.throttle",
  "can.fuel_consumed",
  "can.engine_rpm",
  "can.mileage",
  "can.mileage_counted",
  "can.fuel_counted",
  "can.coolant_temp",
  "can.battery_voltage",
  "axle.load1",
  "axle.load2",
  "axle.load3",
  "axle.load4",
  "axle.load5",
  "temp.id1",
  "temp.id2",
  "temp.id3",
  "ground.sense",
  "beacon.ids",
  "gnss.iso6709",
  "trip.event",
  "overspeed.speed",
  "ble.fuel1",
  "ble.fuel2",
  "ble.fuel3",
  "ble.fuel4",
  "ble.fuel_freq1",
  "ble.fuel_freq2",
  "ble.fuel_freq3",
  "ble.fuel_freq4",
  "ble.custom1_1",
  "ble.custom1_2",
  "ble.custom1_3",
  "ble.custom1_4",
  "ble.luminosity1",
  "ble.luminosity2",
  "ble.luminosity3",
  "ble.luminosity4",
  "ble.custom2_1",
  "ble.custom2_2",
  "ble.custom2_3",
  "ble.custom2_4",
  "ble.custom3_1",
  "ble.custom3_2",
  "ble.custom3_3",
  "ble.custom3_4",
  "ble.custom4_1",
  "ble.custom4_2",
  "ble.custom4_3",
  "ble.custom4_4",
  "ble.custom5_1",
  "ble.custom5_2",
  "ble.custom5_3",
  "ble.custom5_4",
  "fuel.oem_level",
  "speed.io",
  "trip.odometer",
  "odometer",
  "fuel.level",
  "fuel.type",
  "fuel.volume",
  "engine.rpm",
  "speed.obd",
  "engine.timing_advance",
  "obd.mil_distance",
  "fuel.rail_relative",
  "fuel.rail_direct",
  "engine.egr_commanded",
  "engine.egr_error",
  "obd.mil_time",
  "obd.codes_cleared_time",
  "fuel.rail_absolute",
  "obd.codes_cleared_distance",
  "hybrid.battery_life",
  "engine.injection_timing",
  "engine.fuel_rate",
  "battery.current",
  "network.data_mode",
  "fuel.air_equivalence",
  "hybrid.system_voltage",
  "hybrid.system_current",
  "fuel.pressure",
  "engine.map",
  "engine.intake_temp",
  "engine.maf",
  "engine.baro",
  "obd.ecu_voltage",
  "engine.ambient_temp",
  "engine.oil_temp",
  "engine.coolant_temp",
  "engine.short_fuel_trim",
  "obd.dtc_count",
  "engine.load",
  "engine.throttle",
  "engine.runtime",
  "fuel.used",
  "fuel.rate",
  "status.ignition",
  "status.din1",
  "status.din2",
  "status.din3",
  "status.din4",
  "status.din5",
  "status.din6",
  "status.dout1",
  "status.dout2",
  "status.dout3",
  "sleep.mode",
  "status.sleeping",
  "idling",
  "status.idling",
  "temp.1",
  "temp.2",
  "temp.3",
  "temp.4",
  "ble.temp1",
  "ble.temp2",
  "ble.temp3",
  "ble.temp4",
  "ble.battery",
  "ble.humidity",
  "ble.humidity2",
  "ble.humidity3",
  "ble.humidity4",
  "ble.battery2",
  "ble.battery3",
  "ble.battery4",
  "battery.level",
  "battery.voltage",
  "green_driving.value",
  "green_driving.duration",
  "eco.score",
  "accel.x",
  "accel.y",
  "accel.z",
  "gnss.pdop",
  "gnss.hdop",
  "gnss.vdop",
  "gnss.status",
  "pcb.temp",
  "status.towing",
  "status.crash",
  "status.geofence",
  "status.jamming",
  "status.unplug",
  "status.movement",
  "alarm.geofence",
  "alarm.generic",
  "alarm.movement",
  "alarm.towing",
  "alarm.crash",
  "alarm.autogeofence",
  "alarm.jamming",
  "alarm.trip",
  "alarm.idling",
  "alarm.unplug",
  "alarm.green_driving",
  "alarm.overspeed",
  "alarm.sos",
  "alarm.door",
  "alarm.ext_voltage",
  "alarm.ignition",
  "alarm.green_driving_duration",
  "alarm_level",
];

const teltAllow = new Set([...avlIds.map((id) => `io.${id}`), ...cooked]);

const galTags = [
  0x01, 0x02, 0x03, 0x04, 0x10, 0x20, 0x21, 0x30, 0x33, 0x34, 0x35, 0x36, 0x37,
  0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5c, 0x5d,
  ...Array.from({ length: 16 }, (_, i) => 0x60 + i),
  ...Array.from({ length: 8 }, (_, i) => 0x70 + i),
  ...Array.from({ length: 8 }, (_, i) => 0x80 + i),
  0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x90, 0xd3,
  ...Array.from({ length: 16 }, (_, i) => 0xa0 + i),
  ...Array.from({ length: 10 }, (_, i) => 0xb0 + i),
  ...Array.from({ length: 16 }, (_, i) => 0xc0 + i),
  0xd0, 0xd1, 0xd2, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
  0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb,
  ...Array.from({ length: 10 }, (_, i) => 0xf0 + i),
  0xfa, 0xfd, 0xfe,
];

const galCooked = [
  "device.hw",
  "device.fw",
  "device.imei",
  "device.id",
  "archive.record",
  "odometer",
  "unix_time",
  "time.ms",
  "speed.gps",
  "heading.gps",
  "gnss.altitude",
  "hdop",
  "gnss.hdop",
  "pdop",
  "gnss.pdop",
  "vdop",
  "gnss.vdop",
  "gnss.sats",
  "gnss.fix",
  "gnss.glonass",
  "gnss.lbs",
  "voltage.supply",
  "voltage.ext",
  "voltage.batt",
  "temp.device",
  "status.device",
  "status.moving",
  "movement",
  "status.ibutton_trusted",
  "status.geofence",
  "status.acc",
  "status.ignition",
  "ignition",
  "status.alarm_mode",
  "status.extended",
  "alarm.tilt",
  "alarm.sim_missing",
  "alarm.battery_low",
  "alarm.gnss_antenna",
  "alarm.bus_voltage",
  "alarm.power_ext",
  "alarm.impact",
  "alarm.sos",
  "gsm.signal_q",
  "accel.x",
  "accel.y",
  "accel.z",
  "status.outputs",
  "status.outputs_hi",
  ...Array.from({ length: 16 }, (_, i) => `status.dout${i}`),
  "status.inputs",
  "status.inputs_hi",
  ...Array.from({ length: 16 }, (_, i) => `status.din${i}`),
  "status.tag.0x40",
  "status.tag.0x45",
  "status.tag.0x46",
  "ecodrive.accel",
  "ecodrive.brake",
  "ecodrive.turn",
  "ecodrive.bump",
  "ecodrive.accel_raw",
  "ecodrive.brake_raw",
  "ecodrive.turn_raw",
  "ecodrive.bump_raw",
  "ibutton.id",
  "ibutton.id2",
  "ibutton.mask",
  "energy.rep500",
  "fuel.level",
  "fuel.temp",
  "fuel.level2",
  "fuel.freq",
  ...Array.from({ length: 26 }, (_, i) => `analog.${i}`),
  "can.0",
  "can.1",
  "can.2",
  "can.3",
  "can.fuel_used",
  "can.fuel_level",
  "can.coolant_temp",
  "can.rpm",
  "can.mileage",
  "can.fuel_l",
  "engine.hours",
  "can8.0",
  "can8r.15",
  "can16.0",
  "can32.0",
  "can32.1",
  "axle.load1",
  "temp.0.id",
  "temp.1",
  "temp.2",
  "temp.3",
  "temp.4",
  "rs485.3.level",
  ...Array.from({ length: 8 }, (_, i) => `ds1923.${i}.temp`),
  ...Array.from({ length: 8 }, (_, i) => `ds1923.${i}.humidity`),
  "cmd.id",
  "cmd.reply",
  "cmd.reply_tag",
  "user.array_hex",
  ...Array.from({ length: 8 }, (_, i) => `user.${i}`),
  ...Array.from({ length: 64 }, (_, i) => `modbus.${i}`),
  ...Array.from({ length: 64 }, (_, i) => `ble.${i}`),
  "gsm.cellid",
  "gsm.lac",
  "gsm.mcc",
  "gsm.mnc",
  "gsm.signal_dbm",
];

const galAllow = new Set([
  ...galTags.map((t) => `tag.0x${t.toString(16)}`),
  ...galCooked,
]);

const lines = [];
lines.push("-- Purge Teltonika / Galileosky vendor params that are not from official sources.");
lines.push("-- Teltonika: FMB140 Data Sending Parameters ID wiki (AVL IDs) + cooked keys the gateway");
lines.push("--   promotes from those AVL IDs (promoteTeltonikaScalars / safety event map).");
lines.push("--   https://wiki.teltonika-gps.com/view/FMB140_Teltonika_Data_Sending_Parameters_ID");
lines.push("-- Galileosky: official tag table (protocol exchange §8) + FE Modbus0–63 /");
lines.push("--   Bluetooth0–63 / GSM cell (0x81–0x85) + cooked promotions from those tags.");
lines.push("-- Also drop remaps on teltonika/galileosky profiles whose vendor_key is no longer catalogued.");
lines.push("");

lines.push("-- Ensure official Teltonika AVL IDs exist as io.<id> in the picker.");
lines.push(
  "INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES",
);
lines.push(
  avlIds
    .map((id) => {
      const nm = names.get(id) || `AVL ${id}`;
      return `  ('teltonika', 'io.${id}', ${sqlStr(nm)}, 'number', 'Official FMB140 AVL ID ${id}')`;
    })
    .join(",\n"),
);
lines.push("ON CONFLICT (protocol, vendor_key) DO UPDATE SET");
lines.push("  label = EXCLUDED.label,");
lines.push("  description = EXCLUDED.description;");
lines.push("");

lines.push("-- Ensure official Galileosky tags exist as tag.0xNN.");
lines.push(
  "INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES",
);
lines.push(
  galTags
    .map((t) => {
      const hx = t.toString(16);
      return `  ('galileosky', 'tag.0x${hx}', 'Tag 0x${hx.toUpperCase()}', 'number', 'Official Galileosky tag 0x${hx.toUpperCase()}')`;
    })
    .join(",\n"),
);
lines.push("ON CONFLICT (protocol, vendor_key) DO UPDATE SET");
lines.push(
  "  description = COALESCE(tracker_protocol_params.description, EXCLUDED.description);",
);
lines.push("");

const teltList = [...teltAllow]
  .sort()
  .map((k) => sqlStr(k))
  .join(",\n  ");
const galList = [...galAllow]
  .sort()
  .map((k) => sqlStr(k))
  .join(",\n  ");

lines.push("-- Drop remaps whose vendor_key is not official for these protocols.");
lines.push("DELETE FROM tracker_param_maps m");
lines.push("USING tracker_device_profiles p");
lines.push("WHERE m.profile_id = p.id");
lines.push("  AND p.protocol = 'teltonika'");
lines.push("  AND m.vendor_key NOT IN (");
lines.push(`  ${teltList}`);
lines.push(");");
lines.push("");
lines.push("DELETE FROM tracker_param_maps m");
lines.push("USING tracker_devices d");
lines.push("WHERE m.device_id = d.id");
lines.push("  AND d.protocol = 'teltonika'");
lines.push("  AND m.vendor_key NOT IN (");
lines.push(`  ${teltList}`);
lines.push(");");
lines.push("");
lines.push("DELETE FROM tracker_param_maps m");
lines.push("USING tracker_device_profiles p");
lines.push("WHERE m.profile_id = p.id");
lines.push("  AND p.protocol = 'galileosky'");
lines.push("  AND m.vendor_key NOT IN (");
lines.push(`  ${galList}`);
lines.push(");");
lines.push("");
lines.push("DELETE FROM tracker_param_maps m");
lines.push("USING tracker_devices d");
lines.push("WHERE m.device_id = d.id");
lines.push("  AND d.protocol = 'galileosky'");
lines.push("  AND m.vendor_key NOT IN (");
lines.push(`  ${galList}`);
lines.push(");");
lines.push("");

lines.push("-- Purge non-official Teltonika catalog rows.");
lines.push("DELETE FROM tracker_protocol_params");
lines.push("WHERE protocol = 'teltonika'");
lines.push("  AND vendor_key NOT IN (");
lines.push(`  ${teltList}`);
lines.push(");");
lines.push("");
lines.push("-- Purge non-official Galileosky catalog rows.");
lines.push("DELETE FROM tracker_protocol_params");
lines.push("WHERE protocol = 'galileosky'");
lines.push("  AND vendor_key NOT IN (");
lines.push(`  ${galList}`);
lines.push(");");
lines.push("");

const out =
  "server/db/migrations/187_official_teltonika_galileosky_vendor_params.sql";
fs.writeFileSync(out, lines.join("\n"));
console.log(
  JSON.stringify({
    out,
    avlIds: avlIds.length,
    teltAllow: teltAllow.size,
    galAllow: galAllow.size,
    bytes: fs.statSync(out).size,
  }),
);
