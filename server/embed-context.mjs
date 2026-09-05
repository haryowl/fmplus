import { publicTenant, tenantFromRequest } from "./tenants.mjs";
import { mergeEntitlements } from "./entitlements.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<boolean>}
 */
export async function handleEmbedContextRequest(req, res) {
  const pathOnly = (req.url || "").split("?")[0];
  if (pathOnly !== "/api/embed-context") return false;

  const json = (status, obj) => {
    res.writeHead(status, securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }));
    res.end(JSON.stringify(obj));
  };

  if (req.method !== "GET") {
    json(405, { error: "Method not allowed" });
    return true;
  }

  const tenant = tenantFromRequest(req);
  if (!tenant) {
    json(404, { error: "Unknown embed tenant" });
    return true;
  }
  const pub = publicTenant(tenant);
  json(200, {
    ...pub,
    entitlements: mergeEntitlements(tenant.entitlements || pub?.entitlements),
  });
  return true;
}
