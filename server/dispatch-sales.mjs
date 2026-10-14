/**
 * Sales visit helpers: required Finish outcomes + optional spawn delivery order.
 */
import { dbQuery } from "./db.mjs";
import { todayServiceDate } from "./service-day.mjs";

export const VISIT_OUTCOMES = [
  "visited",
  "not_home",
  "ordered",
  "follow_up",
  "no_interest",
];

export const VISIT_OUTCOME_LABELS = {
  visited: "Visited (no order)",
  not_home: "Not home / closed",
  ordered: "Order taken",
  follow_up: "Follow-up needed",
  no_interest: "No interest",
};

export function parseVisitOutcome(raw) {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!VISIT_OUTCOMES.includes(v)) return null;
  return v;
}

export function parseOrderProfile(raw) {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "sales" || v === "passenger" || v === "cargo") return v;
  return null;
}

/** True when Finish must collect a visit outcome. */
export function salesVisitRequiresOutcome(orderProfile, tenantSalesEnabled) {
  return tenantSalesEnabled === true && orderProfile === "sales";
}

/**
 * Create a pending cargo delivery order from a completed sales visit.
 * @returns {Promise<object|null>} new order row
 */
export async function spawnDeliveryFromVisit(tenantId, visitOrder, opts = {}) {
  if (!visitOrder?.id) return null;
  const serviceDate = opts.serviceDate || todayServiceDate();
  const customerName = String(visitOrder.customer_name || visitOrder.customerName || "").trim();
  if (!customerName) {
    const err = new Error("Visit order has no customer name");
    err.status = 400;
    throw err;
  }
  const notesBits = [
    "From sales visit",
    visitOrder.external_ref || visitOrder.externalRef
      ? `ref ${visitOrder.external_ref || visitOrder.externalRef}`
      : "",
    opts.visitOutcome ? `outcome ${opts.visitOutcome}` : "",
  ].filter(Boolean);

  const inserted = await dbQuery(
    `INSERT INTO dispatch_orders (
       tenant_id, external_ref, customer_name, address, lat, lon, zone,
       window_start, window_end, notes, service_date, service_minutes, proof_required,
       kind, customer_id, profile, spawned_from_order_id, status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,'drop',$14,'cargo',$15,'pending'
     )
     RETURNING *`,
    [
      tenantId,
      String(opts.externalRef || "").trim().slice(0, 80) || null,
      customerName.slice(0, 200),
      String(visitOrder.address || "").trim().slice(0, 500) || null,
      visitOrder.lat == null ? null : Number(visitOrder.lat),
      visitOrder.lon == null ? null : Number(visitOrder.lon),
      String(visitOrder.zone || "").trim().slice(0, 80) || null,
      visitOrder.window_start || visitOrder.windowStart || null,
      visitOrder.window_end || visitOrder.windowEnd || null,
      notesBits.join(" · ").slice(0, 2000),
      serviceDate,
      visitOrder.service_minutes ?? visitOrder.serviceMinutes ?? null,
      false,
      visitOrder.customer_id || visitOrder.customerId || null,
      visitOrder.id,
    ],
  );
  return inserted.rows[0] || null;
}
