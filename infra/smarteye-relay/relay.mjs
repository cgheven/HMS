// Smart Eye / Hotel Eye relay — forwards portal requests from a Pakistani IP.
//
// The provincial government portals (hoteleye.punjab.gov.pk etc.) only answer
// Pakistani IPs, so HMS's server-side portal calls fail from Vercel (foreign
// IPs). This relay runs on a Pakistani box; HMS routes every portal request
// through it (see lib/hotel-eye-client.ts -> portalFetch, gated on
// HOTEL_EYE_PROXY_URL + HOTEL_EYE_PROXY_SECRET). See README.md to deploy.
//
// Listens only on localhost; a Cloudflare Tunnel exposes it. Node 18+ (fetch).
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.RELAY_SECRET;
if (!SECRET) {
  console.error("RELAY_SECRET is not set — refusing to start.");
  process.exit(1);
}

// SSRF guard: only ever forward to official Pakistani government portals over
// HTTPS. This box must never become an open proxy to arbitrary hosts.
function isAllowed(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === "https:" && (u.hostname === "gov.pk" || u.hostname.endsWith(".gov.pk"));
  } catch {
    return false;
  }
}

const PORTAL_PROBE_URL = "https://hoteleye.punjab.gov.pk/login/";

const server = createServer((req, res) => {
  // Shallow health check — public, no secret. A 200 here proves the box is up,
  // the relay process is running, and the Cloudflare Tunnel is routing. Point an
  // external uptime monitor at GET /health.
  if (req.method === "GET" && req.url.startsWith("/health") && !req.url.startsWith("/health/portal")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  // Deep check — verifies the portal STILL accepts this box's IP (catches an IP
  // change or a portal policy change that systemd can't). Secret-gated so it
  // can't be used to hammer the portal from outside.
  if (req.method === "GET" && req.url.startsWith("/health/portal")) {
    if (req.headers["x-relay-secret"] !== SECRET) { res.writeHead(401); res.end("unauthorized"); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    fetch(PORTAL_PROBE_URL, { redirect: "manual", signal: controller.signal })
      .then((r) => { res.writeHead(r.ok ? 200 : 502, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: r.ok, portalStatus: r.status })); })
      .catch((e) => { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e?.message || e) })); })
      .finally(() => clearTimeout(timer));
    return;
  }

  if (req.method !== "POST" || !req.url.startsWith("/fetch")) {
    res.writeHead(404); res.end("not found"); return;
  }
  if (req.headers["x-relay-secret"] !== SECRET) {
    res.writeHead(401); res.end("unauthorized"); return;
  }
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > 8_000_000) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", async () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { res.writeHead(400); res.end("bad json"); return; }

    const { method = "GET", url, headers = {}, body, redirect = "follow" } = payload;
    if (!isAllowed(url)) { res.writeHead(403); res.end("host not allowed"); return; }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const r = await fetch(url, { method, headers, body, redirect, signal: controller.signal });
      const buf = Buffer.from(await r.arrayBuffer());
      const outHeaders = {};
      r.headers.forEach((v, k) => { if (k.toLowerCase() !== "set-cookie") outHeaders[k.toLowerCase()] = v; });
      const setCookie = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: r.status,
        url: r.url,
        headers: outHeaders,
        setCookie,
        bodyBase64: buf.toString("base64"),
      }));
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    } finally {
      clearTimeout(timer);
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`smarteye-relay listening on 127.0.0.1:${PORT}`));
