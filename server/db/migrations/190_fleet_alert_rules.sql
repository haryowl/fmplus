-- Fleet Live alert rules (cooked telematics → in-app events + Email/WhatsApp).

CREATE TABLE IF NOT EXISTS fleet_alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'critical')),
  -- all | group | devices
  scope_kind TEXT NOT NULL DEFAULT 'all'
    CHECK (scope_kind IN ('all', 'group', 'devices')),
  scope_group_id UUID REFERENCES tracker_device_groups (id) ON DELETE SET NULL,
  scope_device_ids UUID[] NOT NULL DEFAULT '{}',
  -- AST-ish JSON: { op: 'and'|'or', conditions: [{ field, cmp, value }], durationSec? }
  formula JSONB NOT NULL DEFAULT '{}'::jsonb,
  notify_email BOOLEAN NOT NULL DEFAULT false,
  notify_whatsapp BOOLEAN NOT NULL DEFAULT false,
  cooldown_sec INTEGER NOT NULL DEFAULT 300,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_alert_rules_tenant_idx
  ON fleet_alert_rules (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS fleet_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  rule_id UUID REFERENCES fleet_alert_rules (id) ON DELETE SET NULL,
  device_id UUID REFERENCES tracker_devices (id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  fingerprint TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acked', 'resolved')),
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  notify_email_sent BOOLEAN NOT NULL DEFAULT false,
  notify_whatsapp_sent BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS fleet_alert_events_tenant_time_idx
  ON fleet_alert_events (tenant_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS fleet_alert_events_status_idx
  ON fleet_alert_events (tenant_id, status, fired_at DESC);
CREATE INDEX IF NOT EXISTS fleet_alert_events_fp_idx
  ON fleet_alert_events (tenant_id, fingerprint, fired_at DESC);

-- Duration / dwell tracking per rule × device
CREATE TABLE IF NOT EXISTS fleet_alert_rule_state (
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES fleet_alert_rules (id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES tracker_devices (id) ON DELETE CASCADE,
  true_since TIMESTAMPTZ,
  last_eval_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fired_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, rule_id, device_id)
);
