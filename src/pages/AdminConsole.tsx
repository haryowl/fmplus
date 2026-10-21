import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  defaultEntitlements,
  FEATURE_LABELS,
  mergeEntitlements,
  MODULE_LABELS,
  normalizeFleetLiveDisplayPins,
  type Entitlements,
} from "../lib/entitlements";
import {
  FLEET_DISPLAY_PIN_IDS,
  effectiveDisplayPinIds,
  parseDisplayPinIdsText,
  toggleDisplayPinIdText,
} from "../lib/fleetTelemetryParams";
import {
  SCAN_ACTION_KEYS,
  SCAN_ACTION_LABELS,
  SCAN_BUILT_ACTIONS,
  SCAN_BUILT_INPUTS,
  SCAN_INPUT_KEYS,
  SCAN_INPUT_LABELS,
  SCAN_ROLE_LABELS,
  SCAN_ROLES,
  type ScanEntitlements,
} from "../lib/scanCapabilities";
import { BrandMark } from "../components/BrandMark";
import { AdminFleetDevicePanel, type DeviceFieldDef } from "../components/AdminFleetDevicePanel";
import {
  DESK_PRIVILEGE_KEYS,
  DESK_PRIVILEGE_LABELS,
  emptyDeskPrivileges,
  mergeDeskPrivileges,
  type DeskPrivileges,
} from "../lib/deskPrivileges";

type AdminTenant = {
  id: string;
  key: string;
  appId: number;
  displayName: string;
  enabled: boolean;
  userIds: number[];
  groupIds: number[];
  entitlements: Entitlements;
  hasWebhookSecret: boolean;
  hasToken: boolean;
  notifyEmails?: string;
  notifyWhatsapp?: string;
  wablasBaseUrl?: string;
  hasWablasToken?: boolean;
  hasWablasSecret?: boolean;
  dutyLocation?: { intervalSec: number; quietSec: number; minMoveM: number };
  telematicsSource?: "armada" | "devices" | "both";
  trackerIngestUrl?: string;
  notifierUrlTemplate: string;
  notifierUrlMaintenance?: string;
  updatedAt?: string;
};

type TrackerDeviceRow = {
  id: string;
  imei: string;
  uniqueId?: string;
  protocol: string;
  label: string;
  description?: string;
  plate?: string;
  vin?: string;
  make?: string;
  model?: string;
  modelYear?: number | null;
  vehicleType?: string;
  color?: string;
  cameraChannels?: number;
  tags?: string[];
  customAttrs?: Record<string, unknown>;
  armadaUserId: number | null;
  enabled: boolean;
  hasAuthToken: boolean;
  authToken?: string;
  videoChannelId?: string;
  videoRtspUrl?: string;
  videoNotes?: string;
  profileId?: string | null;
  lastSeenAt?: string | null;
  lastFix?: {
    lat: number;
    lon: number;
    recordedAt: string | null;
    speed: number | null;
    heading?: number | null;
    ignition?: boolean | null;
    sourceProtocol?: string;
  } | null;
};

type TrackerDeviceGroupRow = {
  id: string;
  name: string;
  description?: string;
  sortOrder?: number;
  memberCount?: number;
  deviceIds?: string[];
};

type UnassignedTrackerRow = {
  imei: string;
  protocol: string;
  lastRemote: string;
  hitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type FieldUserRow = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  phone?: string;
  email?: string;
  enabled: boolean;
  privileges?: DeskPrivileges;
};

type FieldUserEdit = {
  username: string;
  displayName: string;
  role: string;
  phone: string;
  email: string;
  password: string;
  privileges: DeskPrivileges;
};

function editFromRow(u: FieldUserRow): FieldUserEdit {
  return {
    username: u.username,
    displayName: u.displayName || "",
    role: u.role,
    phone: u.phone || "",
    email: u.email || "",
    password: "",
    privileges: mergeDeskPrivileges(u.privileges),
  };
}

type Draft = {
  key: string;
  appId: string;
  displayName: string;
  token: string;
  webhookSecret: string;
  userIds: string;
  groupIds: string;
  notifyEmails: string;
  notifyWhatsapp: string;
  wablasBaseUrl: string;
  wablasToken: string;
  wablasSecret: string;
  enabled: boolean;
  entitlements: Entitlements;
  dutyIntervalSec: string;
  dutyQuietSec: string;
  dutyMinMoveM: string;
  telematicsSource: "armada" | "devices" | "both";
  /** Raw Admin text for Fleet Live pins; blank = defaults. */
  fleetLiveDisplayPinsText: string;
};

/** Collapsed remap-rule cards shown before “Show more” (≈2 rows of 4). */
const MAP_RULES_COLLAPSED = 8;

const TRACKER_PROTOCOL_OPTIONS = [
  { value: "json", label: "JSON / HTTP (:5080) · partial" },
  { value: "teltonika", label: "Teltonika (:5027) · partial" },
  { value: "jt808", label: "JT/T 808 (:7611) · partial" },
  { value: "subiao", label: "Su Biao (:7612) · partial" },
  { value: "jt809", label: "JT/T 809 (:8090) · experimental" },
  { value: "jt1078", label: "JT/T 1078 (:1078) · experimental" },
  { value: "concox", label: "Concox / GT06 (:5023) · partial" },
  { value: "ruptela", label: "Ruptela (:3047) · partial" },
  { value: "galileosky", label: "Galileosky (:30175) · partial" },
  { value: "video", label: "Video (meta)" },
  { value: "other", label: "Other" },
];

const COMMAND_TYPE_OPTIONS: Array<{ value: string; label: string; protocols?: string[] }> = [
  { value: "text", label: "Text / GPRS (0x8300 / Codec12)" },
  {
    value: "jt808_8103",
    label: "JT808 set params (0x8103)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8104",
    label: "JT808 query params (0x8104)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8106",
    label: "JT808 query param ids (0x8106)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8107",
    label: "JT808 query attrs (0x8107)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8108",
    label: "JT808 terminal upgrade (0x8108)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8201",
    label: "JT808 query location (0x8201)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8202",
    label: "JT808 temp track (0x8202)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8204",
    label: "JT808 link detect (0x8204)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8105",
    label: "JT808 terminal control (0x8105)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8500",
    label: "JT808 vehicle control (0x8500)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8801",
    label: "JT808 camera shoot (0x8801)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8802",
    label: "JT808 media retrieve (0x8802)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8803",
    label: "JT808 media control (0x8803)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8804",
    label: "JT808 record audio (0x8804)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8805",
    label: "JT808 media by id (0x8805)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8900",
    label: "JT808 transparent DL (0x8900)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8702",
    label: "JT808 query driver (0x8702)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8700",
    label: "JT808 driving record (0x8700)",
    protocols: ["jt808", "subiao"],
  },
  { value: "teltonika_codec12", label: "Teltonika Codec12", protocols: ["teltonika"] },
  { value: "teltonika_codec13", label: "Teltonika Codec13 (timestamp)", protocols: ["teltonika"] },
  { value: "teltonika_codec14", label: "Teltonika Codec14 (IMEI)", protocols: ["teltonika"] },
  {
    value: "jt808_8203",
    label: "JT808 alarm confirm (0x8203)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8600",
    label: "JT808 set circle area (0x8600)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8602",
    label: "JT808 set rect area (0x8602)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8604",
    label: "JT808 set poly area (0x8604)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8601",
    label: "JT808 delete circle area (0x8601)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8603",
    label: "JT808 delete rect area (0x8603)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8605",
    label: "JT808 delete poly area (0x8605)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8606",
    label: "JT808 set route (0x8606)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8607",
    label: "JT808 delete route (0x8607)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8608",
    label: "JT808 query areas (0x8608)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_9101",
    label: "JT808 AV live request (0x9101)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_9102",
    label: "JT808 AV control (0x9102)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8301",
    label: "JT808 event set (0x8301)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8302",
    label: "JT808 question (0x8302)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8303",
    label: "JT808 info menu (0x8303)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8304",
    label: "JT808 info service (0x8304)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8400",
    label: "JT808 phone callback (0x8400)",
    protocols: ["jt808", "subiao"],
  },
  {
    value: "jt808_8401",
    label: "JT808 phone book (0x8401)",
    protocols: ["jt808", "subiao"],
  },
  { value: "concox_gprs", label: "Concox GPRS (0x80)", protocols: ["concox"] },
  { value: "ruptela_sms", label: "Ruptela SMS via GPRS (108)", protocols: ["ruptela"] },
  { value: "ruptela_105", label: "Ruptela config (105)", protocols: ["ruptela"] },
  { value: "ruptela_107", label: "Ruptela command (107)", protocols: ["ruptela"] },
  {
    value: "galileosky_text",
    label: "Galileosky text (GETVER / MainPack…)",
    protocols: ["galileosky"],
  },
  { value: "raw", label: "Raw bytes (hex in payload hex)" },
];

function commandTypesForProtocol(protocol: string) {
  return COMMAND_TYPE_OPTIONS.filter(
    (o) => !o.protocols || o.protocols.includes(protocol) || protocol === "",
  );
}

function commandPayloadPlaceholder(cmdType: string): { text: string; hex: string } {
  switch (cmdType) {
    case "jt808_8104":
      return { text: "all or 0001,0002", hex: "optional id list as hex" };
    case "jt808_8106":
      return { text: "0001,0002", hex: "N×DWORD param ids" };
    case "jt808_8108":
      return { text: "type=0,mfr=MFR01,ver=1.2.3", hex: "full 0x8108 body (pkg optional)" };
    case "jt808_8105":
      return { text: "reset / shutdown / factory", hex: "03 or multi-byte control" };
    case "jt808_8500":
      return { text: "cut / oil_cut", hex: "01 or multi-byte body" };
    case "jt808_8801":
      return { text: "1 or ch=1", hex: "12-byte 0x8801 body" };
    case "jt808_8802":
      return { text: "type=0,ch=1,event=0", hex: "15-byte 0x8802 body" };
    case "jt808_8803":
      return { text: "stop / start / type=0,ch=1,cmd=0", hex: "3-byte body" };
    case "jt808_8804":
      return { text: "start / stop / cmd=1,time=60,save=0,rate=0", hex: "5-byte body" };
    case "jt808_8805":
      return { text: "id=99", hex: "DWORD media id" };
    case "jt808_8900":
      return { text: "type=0,text=ping", hex: "type + content" };
    case "jt808_8202":
      return { text: "10,60 (interval,validity sec)", hex: "6-byte body" };
    case "jt808_8700":
      return { text: "collect / 0x00", hex: "cmd byte(+params)" };
    case "jt808_8702":
    case "jt808_8204":
      return { text: "(empty body)", hex: "" };
    case "jt808_8203":
      return { text: "sos / overspeed / all", hex: "DWORD alarm mask" };
    case "jt808_8600":
      return { text: "id=1,lat=-6.2,lon=106.8,r=500", hex: "full 0x8600 body" };
    case "jt808_8602":
      return { text: "id=1,lat1=-6.1,lon1=106.7,lat2=-6.3,lon2=106.9", hex: "full 0x8602 body" };
    case "jt808_8604":
      return { text: "id=1,pts=-6.1,106.7;-6.2,106.8;-6.1,106.9", hex: "full 0x8604 body" };
    case "jt808_8601":
      return { text: "all or 1,2,3 (or type=rect|poly,…)", hex: "count + DWORD ids" };
    case "jt808_8603":
    case "jt808_8605":
    case "jt808_8607":
      return { text: "all or 1,2,3", hex: "count + DWORD ids" };
    case "jt808_8606":
      return { text: "id=1,w=50,pts=-6.1,106.7;-6.2,106.8", hex: "full 0x8606 body" };
    case "jt808_8608":
      return { text: "1 / circle / rect / poly / route", hex: "type byte" };
    case "jt808_9101":
      return { text: "ch=1,ip=host,tcp=1078", hex: "full 0x9101 body" };
    case "jt808_9102":
      return { text: "ch=1,cmd=0", hex: "channel+cmd" };
    case "jt808_8301":
      return { text: "id=1,text=SOS or 1:SOS;2:Call", hex: "full 0x8301 body" };
    case "jt808_8302":
      return { text: "id=1,q=Over speed?", hex: "full 0x8302 body" };
    case "jt808_8303":
      return { text: "clear or type=1,items=1:News;2:Weather", hex: "full 0x8303 body" };
    case "jt808_8304":
      return { text: "type=1,text=Service notice", hex: "full 0x8304 body" };
    case "jt808_8400":
      return { text: "13800138000 or listen:138…", hex: "flag + phone digits" };
    case "jt808_8401":
      return { text: "clear or type=1,items=1:13800138000:Home", hex: "full 0x8401 body" };
    case "teltonika_codec13":
      return { text: "getinfo (unix ts auto)", hex: "" };
    case "teltonika_codec14":
      return { text: "getinfo (IMEI from session)", hex: "" };
    case "jt808_8103":
      return { text: "", hex: "TLV bytes (count auto-wrapped)" };
    case "raw":
      return { text: "", hex: "raw frame hex" };
    case "galileosky_text":
      return { text: "GETVER", hex: "" };
    default:
      return { text: "getinfo / cut / reset…", hex: "optional binary hex" };
  }
}

type TrackerProfileRow = {
  id: string;
  tenantId?: string | null;
  name: string;
  protocol: string;
  model: string;
  completeness: string;
  notes: string;
};

type TrackerParamDef = {
  id: string;
  tenantId?: string | null;
  category: string;
  label: string;
  valueType: string;
  unit?: string;
  description?: string;
  system?: boolean;
};

type TrackerProtocolParam = {
  protocol: string;
  vendorKey: string;
  label: string;
  valueType: string;
  description?: string;
};

type TrackerMapRule = {
  id: string;
  profileId?: string | null;
  deviceId?: string | null;
  vendorKey: string;
  appParamId: string;
  transform: string;
};

const FIELD_ROLE_OPTIONS = [
  { value: "operator", label: "Operator" },
  { value: "driver", label: "Driver" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "manager", label: "Manager" },
  { value: "worker1", label: "Worker 1" },
  { value: "worker2", label: "Worker 2" },
  { value: "field1", label: "Field 1" },
  { value: "field2", label: "Field 2" },
];

function emptyDraft(): Draft {
  return {
    key: "",
    appId: "36",
    displayName: "",
    token: "",
    webhookSecret: "",
    userIds: "",
    groupIds: "",
    notifyEmails: "",
    notifyWhatsapp: "",
    wablasBaseUrl: "https://wablas.com",
    wablasToken: "",
    wablasSecret: "",
    enabled: true,
    entitlements: defaultEntitlements(),
    dutyIntervalSec: "15",
    dutyQuietSec: "60",
    dutyMinMoveM: "25",
    telematicsSource: "both",
    fleetLiveDisplayPinsText: "",
  };
}

function draftFromTenant(t: AdminTenant): Draft {
  const entitlements = mergeEntitlements(t.entitlements);
  return {
    key: t.key,
    appId: String(t.appId),
    displayName: t.displayName || "",
    token: "",
    webhookSecret: "",
    userIds: t.userIds.join(", "),
    groupIds: t.groupIds.join(", "),
    notifyEmails: t.notifyEmails || "",
    notifyWhatsapp: t.notifyWhatsapp || "",
    wablasBaseUrl: t.wablasBaseUrl || "https://wablas.com",
    wablasToken: "",
    wablasSecret: "",
    enabled: t.enabled,
    entitlements,
    dutyIntervalSec: String(t.dutyLocation?.intervalSec ?? 15),
    dutyQuietSec: String(t.dutyLocation?.quietSec ?? 60),
    dutyMinMoveM: String(t.dutyLocation?.minMoveM ?? 25),
    telematicsSource: t.telematicsSource || "both",
    fleetLiveDisplayPinsText:
      entitlements.fleetLiveDisplayPins == null
        ? ""
        : entitlements.fleetLiveDisplayPins.join(", "),
  };
}

function parseIdList(text: string): number[] {
  return [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json", "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function ScanRoleMatrix({
  scan,
  onChange,
}: {
  scan: ScanEntitlements;
  onChange: (next: ScanEntitlements) => void;
}) {
  return (
    <fieldset className="admin-fieldset">
      <legend>Field scan by role</legend>
      <p className="admin-section-hint muted" title="Cargo/Part add, serial, camera, type, NFC on Field /m and Manager /mm. Later columns are stored for wider scenarios. Desk embed scan is not gated here.">
        Live Field/Manager scan inputs; later columns are stored only.
      </p>
      <div className="admin-toggle-grid">
        {SCAN_INPUT_KEYS.map((key) => {
          const on = scan.inputs[key] === true;
          const later = !SCAN_BUILT_INPUTS.includes(key);
          return (
            <label key={key} className={`admin-chip-toggle${on ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) =>
                  onChange({
                    ...scan,
                    inputs: { ...scan.inputs, [key]: e.target.checked },
                  })
                }
              />
              <span>
                {SCAN_INPUT_LABELS[key]}
                {later ? <em className="admin-scan-later"> later</em> : null}
              </span>
            </label>
          );
        })}
      </div>
      <div className="admin-scan-matrix-wrap">
        <table className="admin-scan-matrix">
          <thead>
            <tr>
              <th scope="col">Role</th>
              {SCAN_ACTION_KEYS.map((key) => (
                <th key={key} scope="col">
                  {SCAN_ACTION_LABELS[key]}
                  {!SCAN_BUILT_ACTIONS.includes(key) ? (
                    <span className="admin-scan-later">later</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCAN_ROLES.map((role) => (
              <tr key={role}>
                <th scope="row">{SCAN_ROLE_LABELS[role]}</th>
                {SCAN_ACTION_KEYS.map((action) => (
                  <td key={action}>
                    <input
                      type="checkbox"
                      checked={scan.roles[role][action] === true}
                      aria-label={`${SCAN_ROLE_LABELS[role]} ${SCAN_ACTION_LABELS[action]}`}
                      onChange={(e) =>
                        onChange({
                          ...scan,
                          roles: {
                            ...scan.roles,
                            [role]: { ...scan.roles[role], [action]: e.target.checked },
                          },
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}

function ToggleGrid({
  title,
  hint,
  labels,
  values,
  onChange,
}: {
  title: string;
  hint?: string;
  labels: Record<string, string>;
  values: Record<string, boolean>;
  onChange: (key: string, next: boolean) => void;
}) {
  return (
    <fieldset className="admin-fieldset">
      <legend>{title}</legend>
      {hint ? <p className="admin-section-hint muted">{hint}</p> : null}
      <div className="admin-toggle-grid">
        {Object.keys(labels).map((key) => {
          const on = values[key] === true;
          return (
            <label key={key} className={`admin-chip-toggle${on ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => onChange(key, e.target.checked)}
              />
              <span>{labels[key] || key}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`admin-pill${ok ? " is-ok" : " is-off"}`}>{label}</span>;
}

function AdminFold({
  title,
  hint,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={["admin-panel", "admin-fold", className].filter(Boolean).join(" ")}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="admin-fold-summary">
        <span>
          <strong>{title}</strong>
          {hint ? <span className="muted">{hint}</span> : null}
        </span>
      </summary>
      <div className="admin-fold-body">{children}</div>
    </details>
  );
}

export default function AdminConsole() {
  const [username, setUsername] = useState<string | null>(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [adminSection, setAdminSection] = useState<
    "settings" | "deviceMgmt" | "devices" | "live" | "terminal"
  >("settings");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tenantQuery, setTenantQuery] = useState("");
  const [fieldUsers, setFieldUsers] = useState<FieldUserRow[]>([]);
  const [fuUsername, setFuUsername] = useState("");
  const [fuPassword, setFuPassword] = useState("");
  const [fuRole, setFuRole] = useState("operator");
  const [fuDisplayName, setFuDisplayName] = useState("");
  const [fuPhone, setFuPhone] = useState("");
  const [fuEmail, setFuEmail] = useState("");
  const [fuPrivileges, setFuPrivileges] = useState<DeskPrivileges>(() => emptyDeskPrivileges());
  const [fuEdits, setFuEdits] = useState<Record<string, FieldUserEdit>>({});
  const [fuEditingId, setFuEditingId] = useState<string | null>(null);
  const [trackerDevices, setTrackerDevices] = useState<TrackerDeviceRow[]>([]);
  const [deviceFieldDefs, setDeviceFieldDefs] = useState<DeviceFieldDef[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<TrackerDeviceGroupRow[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editGroupMembers, setEditGroupMembers] = useState<string[]>([]);
  const [unassignedTrackers, setUnassignedTrackers] = useState<UnassignedTrackerRow[]>([]);
  const [trackerProfiles, setTrackerProfiles] = useState<TrackerProfileRow[]>([]);
  const [paramDefs, setParamDefs] = useState<TrackerParamDef[]>([]);
  const [mapRules, setMapRules] = useState<TrackerMapRule[]>([]);
  const [mapRulesExpanded, setMapRulesExpanded] = useState(false);
  const [dmProfileId, setDmProfileId] = useState("");
  const [dmVendorKey, setDmVendorKey] = useState("io.239");
  const [dmAppParam, setDmAppParam] = useState("ignition");
  const [dmTransform, setDmTransform] = useState("identity");
  const [dmTransformArg, setDmTransformArg] = useState("");
  const [dmMapDeviceId, setDmMapDeviceId] = useState("");
  const [protocolParams, setProtocolParams] = useState<TrackerProtocolParam[]>([]);
  const [cmdDeviceId, setCmdDeviceId] = useState("");
  const [cmdText, setCmdText] = useState("");
  const [cmdHex, setCmdHex] = useState("");
  const [cmdType, setCmdType] = useState("text");
  const [cmdHistory, setCmdHistory] = useState<
    Array<{
      id: string;
      status: string;
      commandType: string;
      payloadText?: string;
      payloadHex?: string;
      responseText?: string;
      corrId?: string;
      createdAt: string;
      sentAt?: string | null;
      completedAt?: string | null;
    }>
  >([]);
  const [gatewayStatus, setGatewayStatus] = useState<string>("");
  const [gatewayDetail, setGatewayDetail] = useState<string>("");
  const [onlineImeis, setOnlineImeis] = useState<Set<string>>(() => new Set());
  const [previewDeviceId, setPreviewDeviceId] = useState("");
  const [remapPreview, setRemapPreview] = useState<string>("");
  const [safetyEvents, setSafetyEvents] = useState<
    Array<{
      id: string;
      alarmType: string;
      alarmLevel: number;
      recordedAt: string;
      deviceId: string;
      sourceProtocol?: string;
    }>
  >([]);
  const [lastDeviceToken, setLastDeviceToken] = useState("");
  const [newParamId, setNewParamId] = useState("");
  const [newParamLabel, setNewParamLabel] = useState("");
  const [newParamCategory, setNewParamCategory] = useState("other");
  const [newParamValueType, setNewParamValueType] = useState("number");
  const [newParamUnit, setNewParamUnit] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileProtocol, setNewProfileProtocol] = useState("teltonika");
  const [terminalEvents, setTerminalEvents] = useState<
    Array<{
      kind?: string;
      eventId?: string;
      deviceId: string | null;
      imei: string;
      label: string;
      protocol: string;
      recordedAt: string;
      lat: number | null;
      lon: number | null;
      speed: number | null;
      heading?: number | null;
      ignition: boolean | null;
      remote?: string | null;
      rawAttrs: Record<string, unknown>;
      mappedAttrs: Record<string, unknown>;
    }>
  >([]);
  const [terminalDeviceId, setTerminalDeviceId] = useState("");
  const [terminalPaused, setTerminalPaused] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState<string | null>(null);
  const [liveParamRows, setLiveParamRows] = useState<
    Array<{
      deviceId: string;
      imei: string;
      label: string;
      protocol: string;
      paramId: string;
      paramLabel: string;
      category: string;
      value: string | number | boolean | null;
      source: string;
      updatedAt: string | null;
    }>
  >([]);
  const [liveDeviceId, setLiveDeviceId] = useState("");
  const [liveShowRaw, setLiveShowRaw] = useState(false);
  const [livePaused, setLivePaused] = useState(false);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<{ username: string }>("/api/admin/me");
      setUsername(me.username);
      return true;
    } catch {
      setUsername(null);
      return false;
    }
  }, []);

  const loadTenants = useCallback(async () => {
    const data = await api<{ tenants: AdminTenant[] }>("/api/admin/tenants");
    setTenants(data.tenants);
  }, []);

  const loadFieldUsers = useCallback(async (tenantId: string) => {
    const data = await api<{ users: FieldUserRow[] }>(`/api/admin/tenants/${tenantId}/field-users`);
    setFieldUsers(data.users);
    setFuEdits(Object.fromEntries(data.users.map((u) => [u.id, editFromRow(u)])));
  }, []);

  const loadTrackerDevices = useCallback(async (tenantId: string) => {
    const data = await api<{ devices: TrackerDeviceRow[] }>(
      `/api/admin/tenants/${tenantId}/tracker-devices`,
    );
    setTrackerDevices(data.devices);
  }, []);

  const loadDeviceFieldDefs = useCallback(async (tenantId: string) => {
    const data = await api<{ fields: DeviceFieldDef[] }>(
      `/api/admin/tenants/${tenantId}/tracker-device-fields`,
    );
    setDeviceFieldDefs(data.fields || []);
  }, []);

  const loadDeviceGroups = useCallback(async (tenantId: string) => {
    const data = await api<{ groups: TrackerDeviceGroupRow[] }>(
      `/api/admin/tenants/${tenantId}/tracker-device-groups?members=1`,
    );
    setDeviceGroups(data.groups || []);
    setEditGroupId((cur) => {
      if (cur && data.groups?.some((g) => g.id === cur)) return cur;
      return data.groups?.[0]?.id || "";
    });
  }, []);

  const loadUnassignedTrackers = useCallback(async () => {
    const data = await api<{ unassigned: UnassignedTrackerRow[] }>(
      `/api/admin/tracker-unassigned?limit=100`,
    );
    setUnassignedTrackers(data.unassigned);
  }, []);

  const loadDeviceManager = useCallback(async (tenantId: string) => {
    const [profiles, params] = await Promise.all([
      api<{ profiles: TrackerProfileRow[] }>(`/api/admin/tenants/${tenantId}/tracker-profiles`),
      api<{ params: TrackerParamDef[] }>(
        `/api/admin/tenants/${tenantId}/tracker-param-defs`,
      ),
    ]);
    setTrackerProfiles(profiles.profiles);
    setParamDefs(params.params);
    setDmProfileId((cur) => cur || profiles.profiles[0]?.id || "");
    if (params.params[0]?.id) {
      setDmAppParam((cur) =>
        params.params.some((p) => p.id === cur) ? cur : params.params[0].id,
      );
    }
  }, []);

  const loadTerminalEvents = useCallback(
    async (tenantId: string, deviceId = "") => {
      const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}&limit=50` : "?limit=50";
      const data = await api<{ events: typeof terminalEvents }>(
        `/api/admin/tenants/${tenantId}/tracker-terminal${q}`,
      );
      setTerminalEvents(data.events || []);
    },
    [],
  );

  const loadLiveParamValues = useCallback(
    async (tenantId: string, deviceId = "", includeRaw = false) => {
      const q = new URLSearchParams();
      if (deviceId) q.set("deviceId", deviceId);
      if (includeRaw) q.set("raw", "1");
      const qs = q.toString();
      const data = await api<{ rows: typeof liveParamRows }>(
        `/api/admin/tenants/${tenantId}/tracker-param-values${qs ? `?${qs}` : ""}`,
      );
      setLiveParamRows(data.rows || []);
    },
    [],
  );

  const loadProtocolParamsForProfile = useCallback(async (profileId: string) => {
    const profile = trackerProfiles.find((p) => p.id === profileId);
    if (!profile?.protocol) {
      setProtocolParams([]);
      return;
    }
    try {
      const data = await api<{ params: TrackerProtocolParam[] }>(
        `/api/admin/tracker-protocol-params?protocol=${encodeURIComponent(profile.protocol)}`,
      );
      setProtocolParams(data.params || []);
      if (data.params?.[0]?.vendorKey) {
        setDmVendorKey((cur) => {
          const stillValid = data.params.some((p) => p.vendorKey === cur);
          return stillValid ? cur : data.params[0].vendorKey;
        });
      }
    } catch {
      setProtocolParams([]);
    }
  }, [trackerProfiles]);

  const loadMapRules = useCallback(async (tenantId: string, profileId: string, deviceId = "") => {
    if (deviceId) {
      const data = await api<{ rules: TrackerMapRule[] }>(
        `/api/admin/tenants/${tenantId}/tracker-param-maps?deviceId=${encodeURIComponent(deviceId)}`,
      );
      setMapRules(data.rules);
      return;
    }
    if (!profileId) {
      setMapRules([]);
      return;
    }
    const data = await api<{ rules: TrackerMapRule[] }>(
      `/api/admin/tenants/${tenantId}/tracker-param-maps?profileId=${encodeURIComponent(profileId)}`,
    );
    setMapRules(data.rules);
  }, []);

  useEffect(() => {
    document.title = "Admin · ARMADA M.1";
    void refreshMe().then((ok) => {
      if (ok) void loadTenants().catch((err: Error) => setError(err.message));
    });
  }, [refreshMe, loadTenants]);

  useEffect(() => {
    if (!selectedId || selectedId === "new") {
      setFieldUsers([]);
      setFuEdits({});
      setFuEditingId(null);
      setTrackerDevices([]);
      setDeviceFieldDefs([]);
      setDeviceGroups([]);
      setEditGroupId("");
      setEditGroupMembers([]);
      setLastDeviceToken("");
      return;
    }
    void loadFieldUsers(selectedId).catch((err: Error) => setError(err.message));
    void loadTrackerDevices(selectedId).catch((err: Error) => setError(err.message));
    void loadDeviceFieldDefs(selectedId).catch((err: Error) => setError(err.message));
    void loadDeviceGroups(selectedId).catch((err: Error) => setError(err.message));
    void loadUnassignedTrackers().catch((err: Error) => setError(err.message));
    void loadDeviceManager(selectedId).catch((err: Error) => setError(err.message));
    void loadGatewayStatus();
    void (async () => {
      try {
        const data = await api<{
          events: Array<{
            id: string;
            alarmType: string;
            alarmLevel: number;
            recordedAt: string;
            deviceId: string;
            sourceProtocol?: string;
          }>;
        }>(`/api/admin/tenants/${selectedId}/tracker-safety-events?limit=30`);
        setSafetyEvents(data.events);
      } catch {
        setSafetyEvents([]);
      }
    })();
  }, [
    selectedId,
    loadFieldUsers,
    loadTrackerDevices,
    loadDeviceFieldDefs,
    loadDeviceGroups,
    loadUnassignedTrackers,
    loadDeviceManager,
  ]);

  useEffect(() => {
    const g = deviceGroups.find((x) => x.id === editGroupId);
    setEditGroupMembers(g?.deviceIds ? [...g.deviceIds] : []);
  }, [editGroupId, deviceGroups]);

  useEffect(() => {
    if (!selectedId || selectedId === "new") return;
    if (!dmMapDeviceId && !dmProfileId) return;
    setMapRulesExpanded(false);
    void loadMapRules(selectedId, dmProfileId, dmMapDeviceId).catch((err: Error) => setError(err.message));
    if (dmProfileId) void loadProtocolParamsForProfile(dmProfileId);
  }, [selectedId, dmProfileId, dmMapDeviceId, loadMapRules, loadProtocolParamsForProfile]);

  useEffect(() => {
    if (!selectedId || selectedId === "new" || adminSection !== "terminal" || terminalPaused) return;
    const tick = () => {
      void loadTerminalEvents(selectedId, terminalDeviceId).catch((err: Error) => setError(err.message));
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [
    selectedId,
    adminSection,
    terminalPaused,
    terminalDeviceId,
    loadTerminalEvents,
  ]);

  useEffect(() => {
    if (!selectedId || selectedId === "new" || adminSection !== "live" || livePaused) return;
    const tick = () => {
      void loadLiveParamValues(selectedId, liveDeviceId, liveShowRaw).catch((err: Error) =>
        setError(err.message),
      );
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [
    selectedId,
    adminSection,
    livePaused,
    liveDeviceId,
    liveShowRaw,
    loadLiveParamValues,
  ]);

  const filteredTenants = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        (t.displayName || "").toLowerCase().includes(q) ||
        String(t.appId).includes(q),
    );
  }, [tenants, tenantQuery]);

  const stats = useMemo(() => {
    const enabled = tenants.filter((t) => t.enabled).length;
    const withNotify = tenants.filter(
      (t) => (t.notifyEmails || "").trim() || (t.notifyWhatsapp || "").trim(),
    ).length;
    const withWablas = tenants.filter((t) => t.hasWablasToken && t.hasWablasSecret).length;
    return { total: tenants.length, enabled, withNotify, withWablas };
  }, [tenants]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      setLoginPass("");
      await refreshMe();
      await loadTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await api("/api/admin/logout", { method: "POST" });
      setUsername(null);
      setTenants([]);
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  function selectNew() {
    setSelectedId("new");
    setAdminSection("settings");
    setDraft(emptyDraft());
    setNotice("");
    setError("");
  }

  function selectTenant(t: AdminTenant) {
    setSelectedId(t.id);
    setAdminSection("settings");
    setDraft(draftFromTenant(t));
    setNotice("");
    setError("");
  }

  async function saveDraft() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fleetLiveDisplayPins = normalizeFleetLiveDisplayPins(
        parseDisplayPinIdsText(draft.fleetLiveDisplayPinsText),
      );
      const payload = {
        key: draft.key.trim(),
        appId: Number(draft.appId),
        displayName: draft.displayName.trim(),
        userIds: parseIdList(draft.userIds),
        groupIds: parseIdList(draft.groupIds),
        enabled: draft.enabled,
        entitlements: {
          ...draft.entitlements,
          fleetLiveDisplayPins,
        },
        notifyEmails: draft.notifyEmails.trim(),
        notifyWhatsapp: draft.notifyWhatsapp.trim(),
        wablasBaseUrl: draft.wablasBaseUrl.trim(),
        ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
        ...(draft.webhookSecret.trim() ? { webhookSecret: draft.webhookSecret.trim() } : {}),
        ...(draft.wablasToken.trim() ? { wablasToken: draft.wablasToken.trim() } : {}),
        ...(draft.wablasSecret.trim() ? { wablasSecret: draft.wablasSecret.trim() } : {}),
        dutyLocation: {
          intervalSec: Number(draft.dutyIntervalSec),
          quietSec: Number(draft.dutyQuietSec),
          minMoveM: Number(draft.dutyMinMoveM),
        },
        telematicsSource: draft.telematicsSource,
      };
      if (selectedId === "new") {
        if (!payload.token && draft.telematicsSource !== "devices") {
          throw new Error("Armada token is required (or set telematics to Direct devices only)");
        }
        const created = await api<{ tenant: AdminTenant }>("/api/admin/tenants", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            token: draft.token.trim(),
            webhookSecret: draft.webhookSecret.trim(),
            telematicsSource: draft.telematicsSource,
          }),
        });
        setNotice(`Created tenant ${created.tenant.key}`);
        await loadTenants();
        selectTenant(created.tenant);
      } else if (selectedId) {
        const updated = await api<{ tenant: AdminTenant }>(`/api/admin/tenants/${selectedId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice(`Saved ${updated.tenant.key}`);
        setDraft(draftFromTenant(updated.tenant));
        await loadTenants();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function disableTenant() {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      setNotice("Tenant disabled");
      await loadTenants();
      setDraft((d) => ({ ...d, enabled: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disable failed");
    } finally {
      setBusy(false);
    }
  }

  async function createFieldUser(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/admin/tenants/${selectedId}/field-users`, {
        method: "POST",
        body: JSON.stringify({
          username: fuUsername.trim(),
          password: fuPassword,
          role: fuRole,
          displayName: fuDisplayName.trim(),
          phone: fuPhone.trim(),
          email: fuEmail.trim(),
          privileges: fuPrivileges,
        }),
      });
      setFuUsername("");
      setFuPassword("");
      setFuDisplayName("");
      setFuPhone("");
      setFuEmail("");
      setFuRole("operator");
      setFuPrivileges(emptyDeskPrivileges());
      setNotice("Field user created");
      await loadFieldUsers(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create field user failed");
    } finally {
      setBusy(false);
    }
  }

  function updateFieldUserEdit(userId: string, patch: Partial<FieldUserEdit>) {
    setFuEdits((prev) => {
      const row = fieldUsers.find((u) => u.id === userId);
      const current =
        prev[userId] ||
        (row
          ? editFromRow(row)
          : {
              username: "",
              displayName: "",
              role: "operator",
              phone: "",
              email: "",
              password: "",
              privileges: emptyDeskPrivileges(),
            });
      return { ...prev, [userId]: { ...current, ...patch } };
    });
  }

  async function saveFieldUser(userId: string) {
    const edit = fuEdits[userId];
    if (!edit) return;
    const body: Record<string, unknown> = {
      username: edit.username.trim(),
      displayName: edit.displayName.trim(),
      role: edit.role,
      phone: edit.phone.trim(),
      email: edit.email.trim(),
      privileges: edit.privileges,
    };
    if (edit.password.trim()) body.password = edit.password;
    const ok = await patchFieldUser(userId, body);
    if (ok) setFuEditingId(null);
  }

  function startEditFieldUser(u: FieldUserRow) {
    setFuEdits((prev) => ({ ...prev, [u.id]: editFromRow(u) }));
    setFuEditingId(u.id);
  }

  async function patchFieldUser(userId: string, body: Record<string, unknown>): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/field-users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setNotice("Field user updated");
      await loadFieldUsers(selectedId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function deleteFieldUser(userId: string, uname: string) {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm(`Delete field user “${uname}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/field-users/${userId}`, { method: "DELETE" });
      setNotice("Field user deleted");
      setFuEditingId((id) => (id === userId ? null : id));
      await loadFieldUsers(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTrackerDeviceBody(body: Record<string, unknown>) {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    setLastDeviceToken("");
    try {
      const created = await api<{ device: TrackerDeviceRow }>(
        `/api/admin/tenants/${selectedId}/tracker-devices`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setNotice(`Registered device ${created.device.imei}`);
      if (created.device.authToken) setLastDeviceToken(created.device.authToken);
      await loadTrackerDevices(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create device");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function updateTrackerDeviceBody(deviceId: string, body: Record<string, unknown>) {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-devices/${deviceId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setNotice("Device saved");
      await loadTrackerDevices(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update device");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function createDeviceFieldDefBody(body: Record<string, unknown>) {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-device-fields`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNotice("Custom field added");
      await loadDeviceFieldDefs(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create field");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function deleteDeviceFieldDefBody(fieldId: string) {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm(`Delete custom field “${fieldId}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-device-fields/${fieldId}`, {
        method: "DELETE",
      });
      setNotice("Custom field deleted");
      await loadDeviceFieldDefs(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete field");
    } finally {
      setBusy(false);
    }
  }

  async function rotateDeviceToken(deviceId: string) {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<{ device: TrackerDeviceRow }>(
        `/api/admin/tenants/${selectedId}/tracker-devices/${deviceId}`,
        { method: "PATCH", body: JSON.stringify({ rotateAuthToken: true }) },
      );
      if (updated.device.authToken) setLastDeviceToken(updated.device.authToken);
      setNotice("Device token rotated — copy it now");
      await loadTrackerDevices(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotate failed");
    } finally {
      setBusy(false);
    }
  }

  async function createDeviceGroup(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || selectedId === "new" || !newGroupName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api<{ group: TrackerDeviceGroupRow }>(
        `/api/admin/tenants/${selectedId}/tracker-device-groups`,
        {
          method: "POST",
          body: JSON.stringify({
            name: newGroupName.trim(),
            description: newGroupDesc.trim(),
          }),
        },
      );
      setNewGroupName("");
      setNewGroupDesc("");
      setEditGroupId(created.group.id);
      await loadDeviceGroups(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveGroupMembers() {
    if (!selectedId || selectedId === "new" || !editGroupId) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-device-groups/${editGroupId}/members`, {
        method: "PUT",
        body: JSON.stringify({ deviceIds: editGroupMembers }),
      });
      await loadDeviceGroups(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeDeviceGroup(groupId: string, name: string) {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm(`Delete group “${name}”? Devices are kept.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-device-groups/${groupId}`, {
        method: "DELETE",
      });
      await loadDeviceGroups(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTrackerDevice(deviceId: string, imei: string) {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm(`Delete tracker “${imei}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-devices/${deviceId}`, { method: "DELETE" });
      setNotice("Tracker device deleted");
      await loadTrackerDevices(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function claimUnassignedTracker(row: UnassignedTrackerRow) {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    setLastDeviceToken("");
    try {
      const created = await api<{ device: TrackerDeviceRow }>(
        `/api/admin/tenants/${selectedId}/tracker-devices/claim-unassigned`,
        {
          method: "POST",
          body: JSON.stringify({
            imei: row.imei,
            protocol: row.protocol,
            label: "",
          }),
        },
      );
      setNotice(`Claimed ${created.device.imei} into this tenant`);
      if (created.device.authToken) setLastDeviceToken(created.device.authToken);
      await Promise.all([loadTrackerDevices(selectedId), loadUnassignedTrackers()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  async function addAppParam(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ param: TrackerParamDef }>(
        `/api/admin/tenants/${selectedId}/tracker-param-defs`,
        {
          method: "POST",
          body: JSON.stringify({
            id: newParamId.trim(),
            label: newParamLabel.trim() || newParamId.trim(),
            category: newParamCategory,
            valueType: newParamValueType,
            unit: newParamUnit.trim(),
          }),
        },
      );
      setNotice(`App param added: ${data.param.id}`);
      setNewParamId("");
      setNewParamLabel("");
      setNewParamUnit("");
      setDmAppParam(data.param.id);
      await loadDeviceManager(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add param failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeAppParam(paramId: string) {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm(`Delete custom param "${paramId}" and its remap rules?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/admin/tenants/${selectedId}/tracker-param-defs/${encodeURIComponent(paramId)}`,
        { method: "DELETE" },
      );
      setNotice(`Deleted param ${paramId}`);
      await loadDeviceManager(selectedId);
      await loadMapRules(selectedId, dmProfileId, dmMapDeviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete param failed");
    } finally {
      setBusy(false);
    }
  }

  async function addTrackerProfile(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ profile: TrackerProfileRow }>(
        `/api/admin/tenants/${selectedId}/tracker-profiles`,
        {
          method: "POST",
          body: JSON.stringify({
            name: newProfileName.trim(),
            protocol: newProfileProtocol,
            completeness: "mvp",
          }),
        },
      );
      setNotice(`Profile created: ${data.profile.name}`);
      setNewProfileName("");
      setDmProfileId(data.profile.id);
      await loadDeviceManager(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create profile failed");
    } finally {
      setBusy(false);
    }
  }

  async function cloneTrackerProfile(sourceId: string) {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    setError("");
    try {
      const src = trackerProfiles.find((p) => p.id === sourceId);
      const data = await api<{ profile: TrackerProfileRow }>(
        `/api/admin/tenants/${selectedId}/tracker-profiles/${sourceId}/clone`,
        {
          method: "POST",
          body: JSON.stringify({ name: src ? `${src.name} (copy)` : undefined }),
        },
      );
      setNotice(`Cloned profile → ${data.profile.name}`);
      setDmProfileId(data.profile.id);
      await loadDeviceManager(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone profile failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeTrackerProfile(profileId: string) {
    if (!selectedId || selectedId === "new") return;
    const p = trackerProfiles.find((x) => x.id === profileId);
    if (!p?.tenantId) {
      setError("System profiles cannot be deleted");
      return;
    }
    if (!window.confirm(`Delete profile "${p.name}" and its remap rules?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-profiles/${profileId}`, {
        method: "DELETE",
      });
      setNotice(`Deleted profile ${p.name}`);
      setDmProfileId("");
      await loadDeviceManager(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete profile failed");
    } finally {
      setBusy(false);
    }
  }

  async function addMapRule(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || selectedId === "new") return;
    if (!dmMapDeviceId && !dmProfileId) return;
    setBusy(true);
    setError("");
    let transformArg: Record<string, unknown> = {};
    if (dmTransformArg.trim()) {
      try {
        const parsed = JSON.parse(dmTransformArg) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("transform arg must be a JSON object");
        }
        transformArg = parsed as Record<string, unknown>;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid transform arg JSON");
        setBusy(false);
        return;
      }
    } else if (dmTransform === "scale") {
      transformArg = { scale: 1 };
    } else if (dmTransform === "offset") {
      transformArg = { offset: 0 };
    } else if (dmTransform === "bit_mask") {
      transformArg = { mask: 1 };
    }
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-param-maps`, {
        method: "POST",
        body: JSON.stringify({
          ...(dmMapDeviceId
            ? { deviceId: dmMapDeviceId }
            : { profileId: dmProfileId }),
          vendorKey: dmVendorKey.trim(),
          appParamId: dmAppParam,
          transform: dmTransform,
          transformArg,
        }),
      });
      setNotice(
        dmMapDeviceId
          ? `Device override ${dmVendorKey} → ${dmAppParam}`
          : `Mapped ${dmVendorKey} → ${dmAppParam} (${dmTransform})`,
      );
      await loadMapRules(selectedId, dmProfileId, dmMapDeviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Map rule failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeMapRule(ruleId: string) {
    if (!selectedId || selectedId === "new") return;
    if (!window.confirm("Delete this remap rule?")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tenants/${selectedId}/tracker-param-maps/${ruleId}`, {
        method: "DELETE",
      });
      setNotice("Remap rule deleted");
      await loadMapRules(selectedId, dmProfileId, dmMapDeviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPendingCommand(commandId: string) {
    if (!selectedId || selectedId === "new" || !cmdDeviceId) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/admin/tenants/${selectedId}/tracker-devices/${cmdDeviceId}/commands/${commandId}`,
        { method: "DELETE" },
      );
      setNotice("Command cancelled");
      await loadCommandHistory(cmdDeviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadRemapPreview(deviceId = previewDeviceId) {
    if (!selectedId || selectedId === "new" || !deviceId) {
      setRemapPreview("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{
        last: {
          lat?: number;
          lon?: number;
          recordedAt?: string;
          sourceProtocol?: string;
          rawAttrs: Record<string, unknown>;
          mappedAttrs: Record<string, unknown>;
        } | null;
        preview: { mapped: Record<string, unknown>; rulesApplied: number };
      }>(`/api/admin/tenants/${selectedId}/tracker-devices/${deviceId}/remap-preview`);
      if (!data.last) {
        setRemapPreview("No last fix stored for this device yet.");
        return;
      }
      const head = [
        data.last.sourceProtocol || "?",
        data.last.lat != null && data.last.lon != null
          ? `${Number(data.last.lat).toFixed(5)}, ${Number(data.last.lon).toFixed(5)}`
          : "no coords",
        data.last.recordedAt ? new Date(data.last.recordedAt).toLocaleString() : "",
      ]
        .filter(Boolean)
        .join(" · ");
      setRemapPreview(
        `${head}\n` +
          JSON.stringify(
            {
              storedMapped: data.last.mappedAttrs || {},
              previewMapped: data.preview.mapped,
              rulesApplied: data.preview.rulesApplied,
              rawSample: data.last.rawAttrs || null,
            },
            null,
            2,
          ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadSafetyEventsForTenant() {
    if (!selectedId || selectedId === "new") return;
    try {
      const data = await api<{
        events: Array<{
          id: string;
          alarmType: string;
          alarmLevel: number;
          recordedAt: string;
          deviceId: string;
          sourceProtocol?: string;
        }>;
      }>(`/api/admin/tenants/${selectedId}/tracker-safety-events?limit=30`);
      setSafetyEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Safety events failed");
    }
  }

  async function loadGatewayStatus() {
    try {
      const data = await api<{
        ok: boolean;
        base?: string;
        error?: string;
        health?: {
          onlineCount?: number;
          connectionsOpen?: number;
          fixesIngested?: number;
          decodeErrors?: number;
          ingestErrors?: number;
          unknownImei?: number;
          unknownImeiDropped?: number;
          commandsSent?: number;
          commandsAcked?: number;
          commandsFailed?: number;
          uptimeSec?: number;
          commandsByStatus?: Record<string, number>;
        };
        adapters?: {
          onlineCount?: number;
          onlineByProto?: Record<string, number>;
          onlineSessions?: Array<{ imei?: string; deviceId?: string; protocol?: string }>;
          adapters?: Array<{
            name: string;
            status: string;
            displayName?: string;
            defaultAddr?: string;
          }>;
        };
      }>("/api/admin/tracker-gateway/status");
      if (!data.ok) {
        setOnlineImeis(new Set());
        setGatewayDetail("");
        const why = data.error || "unreachable";
        setGatewayStatus(
          `Gateway offline (${data.base || "?"}): ${why}. Start tracker-gateway on that host (deploy/tracker-gateway.service) or set TRACKER_GATEWAY_URL.`,
        );
        return;
      }
      const online = data.adapters?.onlineCount ?? data.health?.onlineCount ?? 0;
      const byProto = data.adapters?.onlineByProto
        ? Object.entries(data.adapters.onlineByProto)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ")
        : "";
      const catalog = (data.adapters?.adapters || [])
        .map((a) => `${a.name}=${a.status}${a.defaultAddr ? `@${a.defaultAddr}` : ""}`)
        .join(", ");
      const imeis = new Set<string>();
      for (const s of data.adapters?.onlineSessions || []) {
        if (s.imei) imeis.add(String(s.imei));
      }
      setOnlineImeis(imeis);
      const cmds = data.health?.commandsByStatus || {};
      const cmdLine = ["pending", "sent", "acked", "failed", "expired"]
        .filter((k) => cmds[k] != null)
        .map((k) => `${k}=${cmds[k]}`)
        .join(" ");
      const unknown =
        data.health?.unknownImei != null || data.health?.unknownImeiDropped != null
          ? ` · unknown_imei=${data.health?.unknownImei ?? 0}/${data.health?.unknownImeiDropped ?? 0}`
          : "";
      setGatewayStatus(
        `Online sessions: ${online}${byProto ? ` (${byProto})` : ""} · fixes=${data.health?.fixesIngested ?? "—"} · decode_err=${data.health?.decodeErrors ?? 0}${unknown} · ${catalog || "no adapters"}`,
      );
      setGatewayDetail(
        [
          cmdLine ? `Commands (7d): ${cmdLine}` : "",
          `lifetime sent/ack/fail=${data.health?.commandsSent ?? 0}/${data.health?.commandsAcked ?? 0}/${data.health?.commandsFailed ?? 0}`,
          data.health?.uptimeSec != null ? `uptime ${Math.floor(data.health.uptimeSec / 60)}m` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (err) {
      setOnlineImeis(new Set());
      setGatewayDetail("");
      setGatewayStatus(err instanceof Error ? err.message : "Gateway status failed");
    }
  }

  async function loadCommandHistory(deviceId: string) {
    if (!selectedId || selectedId === "new" || !deviceId) {
      setCmdHistory([]);
      return;
    }
    try {
      const data = await api<{
        commands: Array<{
          id: string;
          status: string;
          commandType: string;
          payloadText?: string;
          payloadHex?: string;
          responseText?: string;
          corrId?: string;
          createdAt: string;
          sentAt?: string | null;
          completedAt?: string | null;
        }>;
      }>(`/api/admin/tenants/${selectedId}/tracker-devices/${deviceId}/commands`);
      setCmdHistory(data.commands || []);
    } catch {
      setCmdHistory([]);
    }
  }

  async function sendDeviceCommand(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || selectedId === "new" || !cmdDeviceId) return;
    setBusy(true);
    setError("");
    try {
      const hex = cmdHex.replace(/[^0-9a-fA-F]/g, "");
      if (hex.length % 2 === 1) {
        setError("Payload hex must have an even number of digits");
        setBusy(false);
        return;
      }
      await api(`/api/admin/tenants/${selectedId}/tracker-devices/${cmdDeviceId}/commands`, {
        method: "POST",
        body: JSON.stringify({
          commandType: cmdType,
          payloadText: cmdText.trim(),
          payloadHex: hex,
        }),
      });
      setNotice("Command queued — device receives it on next online session");
      setCmdText("");
      setCmdHex("");
      await loadCommandHistory(cmdDeviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed");
    } finally {
      setBusy(false);
    }
  }

  async function dismissUnassignedTracker(imei: string) {
    if (!window.confirm(`Dismiss unknown IMEI “${imei}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/tracker-unassigned/${encodeURIComponent(imei)}`, {
        method: "DELETE",
      });
      setNotice(`Dismissed ${imei}`);
      await loadUnassignedTrackers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dismiss failed");
    } finally {
      setBusy(false);
    }
  }

  if (!username) {
    return (
      <div className="admin-app admin-app-login">
        <div className="admin-login-shell auth-login-shell">
          <div className="admin-login-brand auth-login-brand">
            <div className="auth-login-brand-top">
              <BrandMark size={28} />
              <p className="admin-kicker">ARMADA M.1</p>
            </div>
            <div className="auth-login-brand-copy">
              <h1>Control plane</h1>
              <p className="muted">
                Tenants, Armada tokens, entitlements, and notify channels — one place to run the
                embed.
              </p>
            </div>
            <ul className="auth-login-points" aria-hidden="true">
              <li>Tenant keys &amp; tokens</li>
              <li>Module entitlements</li>
              <li>Notify / WhatsApp channels</li>
            </ul>
          </div>
          <form className="admin-login auth-login-form" onSubmit={(e) => void handleLogin(e)}>
            <header className="auth-login-form-head">
              <h2>Sign in</h2>
              <p className="muted">Admin access for this ARMADA M.1 server</p>
            </header>
            {error && <p className="admin-error">{error}</p>}
            <label>
              Username
              <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoComplete="username" />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="btn btn-primary auth-login-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const selected = tenants.find((t) => t.id === selectedId);

  const adminInitials = username
    .split(/[@.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "A";

  return (
    <div className="admin-app">
      <header className="admin-topbar">
        <div className="admin-brand">
          <BrandMark size={22} />
          <div>
            <h1>Armada M.1 Admin</h1>
            <p className="admin-kicker">Fleet ops control</p>
          </div>
        </div>
        <div className="admin-topbar-live" aria-live="polite">
          <i aria-hidden />
          Live · {stats.enabled} tenant{stats.enabled === 1 ? "" : "s"} active
        </div>
        <div className="admin-topbar-meta">
          <span className="admin-user-chip">
            <span className="admin-user-avatar" aria-hidden>
              {adminInitials}
            </span>
            {username}
          </span>
          <button type="button" className="admin-signout" onClick={() => void handleLogout()} disabled={busy}>
            Sign out
          </button>
        </div>
      </header>

      <section className="admin-stats" aria-label="Tenant overview">
        <div className="admin-stat">
          <span className="admin-stat-label">Tenants</span>
          <strong>{stats.total}</strong>
          <em>total configured</em>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Enabled</span>
          <strong>{stats.enabled}</strong>
          <em>
            {stats.total ? Math.round((stats.enabled / stats.total) * 100) : 0}% operational
          </em>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Notify set</span>
          <strong>{stats.withNotify}</strong>
          <em>email or WhatsApp</em>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Wablas ready</span>
          <strong>{stats.withWablas}</strong>
          <em>token + secret</em>
        </div>
      </section>

      {(error || notice) && (
        <div className="admin-banner">
          {error && <p className="admin-error">{error}</p>}
          {notice && <p className="admin-notice">{notice}</p>}
        </div>
      )}

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-head">
            <h2>
              Tenants <span className="admin-count-badge">{filteredTenants.length}</span>
            </h2>
          </div>
          <div className="admin-sidebar-tools">
            <label className="admin-search">
              <span className="visually-hidden">Search tenants</span>
              <input
                value={tenantQuery}
                onChange={(e) => setTenantQuery(e.target.value)}
                placeholder="Search key, name, app…"
              />
            </label>
            <button type="button" className="btn btn-primary admin-new-btn" onClick={selectNew}>
              + New
            </button>
          </div>
          <ul className="admin-tenant-list">
            {filteredTenants.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={selectedId === t.id ? "active" : ""}
                  onClick={() => selectTenant(t)}
                >
                  <span className="admin-tenant-row">
                    <strong>{t.displayName || t.key}</strong>
                    <span className="admin-tenant-chevron" aria-hidden>
                      ›
                    </span>
                  </span>
                  <span className="admin-tenant-meta">
                    <span className={`admin-dot${t.enabled ? " is-on" : ""}`} title={t.enabled ? "Enabled" : "Disabled"} />
                    <code>{t.key}</code> · app {t.appId}
                  </span>
                </button>
              </li>
            ))}
            {filteredTenants.length === 0 && (
              <li className="muted admin-empty">{tenants.length ? "No match." : "No database tenants yet."}</li>
            )}
          </ul>
          <p className="admin-sidebar-foot muted">
            Embed key format: opaque tenant key in <code>?k=</code>
          </p>
        </aside>

        <main className="admin-main">
          {selectedId ? (
            <>
              <div className="admin-main-head">
                <div>
                  <p className="admin-kicker">
                    {selectedId === "new" ? "Create tenant" : "Edit tenant"}
                    {selectedId !== "new" ? (
                      <>
                        {" "}
                        / <strong>{draft.displayName || draft.key}</strong>
                      </>
                    ) : null}
                  </p>
                  <h2>{selectedId === "new" ? "New tenant" : draft.displayName || draft.key}</h2>
                  {selected ? (
                    <div className="admin-status-row">
                      <StatusPill ok={selected.enabled} label={selected.enabled ? "Enabled" : "Disabled"} />
                      <StatusPill ok={selected.hasToken} label={selected.hasToken ? "Token set" : "No token"} />
                      <StatusPill
                        ok={selected.hasWebhookSecret}
                        label={selected.hasWebhookSecret ? "Webhook set" : "No webhook"}
                      />
                      <StatusPill
                        ok={Boolean(selected.hasWablasToken && selected.hasWablasSecret)}
                        label={
                          selected.hasWablasToken && selected.hasWablasSecret ? "Wablas set" : "No Wablas"
                        }
                      />
                    </div>
                  ) : null}
                </div>
                <div className="admin-main-head-actions">
                  {selectedId !== "new" ? (
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => void disableTenant()}>
                      Disable
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveDraft()}>
                    ✓ Save tenant
                  </button>
                </div>
              </div>

              {selectedId !== "new" ? (
                <nav className="admin-section-tabs" aria-label="Tenant sections">
                  {(
                    [
                      ["settings", "Settings"],
                      ["deviceMgmt", "Device Management"],
                      ["devices", "Device Manager"],
                      ["live", "Live values"],
                      ["terminal", "Terminal"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={adminSection === id ? "active" : ""}
                      onClick={() => setAdminSection(id)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              ) : null}

              {(selectedId === "new" || adminSection === "settings") && (
              <>
              <div className="admin-main-cols">
              <div className="admin-col">
              <section className="admin-panel">
                <header className="admin-panel-head admin-identity-head">
                  <h3>Identity</h3>
                  <label className={`admin-switch${draft.enabled ? " is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    />
                    <span>{draft.enabled ? "Enabled" : "Disabled"}</span>
                  </label>
                </header>
                <div className="admin-form-grid">
                  <label>
                    Embed key (k=)
                    <input
                      value={draft.key}
                      onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                      disabled={selectedId !== "new"}
                    />
                  </label>
                  <label>
                    App ID{draft.telematicsSource === "devices" ? " (placeholder OK)" : ""}
                    <input
                      value={draft.appId}
                      onChange={(e) => setDraft({ ...draft, appId: e.target.value })}
                      inputMode="numeric"
                    />
                  </label>
                  <label className="span-2">
                    Display name
                    <input
                      value={draft.displayName}
                      onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                    />
                  </label>
                </div>
              </section>

              <section className="admin-panel">
                <header className="admin-panel-head">
                  <h3>Field GPS</h3>
                  <p className="muted">Default 15s · 60s · 25 m</p>
                </header>
                <div className="admin-form-grid admin-gps-grid">
                  <label>
                    Moving interval (seconds)
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={draft.dutyIntervalSec}
                      onChange={(e) => setDraft({ ...draft, dutyIntervalSec: e.target.value })}
                    />
                  </label>
                  <label>
                    Parked heartbeat (seconds)
                    <input
                      type="number"
                      min={5}
                      max={600}
                      value={draft.dutyQuietSec}
                      onChange={(e) => setDraft({ ...draft, dutyQuietSec: e.target.value })}
                    />
                  </label>
                  <label>
                    Minimum move (metres)
                    <input
                      type="number"
                      min={5}
                      max={200}
                      value={draft.dutyMinMoveM}
                      onChange={(e) => setDraft({ ...draft, dutyMinMoveM: e.target.value })}
                    />
                  </label>
                  <label className="span-2">
                    Vehicle telematics source
                    <select
                      value={draft.telematicsSource}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          telematicsSource: e.target.value as Draft["telematicsSource"],
                        })
                      }
                    >
                      <option value="both">Both Armada + direct devices</option>
                      <option value="armada">Armada only</option>
                      <option value="devices">Direct devices only</option>
                    </select>
                  </label>
                  <div className="span-2 admin-pin-field">
                    <span className="admin-pin-field-label">Fleet Live display pins</span>
                    {selectedId && selectedId !== "new" && paramDefs.length ? (
                      <div className="admin-pin-checks" role="group" aria-label="Mapper pin picker">
                        {paramDefs.map((p) => {
                          const on = effectiveDisplayPinIds(draft.fleetLiveDisplayPinsText).includes(
                            p.id,
                          );
                          return (
                            <label
                              key={p.id}
                              className={`admin-chip-toggle${on ? " is-on" : ""}`}
                              title={p.id}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() =>
                                  setDraft({
                                    ...draft,
                                    fleetLiveDisplayPinsText: toggleDisplayPinIdText(
                                      draft.fleetLiveDisplayPinsText,
                                      p.id,
                                    ),
                                  })
                                }
                              />
                              <span>{p.label || p.id}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="admin-pin-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            fleetLiveDisplayPinsText: "",
                          })
                        }
                      >
                        Use defaults
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            fleetLiveDisplayPinsText: FLEET_DISPLAY_PIN_IDS.join(", "),
                          })
                        }
                      >
                        Seed defaults
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={draft.fleetLiveDisplayPinsText}
                      placeholder={FLEET_DISPLAY_PIN_IDS.join(", ")}
                      onChange={(e) =>
                        setDraft({ ...draft, fleetLiveDisplayPinsText: e.target.value })
                      }
                    />
                    <span className="muted">
                      {draft.fleetLiveDisplayPinsText.trim()
                        ? "Custom pin list for Dashboard / Live selection."
                        : `Using defaults (${FLEET_DISPLAY_PIN_IDS.join(", ")}). Toggle chips or edit the list to customize.`}
                    </span>
                  </div>
                </div>
              </section>

              <AdminFold
                key={`${selectedId}-access`}
                title="Access & secrets"
                hint="Token, webhook, and fleet scope"
                defaultOpen
              >
                <div className="admin-form-grid">
                  <label>
                    Armada token{" "}
                    {selectedId !== "new"
                      ? "(leave blank to keep)"
                      : draft.telematicsSource === "devices"
                        ? "(optional for devices-only)"
                        : ""}
                    <input
                      type="password"
                      value={draft.token}
                      onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                      autoComplete="off"
                      placeholder={selected?.hasToken ? "•••••••• (set)" : ""}
                    />
                  </label>
                  <label>
                    Webhook secret {selectedId !== "new" ? "(leave blank to keep)" : ""}
                    <input
                      type="password"
                      value={draft.webhookSecret}
                      onChange={(e) => setDraft({ ...draft, webhookSecret: e.target.value })}
                      autoComplete="off"
                      placeholder={selected?.hasWebhookSecret ? "•••••••• (set)" : ""}
                    />
                  </label>
                  <label>
                    Allowed user IDs
                    <input
                      value={draft.userIds}
                      onChange={(e) => setDraft({ ...draft, userIds: e.target.value })}
                      placeholder="empty = all"
                    />
                  </label>
                  <label>
                    Allowed group IDs
                    <input
                      value={draft.groupIds}
                      onChange={(e) => setDraft({ ...draft, groupIds: e.target.value })}
                      placeholder="empty = all"
                    />
                  </label>
                </div>
              </AdminFold>
              </div>

              <div className="admin-col">
              <AdminFold title="Notifications" hint="Reminder emails, WhatsApp, and Wablas">
                <div className="admin-form-grid">
                  <label>
                    Notify emails
                    <input
                      value={draft.notifyEmails}
                      onChange={(e) => setDraft({ ...draft, notifyEmails: e.target.value })}
                      placeholder="ops@company.com, manager@…"
                    />
                  </label>
                  <label>
                    Notify WhatsApp
                    <input
                      value={draft.notifyWhatsapp}
                      onChange={(e) => setDraft({ ...draft, notifyWhatsapp: e.target.value })}
                      placeholder="62812…, 62813…"
                    />
                  </label>
                  <label className="span-2">
                    Wablas API base URL
                    <input
                      value={draft.wablasBaseUrl}
                      onChange={(e) => setDraft({ ...draft, wablasBaseUrl: e.target.value })}
                      placeholder="https://wablas.com or https://pati.wablas.com"
                    />
                  </label>
                  <label>
                    Wablas token {selectedId !== "new" ? "(leave blank to keep)" : ""}
                    <input
                      type="password"
                      value={draft.wablasToken}
                      onChange={(e) => setDraft({ ...draft, wablasToken: e.target.value })}
                      autoComplete="off"
                      placeholder={selected?.hasWablasToken ? "•••••••• (set)" : ""}
                    />
                  </label>
                  <label>
                    Wablas secret {selectedId !== "new" ? "(leave blank to keep)" : ""}
                    <input
                      type="password"
                      value={draft.wablasSecret}
                      onChange={(e) => setDraft({ ...draft, wablasSecret: e.target.value })}
                      autoComplete="off"
                      placeholder={selected?.hasWablasSecret ? "•••••••• (set)" : ""}
                    />
                  </label>
                  <p
                    className="span-2 admin-section-hint muted"
                    title="Ops due/overdue only. Job assignment goes to the assigned field user’s phone/email."
                  >
                    Ops due/overdue · assignment to field user phone/email
                  </p>
                </div>
              </AdminFold>

              {selected && (
                <AdminFold title="Armada Command notifiers" hint="Custom Server URLs">
                  <div className="admin-notifier-list">
                    <div className="admin-notifier-row">
                      <div>
                        <span className="admin-stat-label">Exception</span>
                        <code>{selected.notifierUrlTemplate}</code>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          void copyText(selected.notifierUrlTemplate).then(() =>
                            setNotice("Exception notifier URL copied"),
                          )
                        }
                      >
                        Copy
                      </button>
                    </div>
                    {selected.notifierUrlMaintenance && (
                      <div className="admin-notifier-row">
                        <div>
                          <span className="admin-stat-label">Maintenance</span>
                          <code>{selected.notifierUrlMaintenance}</code>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            void copyText(selected.notifierUrlMaintenance || "").then(() =>
                              setNotice("Maintenance notifier URL copied"),
                            )
                          }
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                </AdminFold>
              )}
              </div>
              </div>

              <AdminFold
                key={`${selectedId}-entitlements`}
                title="Entitlements"
                hint="Embed tabs, features, mobile apps, and Field scan by role"
                defaultOpen
                className="admin-entitlements-wide"
              >
                <ToggleGrid
                  title="Modules"
                  hint="Visible tabs in the embed"
                  labels={MODULE_LABELS}
                  values={draft.entitlements.modules}
                  onChange={(key, next) =>
                    setDraft({
                      ...draft,
                      entitlements: {
                        ...draft.entitlements,
                        modules: { ...draft.entitlements.modules, [key]: next },
                      },
                    })
                  }
                />
                <ToggleGrid
                  title="Features"
                  labels={FEATURE_LABELS}
                  values={draft.entitlements.features}
                  onChange={(key, next) =>
                    setDraft({
                      ...draft,
                      entitlements: {
                        ...draft.entitlements,
                        features: { ...draft.entitlements.features, [key]: next },
                      },
                    })
                  }
                />
                <ToggleGrid
                  title="Mobile apps"
                  labels={{
                    maintenance: "Field Maintenance PWA (/m)",
                    managerMaintenance: "Manager Maintenance PWA (/mm)",
                    dispatch: "Dispatch PWA",
                  }}
                  values={draft.entitlements.mobile}
                  onChange={(key, next) =>
                    setDraft({
                      ...draft,
                      entitlements: {
                        ...draft.entitlements,
                        mobile: { ...draft.entitlements.mobile, [key]: next },
                      },
                    })
                  }
                />
                <ScanRoleMatrix
                  scan={draft.entitlements.scan}
                  onChange={(scan) =>
                    setDraft({
                      ...draft,
                      entitlements: { ...draft.entitlements, scan },
                    })
                  }
                />
              </AdminFold>

              {selectedId !== "new" && (
                <section className="admin-panel admin-field-users">
                  <header className="admin-panel-head">
                    <h3>
                      Field users <span className="admin-count-badge">{fieldUsers.length}</span>
                    </h3>
                    <p className="muted">
                      Sign-in at <code>/m</code> · {fieldUsers.length} user
                      {fieldUsers.length === 1 ? "" : "s"}
                    </p>
                  </header>
                  <ul className="admin-field-list">
                    {fieldUsers.map((u) => {
                      const editing = fuEditingId === u.id;
                      const edit = fuEdits[u.id] || editFromRow(u);
                      const initials = (u.displayName || u.username)
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase() || "")
                        .join("");
                      return (
                        <li key={u.id} className={editing ? "is-editing" : undefined}>
                          <div className="admin-field-summary">
                            <div className="admin-field-identity">
                              <span className="admin-field-avatar" aria-hidden>
                                {initials || "?"}
                              </span>
                              <div className="admin-field-identity-text">
                                <strong>{u.displayName || u.username}</strong>
                                <div className="admin-field-tags">
                                  <span className="admin-pill is-muted">{u.role}</span>
                                  {!u.enabled ? <span className="admin-pill is-off">disabled</span> : null}
                                </div>
                                <span className="muted">
                                  {[u.username, u.phone, u.email].filter(Boolean).join(" · ") || "No contact set"}
                                </span>
                              </div>
                            </div>
                            <div className="admin-field-row-actions">
                              {editing ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={busy}
                                  onClick={() => setFuEditingId(null)}
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={busy}
                                  onClick={() => startEditFieldUser(u)}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                          {editing ? (
                            <form
                              className="admin-form-grid"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void saveFieldUser(u.id);
                              }}
                            >
                              <label>
                                Username
                                <input
                                  value={edit.username}
                                  onChange={(e) => updateFieldUserEdit(u.id, { username: e.target.value })}
                                  required
                                  disabled={busy}
                                />
                              </label>
                              <label>
                                New password
                                <input
                                  type="password"
                                  value={edit.password}
                                  onChange={(e) => updateFieldUserEdit(u.id, { password: e.target.value })}
                                  placeholder="Leave blank to keep"
                                  minLength={6}
                                  autoComplete="new-password"
                                  disabled={busy}
                                />
                              </label>
                              <label>
                                Display name
                                <input
                                  value={edit.displayName}
                                  onChange={(e) => updateFieldUserEdit(u.id, { displayName: e.target.value })}
                                  disabled={busy}
                                />
                              </label>
                              <label>
                                Role
                                <select
                                  value={edit.role}
                                  onChange={(e) => updateFieldUserEdit(u.id, { role: e.target.value })}
                                  disabled={busy}
                                >
                                  {FIELD_ROLE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Phone (WhatsApp)
                                <input
                                  value={edit.phone}
                                  onChange={(e) => updateFieldUserEdit(u.id, { phone: e.target.value })}
                                  placeholder="62812…"
                                  disabled={busy}
                                />
                              </label>
                              <label>
                                Email
                                <input
                                  type="email"
                                  value={edit.email}
                                  onChange={(e) => updateFieldUserEdit(u.id, { email: e.target.value })}
                                  placeholder="tech@…"
                                  disabled={busy}
                                />
                              </label>
                              <fieldset className="span-2 admin-fieldset">
                                <legend>Desk privileges</legend>
                                <p className="admin-hint">
                                  Goods/Customers need sign-in. Jobs/plan/orders/live/settings apply when the user is signed
                                  in on the desk.
                                </p>
                                <div className="admin-toggle-grid" role="group" aria-label="Desk privileges">
                                  {DESK_PRIVILEGE_KEYS.map((key) => (
                                    <label key={key} className={`admin-chip-toggle${edit.privileges[key] ? " is-on" : ""}`}>
                                      <input
                                        type="checkbox"
                                        checked={edit.privileges[key]}
                                        disabled={busy}
                                        onChange={(e) =>
                                          updateFieldUserEdit(u.id, {
                                            privileges: { ...edit.privileges, [key]: e.target.checked },
                                          })
                                        }
                                      />
                                      <span>{DESK_PRIVILEGE_LABELS[key]}</span>
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                              <div className="span-2 admin-field-row-actions">
                                <button
                                  type="submit"
                                  className="btn btn-primary"
                                  disabled={busy || !edit.username.trim()}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={busy}
                                  onClick={() => void patchFieldUser(u.id, { enabled: !u.enabled })}
                                >
                                  {u.enabled ? "Disable" : "Enable"}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={busy}
                                  onClick={() => void deleteFieldUser(u.id, u.username)}
                                >
                                  Delete
                                </button>
                              </div>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                    {fieldUsers.length === 0 && <li className="muted admin-empty">No field users yet.</li>}
                  </ul>
                  <details className="admin-inner-fold admin-add-user-fold">
                    <summary>+ Add field user</summary>
                    <form className="admin-form-grid" onSubmit={(e) => void createFieldUser(e)}>
                      <label>
                        Username
                        <input value={fuUsername} onChange={(e) => setFuUsername(e.target.value)} required />
                      </label>
                      <label>
                        Password
                        <input
                          type="password"
                          value={fuPassword}
                          onChange={(e) => setFuPassword(e.target.value)}
                          required
                          minLength={6}
                          autoComplete="new-password"
                        />
                      </label>
                      <label>
                        Display name
                        <input value={fuDisplayName} onChange={(e) => setFuDisplayName(e.target.value)} />
                      </label>
                      <label>
                        Role
                        <select value={fuRole} onChange={(e) => setFuRole(e.target.value)}>
                          {FIELD_ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Phone (WhatsApp)
                        <input
                          value={fuPhone}
                          onChange={(e) => setFuPhone(e.target.value)}
                          placeholder="62812…"
                        />
                      </label>
                      <label>
                        Email
                        <input
                          type="email"
                          value={fuEmail}
                          onChange={(e) => setFuEmail(e.target.value)}
                          placeholder="tech@…"
                        />
                      </label>
                      <fieldset className="span-2 admin-fieldset">
                        <legend>Desk privileges</legend>
                        <p className="admin-hint">
                          Goods/Customers need sign-in. Jobs/plan/orders/live/settings apply when the user is signed in on
                          the desk.
                        </p>
                        <div className="admin-toggle-grid" role="group" aria-label="Desk privileges">
                          {DESK_PRIVILEGE_KEYS.map((key) => (
                            <label key={key} className={`admin-chip-toggle${fuPrivileges[key] ? " is-on" : ""}`}>
                              <input
                                type="checkbox"
                                checked={fuPrivileges[key]}
                                disabled={busy}
                                onChange={(e) =>
                                  setFuPrivileges((prev) => ({ ...prev, [key]: e.target.checked }))
                                }
                              />
                              <span>{DESK_PRIVILEGE_LABELS[key]}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <div className="span-2 admin-actions">
                        <button type="submit" className="btn btn-primary" disabled={busy}>
                          Add field user
                        </button>
                      </div>
                    </form>
                  </details>
                </section>
              )}
              </>
              )}

              {selectedId !== "new" && adminSection === "devices" && (
              <>
                <section className="admin-panel admin-device-manager">
                  <header className="admin-panel-head">
                    <h3>Device Manager</h3>
                    <p
                      className="muted"
                      title="Remap vendor IO/tags/alarms → app params. Adapters are MVP/partial until certified."
                    >
                      Vendor → app params · MVP adapters
                    </p>
                  </header>
                  <div className="admin-actions" style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void loadGatewayStatus()}
                    >
                      Refresh gateway status
                    </button>
                  </div>
                  {gatewayStatus ? <p className="admin-notice">{gatewayStatus}</p> : null}
                  {gatewayDetail ? <p className="muted">{gatewayDetail}</p> : null}

                  <details className="admin-dm-fold" open>
                    <summary>Profiles (multi)</summary>
                    <form className="admin-form-grid" onSubmit={(e) => void addTrackerProfile(e)}>
                      <label>
                        New profile name
                        <input
                          value={newProfileName}
                          onChange={(e) => setNewProfileName(e.target.value)}
                          placeholder="My Teltonika ops B"
                          required
                        />
                      </label>
                      <label>
                        Protocol
                        <select
                          value={newProfileProtocol}
                          onChange={(e) => setNewProfileProtocol(e.target.value)}
                        >
                          {[
                            "teltonika",
                            "jt808",
                            "subiao",
                            "concox",
                            "ruptela",
                            "galileosky",
                            "jt809",
                            "jt1078",
                            "http",
                          ].map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="span-2 admin-actions">
                        <button
                          type="submit"
                          className="btn btn-secondary"
                          disabled={busy || !newProfileName.trim()}
                        >
                          Create profile
                        </button>
                      </div>
                    </form>
                    <div className="admin-form-grid">
                      <label>
                        Active profile
                        <select
                          value={dmProfileId}
                          onChange={(e) => {
                            setDmMapDeviceId("");
                            setDmProfileId(e.target.value);
                          }}
                          disabled={!!dmMapDeviceId}
                        >
                          {trackerProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.protocol}/{p.completeness}
                              {p.tenantId ? "" : " · system"})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Or device override
                        <select
                          value={dmMapDeviceId}
                          onChange={(e) => setDmMapDeviceId(e.target.value)}
                        >
                          <option value="">(use profile rules)</option>
                          {trackerDevices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.imei} · {d.protocol || "?"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="span-2 admin-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy || !dmProfileId}
                          onClick={() => void cloneTrackerProfile(dmProfileId)}
                        >
                          Clone active profile
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={
                            busy ||
                            !dmProfileId ||
                            !trackerProfiles.find((p) => p.id === dmProfileId)?.tenantId
                          }
                          onClick={() => void removeTrackerProfile(dmProfileId)}
                        >
                          Delete tenant profile
                        </button>
                      </div>
                    </div>
                  </details>

                  <details className="admin-dm-fold">
                    <summary>App parameter master</summary>
                    <form className="admin-form-grid" onSubmit={(e) => void addAppParam(e)}>
                      <label>
                        Param id
                        <input
                          value={newParamId}
                          onChange={(e) => setNewParamId(e.target.value)}
                          placeholder="custom.fuel_aux"
                          required
                        />
                      </label>
                      <label>
                        Label
                        <input
                          value={newParamLabel}
                          onChange={(e) => setNewParamLabel(e.target.value)}
                          placeholder="Aux fuel"
                        />
                      </label>
                      <label>
                        Category
                        <select
                          value={newParamCategory}
                          onChange={(e) => setNewParamCategory(e.target.value)}
                        >
                          <option value="avl">avl</option>
                          <option value="safety">safety</option>
                          <option value="video">video</option>
                          <option value="other">other</option>
                        </select>
                      </label>
                      <label>
                        Value type
                        <select
                          value={newParamValueType}
                          onChange={(e) => setNewParamValueType(e.target.value)}
                        >
                          <option value="number">number</option>
                          <option value="bool">bool</option>
                          <option value="string">string</option>
                        </select>
                      </label>
                      <label>
                        Unit
                        <input
                          value={newParamUnit}
                          onChange={(e) => setNewParamUnit(e.target.value)}
                          placeholder="L / km/h / …"
                        />
                      </label>
                      <div className="span-2 admin-actions">
                        <button
                          type="submit"
                          className="btn btn-secondary"
                          disabled={busy || !newParamId.trim()}
                        >
                          Add app param
                        </button>
                      </div>
                    </form>
                    <ul className="admin-remap-grid">
                      {paramDefs
                        .filter((p) => !!p.tenantId)
                        .map((p) => (
                          <li key={p.id}>
                            <span className="admin-remap-rule">
                              <strong>{p.id}</strong>
                              <span className="muted">
                                {" "}
                                · {p.label} · {p.valueType}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="btn-ghost btn-compact admin-remap-delete"
                              disabled={busy}
                              onClick={() => void removeAppParam(p.id)}
                            >
                              Delete
                            </button>
                          </li>
                        ))}
                      {paramDefs.filter((p) => !!p.tenantId).length === 0 ? (
                        <li className="muted admin-empty admin-remap-empty">
                          No tenant custom params yet — system seeds still available in remap picker.
                        </li>
                      ) : null}
                    </ul>
                  </details>
                  <ul className="admin-remap-grid">
                    {(mapRulesExpanded
                      ? mapRules
                      : mapRules.slice(0, MAP_RULES_COLLAPSED)
                    ).map((r) => (
                      <li key={r.id}>
                        <span className="admin-remap-rule">
                          <code>{r.vendorKey}</code>
                          <span className="muted"> → </span>
                          <strong>{r.appParamId}</strong>
                          <span className="muted"> ({r.transform})</span>
                          {r.deviceId ? <span className="muted"> · device</span> : null}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost btn-compact admin-remap-delete"
                          disabled={busy}
                          onClick={() => void removeMapRule(r.id)}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                    {mapRules.length === 0 ? (
                      <li className="muted admin-empty admin-remap-empty">
                        {dmMapDeviceId
                          ? "No device-level remap overrides yet."
                          : "No remap rules on this profile yet."}
                      </li>
                    ) : null}
                  </ul>
                  {mapRules.length > MAP_RULES_COLLAPSED ? (
                    <button
                      type="button"
                      className="admin-show-more"
                      onClick={() => setMapRulesExpanded((v) => !v)}
                    >
                      {mapRulesExpanded
                        ? "Show less"
                        : `Show more (${mapRules.length - MAP_RULES_COLLAPSED} more)`}
                    </button>
                  ) : null}
                  <form className="admin-form-grid" onSubmit={(e) => void addMapRule(e)}>
                    <label>
                      Vendor key
                      {protocolParams.length > 0 ? (
                        <select value={dmVendorKey} onChange={(e) => setDmVendorKey(e.target.value)}>
                          {protocolParams.map((p) => (
                            <option key={p.vendorKey} value={p.vendorKey}>
                              {p.vendorKey} — {p.label}
                            </option>
                          ))}
                          <option value={dmVendorKey}>custom: {dmVendorKey}</option>
                        </select>
                      ) : (
                        <input value={dmVendorKey} onChange={(e) => setDmVendorKey(e.target.value)} />
                      )}
                    </label>
                    <label>
                      Or type vendor key
                      <input
                        value={dmVendorKey}
                        onChange={(e) => setDmVendorKey(e.target.value)}
                        placeholder="io.239 / alarm.sos / tag.0x01"
                      />
                    </label>
                    <label>
                      App param
                      <select value={dmAppParam} onChange={(e) => setDmAppParam(e.target.value)}>
                        {paramDefs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label} ({p.id})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Transform
                      <select value={dmTransform} onChange={(e) => setDmTransform(e.target.value)}>
                        <option value="identity">identity</option>
                        <option value="scale">scale</option>
                        <option value="offset">offset</option>
                        <option value="bit_mask">bit_mask</option>
                        <option value="invert_bool">invert_bool</option>
                        <option value="enum_map">enum_map</option>
                      </select>
                    </label>
                    <label>
                      Transform arg (JSON)
                      <input
                        value={dmTransformArg}
                        onChange={(e) => setDmTransformArg(e.target.value)}
                        placeholder='{"scale":0.001} / {"mask":1} / {"map":{"0":false}}'
                      />
                    </label>
                    <div className="span-2 admin-actions">
                      <button
                        type="submit"
                        className="btn btn-secondary"
                        disabled={busy || (!dmProfileId && !dmMapDeviceId)}
                      >
                        {dmMapDeviceId ? "Add device override" : "Add remap rule"}
                      </button>
                    </div>
                  </form>
                  <form className="admin-form-grid" onSubmit={(e) => void sendDeviceCommand(e)}>
                    <label>
                      Send command to device
                      <select
                        value={cmdDeviceId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setCmdDeviceId(id);
                          const d = trackerDevices.find((x) => x.id === id);
                          if (d?.protocol === "teltonika") setCmdType("teltonika_codec12");
                          else if (d?.protocol === "concox") setCmdType("concox_gprs");
                          else if (d?.protocol === "ruptela") setCmdType("ruptela_sms");
                          else if (d?.protocol === "galileosky") setCmdType("galileosky_text");
                          else if (d?.protocol === "jt808" || d?.protocol === "subiao")
                            setCmdType("text");
                          else setCmdType("text");
                          void loadCommandHistory(id);
                        }}
                      >
                        <option value="">Select device…</option>
                        {trackerDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label || d.imei}
                            {onlineImeis.has(d.imei) ? " · online" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Command type
                      <select value={cmdType} onChange={(e) => setCmdType(e.target.value)}>
                        {commandTypesForProtocol(
                          trackerDevices.find((d) => d.id === cmdDeviceId)?.protocol || "",
                        ).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Payload text
                      <input
                        value={cmdText}
                        onChange={(e) => setCmdText(e.target.value)}
                        placeholder={commandPayloadPlaceholder(cmdType).text}
                      />
                    </label>
                    <label>
                      Payload hex (optional)
                      <input
                        value={cmdHex}
                        onChange={(e) => setCmdHex(e.target.value)}
                        placeholder={commandPayloadPlaceholder(cmdType).hex}
                        spellCheck={false}
                      />
                    </label>
                    <div className="span-2 admin-actions">
                      <button
                        type="submit"
                        className="btn btn-secondary"
                        disabled={busy || !cmdDeviceId || (!cmdText.trim() && !cmdHex.trim())}
                      >
                        Queue downlink
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy || !cmdDeviceId}
                        onClick={() => void loadCommandHistory(cmdDeviceId)}
                      >
                        Refresh commands
                      </button>
                    </div>
                  </form>
                  {cmdHistory.length > 0 ? (
                    <ul className="admin-field-list">
                      {cmdHistory.slice(0, 12).map((c) => {
                        const pill =
                          c.status === "acked"
                            ? "is-on"
                            : c.status === "failed" || c.status === "expired"
                              ? "is-off"
                              : "is-muted";
                        return (
                          <li key={c.id}>
                            <span>
                              <span className={`admin-pill ${pill}`}>{c.status}</span> · {c.commandType}
                              {c.corrId ? ` · corr ${c.corrId}` : ""}
                              {c.payloadText ? ` · ${c.payloadText.slice(0, 48)}` : ""}
                              {c.payloadHex ? ` · hex ${c.payloadHex.slice(0, 24)}` : ""}
                              {c.responseText ? (
                                <span title={c.responseText}> → {c.responseText.slice(0, 64)}</span>
                              ) : null}
                              <span className="muted">
                                {" "}
                                · {c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}
                                {c.sentAt ? ` · sent ${new Date(c.sentAt).toLocaleString()}` : ""}
                                {c.completedAt
                                  ? ` · done ${new Date(c.completedAt).toLocaleString()}`
                                  : ""}
                              </span>
                            </span>
                            {c.status === "pending" ? (
                              <button
                                type="button"
                                className="btn-ghost"
                                disabled={busy}
                                onClick={() => void cancelPendingCommand(c.id)}
                              >
                                Cancel
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : cmdDeviceId ? (
                    <p className="muted">No commands queued for this device yet.</p>
                  ) : null}
                  <div className="admin-form-grid">
                    <label>
                      Remap preview device
                      <select
                        value={previewDeviceId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setPreviewDeviceId(id);
                          void loadRemapPreview(id);
                        }}
                      >
                        <option value="">Select device…</option>
                        {trackerDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label || d.imei}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="span-2 admin-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy || !previewDeviceId}
                        onClick={() => void loadRemapPreview()}
                      >
                        Preview raw → mapped
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => void loadSafetyEventsForTenant()}
                      >
                        Refresh safety events
                      </button>
                    </div>
                  </div>
                  {remapPreview ? (
                    <pre className="admin-notice" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                      {remapPreview}
                    </pre>
                  ) : null}
                  {safetyEvents.length > 0 ? (
                    <ul className="admin-field-list">
                      {safetyEvents.map((ev) => {
                        const dev = trackerDevices.find((d) => d.id === ev.deviceId);
                        return (
                          <li key={ev.id}>
                            <span>
                              <strong>{ev.alarmType}</strong> L{ev.alarmLevel}
                              {ev.sourceProtocol ? (
                                <span className="admin-pill is-muted"> {ev.sourceProtocol}</span>
                              ) : null}
                              {dev ? ` · ${dev.label || dev.imei}` : ""}
                              {" · "}
                              {ev.recordedAt ? new Date(ev.recordedAt).toLocaleString() : "—"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="muted">No safety / alarm events yet (Su Biao, Concox, JT808, …).</p>
                  )}
                </section>
              </>
              )}

              {selectedId !== "new" && adminSection === "deviceMgmt" && (
              <>
                <section className="admin-panel">
                  <header className="admin-panel-head">
                    <h3>
                      Fleet groups{" "}
                      <span className="admin-count-badge">{deviceGroups.length}</span>
                    </h3>
                    <p className="muted">
                      Device buckets for Fleet Live / Dispatch / Maintenance · membership by GPS
                      device (Armada link optional)
                    </p>
                  </header>
                  <form className="admin-form-grid" onSubmit={(e) => void createDeviceGroup(e)}>
                    <label>
                      New group name
                      <input
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Jakarta north"
                        required
                      />
                    </label>
                    <label>
                      Description
                      <input
                        value={newGroupDesc}
                        onChange={(e) => setNewGroupDesc(e.target.value)}
                        placeholder="Optional"
                      />
                    </label>
                    <div className="span-2 admin-actions">
                      <button
                        type="submit"
                        className="btn btn-secondary"
                        disabled={busy || !newGroupName.trim()}
                      >
                        Create group
                      </button>
                    </div>
                  </form>
                  {deviceGroups.length > 0 ? (
                    <div className="admin-form-grid" style={{ marginTop: 8 }}>
                      <label>
                        Edit group
                        <select
                          value={editGroupId}
                          onChange={(e) => setEditGroupId(e.target.value)}
                        >
                          {deviceGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                              {g.memberCount != null ? ` (${g.memberCount})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="span-2">
                        <p className="muted" style={{ marginBottom: 4 }}>
                          Members (multi-select)
                        </p>
                        <div className="admin-remap-grid" style={{ maxHeight: 160, overflow: "auto" }}>
                          {trackerDevices.map((d) => {
                            const checked = editGroupMembers.includes(d.id);
                            return (
                              <label key={d.id} className="admin-check-row">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setEditGroupMembers((prev) =>
                                      e.target.checked
                                        ? [...prev, d.id]
                                        : prev.filter((id) => id !== d.id),
                                    );
                                  }}
                                />
                                <span>
                                  {d.label || d.imei}{" "}
                                  <span className="muted">· {d.imei}</span>
                                </span>
                              </label>
                            );
                          })}
                          {trackerDevices.length === 0 ? (
                            <p className="muted">Add tracker devices first.</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="span-2 admin-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy || !editGroupId}
                          onClick={() => void saveGroupMembers()}
                        >
                          Save members
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy || !editGroupId}
                          onClick={() => {
                            const g = deviceGroups.find((x) => x.id === editGroupId);
                            if (g) void removeDeviceGroup(g.id, g.name);
                          }}
                        >
                          Delete group
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="muted">No groups yet — create one to scope Fleet Live.</p>
                  )}
                </section>

                <section className="admin-panel">
                  {lastDeviceToken ? (
                    <p className="admin-notice">
                      Device token (copy now): <code>{lastDeviceToken}</code>{" "}
                      <button
                        type="button"
                        className="btn-ghost btn-compact"
                        onClick={() => void copyText(lastDeviceToken)}
                      >
                        Copy
                      </button>
                    </p>
                  ) : null}
                  {unassignedTrackers.length > 0 ? (
                    <div className="admin-unassigned-block">
                      <h4>
                        Unassigned IMEIs{" "}
                        <span className="admin-count-badge">{unassignedTrackers.length}</span>
                      </h4>
                      <p className="muted">
                        Seen by the gateway but not registered — claim into this tenant or dismiss.
                      </p>
                      <ul className="admin-field-list">
                        {unassignedTrackers.map((u) => (
                          <li key={u.imei}>
                            <div className="admin-field-summary">
                              <div className="admin-field-identity">
                                <div className="admin-field-identity-text">
                                  <strong>{u.imei}</strong>
                                  <div className="admin-field-tags">
                                    <span className="admin-pill is-muted">{u.protocol}</span>
                                    <span className="admin-pill is-muted">{u.hitCount} hits</span>
                                  </div>
                                  <span className="muted">
                                    {u.lastRemote ? `from ${u.lastRemote} · ` : ""}
                                    last{" "}
                                    {u.lastSeenAt
                                      ? new Date(u.lastSeenAt).toLocaleString()
                                      : "—"}
                                  </span>
                                </div>
                              </div>
                              <div className="admin-field-row-actions">
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={busy}
                                  onClick={() => void claimUnassignedTracker(u)}
                                >
                                  Claim
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={busy}
                                  onClick={() => void dismissUnassignedTracker(u.imei)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <AdminFleetDevicePanel
                    devices={trackerDevices}
                    profiles={trackerProfiles.map((p) => ({
                      id: p.id,
                      name: p.name,
                      protocol: p.protocol,
                    }))}
                    fieldDefs={deviceFieldDefs}
                    onlineImeis={onlineImeis}
                    protocolOptions={TRACKER_PROTOCOL_OPTIONS}
                    busy={busy}
                    onRefresh={() => {
                      if (!selectedId || selectedId === "new") return;
                      void loadTrackerDevices(selectedId);
                      void loadDeviceFieldDefs(selectedId);
                    }}
                    onCreate={(body) => createTrackerDeviceBody(body)}
                    onUpdate={(id, body) => updateTrackerDeviceBody(id, body)}
                    onDelete={(id, imei) => deleteTrackerDevice(id, imei)}
                    onCreateField={(body) => createDeviceFieldDefBody(body)}
                    onDeleteField={(id) => deleteDeviceFieldDefBody(id)}
                    tenantKey={selected?.key}
                  />
                  <p className="muted" style={{ marginTop: 8, fontSize: "0.72rem" }}>
                    Ingest · <code>{selected?.trackerIngestUrl || "/api/tracker/ingest/v1/fix"}</code>
                    {" · "}
                    <button
                      type="button"
                      className="btn-ghost btn-compact"
                      disabled={busy || !trackerDevices[0]}
                      onClick={() => trackerDevices[0] && void rotateDeviceToken(trackerDevices[0].id)}
                      title="Rotate token for the first listed device (select-specific rotate coming next)"
                    >
                      Rotate first device token
                    </button>
                  </p>
                </section>
              </>
              )}

              {selectedId !== "new" && adminSection === "live" && (
                <section className="admin-panel admin-live-values">
                  <header className="admin-panel-head">
                    <h3>Live values</h3>
                    <p
                      className="muted"
                      title="Latest typed fields, remapped app params, and optional raw vendor keys from last uplink (poll ~3s)."
                    >
                      Last uplink · all protocols · poll ~3s
                    </p>
                  </header>
                  <div className="admin-form-grid">
                    <label>
                      Device filter
                      <select
                        value={liveDeviceId}
                        onChange={(e) => setLiveDeviceId(e.target.value)}
                      >
                        <option value="">All devices</option>
                        {trackerDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label || d.imei} · {d.protocol}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`admin-switch${liveShowRaw ? " is-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={liveShowRaw}
                        onChange={(e) => setLiveShowRaw(e.target.checked)}
                      />
                      Include raw vendor keys
                    </label>
                    <div className="span-2 admin-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setLivePaused((p) => !p)}
                      >
                        {livePaused ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => {
                          if (selectedId && selectedId !== "new") {
                            void loadLiveParamValues(selectedId, liveDeviceId, liveShowRaw);
                          }
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                  <div className="admin-scan-matrix-wrap">
                    <table className="admin-scan-matrix admin-live-values-table">
                      <thead>
                        <tr>
                          <th>Device</th>
                          <th>IMEI</th>
                          <th>Protocol</th>
                          <th>App param</th>
                          <th>Label</th>
                          <th>Value</th>
                          <th>Source</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveParamRows.map((row, idx) => (
                          <tr key={`${row.deviceId}-${row.source}-${row.paramId}-${idx}`}>
                            <td>{row.label || "—"}</td>
                            <td>
                              <code>{row.imei}</code>
                            </td>
                            <td>{row.protocol || "—"}</td>
                            <td>
                              <code>{row.paramId}</code>
                            </td>
                            <td>{row.paramLabel}</td>
                            <td>
                              <strong>{String(row.value)}</strong>
                            </td>
                            <td>
                              <span
                                className={`admin-pill${
                                  row.source === "raw"
                                    ? " is-muted"
                                    : row.source === "mapped_extra"
                                      ? " is-off"
                                      : " is-ok"
                                }`}
                              >
                                {row.source}
                              </span>
                            </td>
                            <td className="muted">
                              {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}
                            </td>
                          </tr>
                        ))}
                        {liveParamRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="muted admin-empty">
                              No values yet — wait for gateway uplink, or confirm remap rules map
                              vendor keys to app params.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {selectedId !== "new" && adminSection === "terminal" && (
                <section className="admin-panel admin-terminal">
                  <header className="admin-panel-head">
                    <h3>Terminal</h3>
                    <p
                      className="muted"
                      title="Expand a row to see device wire hex (AVL/tags) for decode discussion. Poll ~3s."
                    >
                      Expand row → RAW WIRE HEX · poll ~3s
                    </p>
                  </header>
                  <div className="admin-form-grid">
                    <label>
                      Device filter
                      <select
                        value={terminalDeviceId}
                        onChange={(e) => setTerminalDeviceId(e.target.value)}
                      >
                        <option value="">All devices</option>
                        {trackerDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label || d.imei} · {d.protocol}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="span-2 admin-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setTerminalPaused((p) => !p)}
                      >
                        {terminalPaused ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => {
                          setTerminalEvents([]);
                          if (selectedId && selectedId !== "new") {
                            void loadTerminalEvents(selectedId, terminalDeviceId);
                          }
                        }}
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setTerminalEvents([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <ul className="admin-terminal-list">
                    {terminalEvents.map((ev, idx) => {
                      const unreg = ev.kind === "unregistered";
                      const key = `${ev.kind || "fix"}-${ev.eventId || ev.deviceId}-${ev.recordedAt}-${idx}`;
                      const open = terminalExpanded === key;
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            className="admin-terminal-row"
                            onClick={() => setTerminalExpanded(open ? null : key)}
                          >
                            <span className="admin-terminal-meta">
                              <strong>{ev.imei || "(no imei)"}</strong>
                              {unreg ? (
                                <span className="admin-pill is-off">unregistered</span>
                              ) : null}
                              <span className="admin-pill is-muted">{ev.protocol || "?"}</span>
                              <span className="muted">
                                {ev.recordedAt ? new Date(ev.recordedAt).toLocaleString() : "—"}
                              </span>
                            </span>
                            <span className="admin-terminal-fix">
                              {unreg
                                ? `connection attempt${ev.remote ? ` · from ${ev.remote}` : ""}`
                                : ev.lat != null && ev.lon != null
                                  ? `${ev.lat.toFixed(5)}, ${ev.lon.toFixed(5)}`
                                  : "no fix"}
                              {!unreg && ev.speed != null ? ` · ${ev.speed} km/h` : ""}
                              {!unreg && ev.heading != null ? ` · hdg ${ev.heading}°` : ""}
                              {!unreg && ev.ignition != null
                                ? ev.ignition
                                  ? " · IGN"
                                  : " · off"
                                : ""}
                              {!unreg &&
                              (typeof ev.rawAttrs?.["avl.hex"] === "string" ||
                                typeof ev.rawAttrs?.["avl.frame_hex"] === "string")
                                ? " · RAW HEX"
                                : ""}
                              {!unreg && Object.keys(ev.mappedAttrs || {}).length
                                ? ` · ${Object.keys(ev.mappedAttrs).length} mapped`
                                : ""}
                            </span>
                          </button>
                          {unreg && selectedId && selectedId !== "new" ? (
                            <div className="admin-actions" style={{ marginTop: 6 }}>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={busy || !ev.imei}
                                onClick={() =>
                                  void claimUnassignedTracker({
                                    imei: ev.imei,
                                    protocol: ev.protocol || "other",
                                    hitCount: 1,
                                    lastRemote: ev.remote || "",
                                    firstSeenAt: ev.recordedAt,
                                    lastSeenAt: ev.recordedAt,
                                  })
                                }
                              >
                                Claim into this tenant
                              </button>
                            </div>
                          ) : null}
                          {open ? (
                            <div className="admin-terminal-expand">
                              {(() => {
                                const raw = ev.rawAttrs || {};
                                const frameHex =
                                  typeof raw["avl.frame_hex"] === "string"
                                    ? (raw["avl.frame_hex"] as string)
                                    : "";
                                const avlHex =
                                  typeof raw["avl.hex"] === "string"
                                    ? (raw["avl.hex"] as string)
                                    : "";
                                const wireHex = frameHex || avlHex;
                                const gpsRaw = {
                                  lon_raw: raw["gps.longitude_raw"],
                                  lat_raw: raw["gps.latitude_raw"],
                                  alt_raw: raw["gps.altitude_raw"],
                                  angle_raw: raw["gps.angle_raw"],
                                  lon: raw["gps.longitude"],
                                  lat: raw["gps.latitude"],
                                  angle: raw["gps.angle"],
                                  speed: raw["gps.speed"],
                                  sats: raw["gps.satellites"],
                                  codec: raw.codec,
                                  ext_v: raw["voltage.ext"] ?? raw["io.66"],
                                  batt_v: raw["voltage.batt"] ?? raw["io.67"],
                                };
                                const restRaw = { ...raw };
                                delete restRaw["avl.hex"];
                                delete restRaw["avl.frame_hex"];
                                delete restRaw["avl.bytes"];
                                return (
                                  <>
                                    {wireHex ? (
                                      <div className="admin-terminal-wire">
                                        <div className="admin-terminal-wire-head">
                                          <strong>RAW WIRE HEX</strong>
                                          <span className="muted">
                                            {frameHex
                                              ? "frame (preamble+len+AVL+CRC)"
                                              : "AVL / tags payload"}
                                            {typeof raw["avl.bytes"] === "number"
                                              ? ` · ${raw["avl.bytes"]} B`
                                              : ""}
                                          </span>
                                          <button
                                            type="button"
                                            className="btn btn-ghost"
                                            style={{ marginLeft: "auto", fontSize: "0.65rem" }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void navigator.clipboard?.writeText(wireHex);
                                            }}
                                          >
                                            Copy hex
                                          </button>
                                        </div>
                                        <pre className="admin-terminal-hex">{wireHex}</pre>
                                        {frameHex && avlHex && frameHex !== avlHex ? (
                                          <>
                                            <div className="admin-terminal-wire-head">
                                              <strong>AVL PAYLOAD</strong>
                                              <button
                                                type="button"
                                                className="btn btn-ghost"
                                                style={{ marginLeft: "auto", fontSize: "0.65rem" }}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void navigator.clipboard?.writeText(avlHex);
                                                }}
                                              >
                                                Copy AVL
                                              </button>
                                            </div>
                                            <pre className="admin-terminal-hex">{avlHex}</pre>
                                          </>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <p className="muted" style={{ fontSize: "0.7rem", margin: 0 }}>
                                        No wire hex yet — redeploy tracker-gateway, then wait for the next uplink.
                                      </p>
                                    )}
                                    {!unreg ? (
                                      <div className="admin-terminal-decode">
                                        <strong style={{ color: "var(--admin-ink)" }}>
                                          GPS Element (gateway decode)
                                        </strong>
                                        <span>
                                          lat/lon cooked: {String(gpsRaw.lat ?? "—")},{" "}
                                          {String(gpsRaw.lon ?? "—")} · heading{" "}
                                          {String(gpsRaw.angle ?? ev.heading ?? "—")}° · speed{" "}
                                          {String(gpsRaw.speed ?? ev.speed ?? "—")} km/h · sats{" "}
                                          {String(gpsRaw.sats ?? "—")}
                                        </span>
                                        <span>
                                          raw ints: lon={String(gpsRaw.lon_raw ?? "—")} lat=
                                          {String(gpsRaw.lat_raw ?? "—")} alt=
                                          {String(gpsRaw.alt_raw ?? "—")} angle=
                                          {String(gpsRaw.angle_raw ?? "—")} · codec=
                                          {String(gpsRaw.codec ?? "?")}
                                        </span>
                                        <span>
                                          voltage: ext={String(gpsRaw.ext_v ?? "—")} batt=
                                          {String(gpsRaw.batt_v ?? "—")} (AVL66/67 raw mV in io.*)
                                        </span>
                                      </div>
                                    ) : null}
                                    <pre className="admin-terminal-json is-tall">
                                      {JSON.stringify(
                                        {
                                          kind: ev.kind || "fix",
                                          remote: ev.remote,
                                          lat: ev.lat,
                                          lon: ev.lon,
                                          heading: ev.heading,
                                          rawAttrs: restRaw,
                                          mappedAttrs: ev.mappedAttrs,
                                        },
                                        null,
                                        2,
                                      )}
                                    </pre>
                                  </>
                                );
                              })()}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                    {terminalEvents.length === 0 ? (
                      <li className="muted admin-empty">
                        No recent traffic — wait for gateway uplink (registered or unregistered IMEI).
                      </li>
                    ) : null}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="admin-empty-state">
              <BrandMark size={36} />
              <h2>Select a tenant</h2>
              <p className="muted">Pick from the list or create a new embed tenant to manage tokens and notify channels.</p>
              <button type="button" className="btn btn-primary" onClick={selectNew}>
                Create tenant
              </button>
            </div>
          )}
        </main>
      </div>

      <footer className="admin-footer">
        <span>Armada M.1 · Tenant editor · Compact dense layout</span>
        <span>{tenants.length} tenant{tenants.length === 1 ? "" : "s"} loaded</span>
      </footer>
    </div>
  );
}
