import { publicTenant, tenantFromRequest } from "./tenants.mjs";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<boolean>}
 */
export async function handleEmbedContextRequest(req, res) {
  const pathOnly = (req.url || "").split("?")[0];
  if (pathOnly !== "/api/embed-context") return false;

  const json = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
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
  json(200, publicTenant(tenant));
  return true;
}
