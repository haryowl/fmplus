/**
 * Minimal authenticated SMTP over TLS (port 465 / SMTP_SECURE=1).
 * Skips quietly when SMTP_HOST is unset.
 */
import tls from "node:tls";

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

export function smtpConfigured() {
  return Boolean(env("SMTP_HOST"));
}

export function parseEmails(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function mimePayload({ from, to, cc, subject, text, attachments }) {
  const headers = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    cc.length ? `Cc: ${cc.join(", ")}` : "",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);
  const files = Array.isArray(attachments) ? attachments : [];
  if (!files.length) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="utf-8"',
      "",
      text.replace(/^\./gm, ".."),
      ".",
    ].join("\r\n");
  }
  const boundary = `fmplus-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "",
    text.replace(/^\./gm, ".."),
  ];
  for (const att of files) {
    const name = String(att?.filename || "attachment").replace(/["\r\n]+/g, "_");
    const type = String(att?.contentType || "application/octet-stream").replace(/[\r\n]+/g, "");
    const buf = Buffer.isBuffer(att?.content)
      ? att.content
      : Buffer.from(att?.content == null ? "" : String(att.content), "utf8");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${type}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      buf.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    );
  }
  parts.push(`--${boundary}--`, ".");
  return parts.join("\r\n");
}

/**
 * @param {{ to: string|string[], cc?: string|string[], subject: string, text: string, attachments?: Array<{ filename: string, contentType?: string, content: Buffer|string }> }} opts
 */
export async function sendSmtpMail(opts) {
  if (!smtpConfigured()) {
    return { skipped: true, reason: "smtp_not_configured" };
  }
  const host = env("SMTP_HOST");
  const port = Number(env("SMTP_PORT", "465")) || 465;
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const from = env("SMTP_FROM", user || "fmplus@localhost");
  const toList = Array.isArray(opts.to) ? opts.to.flatMap(parseEmails) : parseEmails(opts.to);
  const ccList = opts.cc == null ? [] : Array.isArray(opts.cc) ? opts.cc.flatMap(parseEmails) : parseEmails(opts.cc);
  const recipients = [...new Set([...toList, ...ccList])];
  if (!recipients.length) return { skipped: true, reason: "no_recipients" };

  const subject = String(opts.subject || "").replace(/[\r\n]+/g, " ");
  const text = String(opts.text || "");
  const payload = mimePayload({
    from,
    to: toList.length ? toList : recipients,
    cc: toList.length ? ccList : [],
    subject,
    text,
    attachments: opts.attachments,
  });

  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host }, () => {});
    let buf = "";
    let step = 0;
    let rcptIdx = 0;

    function write(cmd) {
      sock.write(`${cmd}\r\n`);
    }

    function fail(err) {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    function ok(result) {
      try {
        sock.end();
      } catch {
        /* ignore */
      }
      resolve(result);
    }

    sock.setEncoding("utf8");
    sock.on("error", fail);
    sock.on("data", (chunk) => {
      buf += chunk;
      while (buf.includes("\r\n")) {
        const i = buf.indexOf("\r\n");
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!/^\d{3}[ -]/.test(line) || line[3] === "-") continue;
        const code = Number(line.slice(0, 3));
        try {
          if (step === 0) {
            if (code !== 220) throw new Error(line);
            write("EHLO fmplus");
            step = 1;
          } else if (step === 1) {
            if (code !== 250) throw new Error(line);
            if (user) {
              write("AUTH LOGIN");
              step = 2;
            } else {
              write(`MAIL FROM:<${from}>`);
              step = 5;
            }
          } else if (step === 2) {
            if (code !== 334) throw new Error(line);
            write(Buffer.from(user, "utf8").toString("base64"));
            step = 3;
          } else if (step === 3) {
            if (code !== 334) throw new Error(line);
            write(Buffer.from(pass, "utf8").toString("base64"));
            step = 4;
          } else if (step === 4) {
            if (code !== 235) throw new Error(line);
            write(`MAIL FROM:<${from}>`);
            step = 5;
          } else if (step === 5) {
            if (code !== 250) throw new Error(line);
            write(`RCPT TO:<${recipients[rcptIdx]}>`);
            rcptIdx += 1;
            step = 6;
          } else if (step === 6) {
            if (code !== 250 && code !== 251) throw new Error(line);
            if (rcptIdx < recipients.length) {
              write(`RCPT TO:<${recipients[rcptIdx]}>`);
              rcptIdx += 1;
            } else {
              write("DATA");
              step = 7;
            }
          } else if (step === 7) {
            if (code !== 354) throw new Error(line);
            sock.write(`${payload}\r\n`);
            step = 8;
          } else if (step === 8) {
            if (code !== 250) throw new Error(line);
            write("QUIT");
            step = 9;
          } else if (step === 9) {
            ok({ ok: true, to: recipients });
          }
        } catch (err) {
          fail(err);
        }
      }
    });
  });
}
