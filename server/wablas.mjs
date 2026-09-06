/**
 * Wablas WhatsApp send-message client.
 * POST {base}/api/send-message
 * Authorization: {token}.{secret_key}
 */
export function normalizePhone(raw) {
  let p = String(raw || "").replace(/[^\d+]/g, "").trim();
  if (!p) return "";
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = `62${p.slice(1)}`;
  return p;
}

export function parseRecipientList(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((s) => normalizePhone(s))
    .filter(Boolean);
}

/**
 * @param {{ baseUrl: string, token: string, secretKey?: string, phone: string, message: string }} opts
 */
export async function sendWablasMessage(opts) {
  const base = String(opts.baseUrl || "").replace(/\/+$/, "") || "https://wablas.com";
  const token = String(opts.token || "").trim();
  const secret = String(opts.secretKey || "").trim();
  const phone = normalizePhone(opts.phone);
  const message = String(opts.message || "").slice(0, 1024);
  if (!token || !phone || !message) {
    throw Object.assign(new Error("Wablas requires token, phone, and message"), { status: 400 });
  }
  const auth = secret ? `${token}.${secret}` : token;
  const url = `${base}/api/send-message`;
  const body = new URLSearchParams({ phone, message });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain */
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Wablas ${res.status}: ${text.slice(0, 200)}`), { status: 502 });
  }
  if (json && json.status === false) {
    throw Object.assign(new Error(json.message || "Wablas send failed"), { status: 502 });
  }
  return json || { ok: true, raw: text };
}
