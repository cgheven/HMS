# Smart Eye / Hotel Eye relay

The government portals (`hoteleye.punjab.gov.pk`, and the Sindh equivalent) only
accept connections from **Pakistani IPs**. HMS runs on Vercel (foreign IPs), so
its direct server-side portal calls fail with `fetch failed`. This relay runs on
a **Pakistani box** and forwards portal requests from there; HMS routes every
portal call through it.

**One relay serves all Smart Eye / Hotel Eye clients.** Each request carries that
client's own portal session — the relay is a dumb, host-restricted forwarder.

```
HMS (Vercel)  ──►  Cloudflare Tunnel  ──►  relay (this)  ──►  *.gov.pk portal
 portalFetch()      smarteye.yourpulse.io    localhost:8787     (accepts PK IP)
```

## HMS side (already in the app)
`lib/hotel-eye-client.ts` → `portalFetch()`. When these env vars are set on
Vercel (Production), all portal calls go through the relay; unset → direct fetch
(local dev on a Pakistani line):

- `HOTEL_EYE_PROXY_URL`   = `https://smarteye.yourpulse.io/fetch`
- `HOTEL_EYE_PROXY_SECRET` = the shared secret (same value as `RELAY_SECRET` on the box)

The relay preserves what the client depends on: the final post-redirect `url`,
`Set-Cookie` arrays, response headers, and raw body bytes (the CAPTCHA is binary).

## Box requirements
- A VPS or always-on machine on a **Pakistani ISP/datacenter** whose IP the
  portal accepts. Verify first — this must print `200`:
  ```
  curl -sS -o /dev/null -w "%{http_code}\n" --max-time 20 https://hoteleye.punjab.gov.pk/login/
  ```
- Node 18+ (20 recommended), `cloudflared`. Inbound ports may stay locked — the
  Cloudflare Tunnel is outbound-only.

## Deploy (AlmaLinux 9 example)

```bash
# 1. Node 20 + cloudflared
dnf module reset nodejs -y && dnf module enable nodejs:20 -y && dnf install -y nodejs
curl -L -o /tmp/cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
dnf install -y /tmp/cloudflared.rpm

# 2. relay code
mkdir -p /opt/smarteye
#   copy relay.mjs from this folder to /opt/smarteye/relay.mjs (scp or paste)

# 3. generate the shared secret (also set the SAME value in Vercel HOTEL_EYE_PROXY_SECRET)
openssl rand -hex 32
```

### relay service — `/etc/systemd/system/smarteye-relay.service`
```ini
[Unit]
Description=Smart Eye relay
After=network.target
[Service]
Environment=RELAY_SECRET=<PASTE_THE_SECRET>
Environment=PORT=8787
ExecStart=/usr/bin/node /opt/smarteye/relay.mjs
Restart=always
[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload && systemctl enable --now smarteye-relay
# sanity: unauthenticated call is rejected
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8787/fetch   # -> 401
```

### Cloudflare Tunnel (named, stable hostname)
1. Cloudflare **Zero Trust → Networks → Tunnels & Mesh → Create a tunnel →
   Cloudflared**, name it `smarteye`, copy the token.
2. On the box: `cloudflared service install <TOKEN>` (runs as a systemd service).
3. Tunnel → **Published application routes → Add**:
   `smarteye` . `yourpulse.io` → **HTTP** → `localhost:8787`.
4. Verify the stable URL is up (auth-protected):
   ```
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://smarteye.yourpulse.io/fetch   # -> 401
   ```

Both `smarteye-relay` and `cloudflared` are systemd services: auto-start on
boot, auto-restart on crash.

## Health check / troubleshooting
If Smart Eye sync fails in production, check in order:
```bash
systemctl status smarteye-relay cloudflared --no-pager   # both active (running)
journalctl -u smarteye-relay -n 50 --no-pager            # recent relay activity
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://smarteye.yourpulse.io/fetch   # 401 = reachable
# portal still accepts this box's IP:
curl -sS -o /dev/null -w "%{http_code}\n" https://hoteleye.punjab.gov.pk/login/         # 200
```
Tunnel health is also visible in the Cloudflare dashboard (Tunnels & Mesh →
`smarteye` → should be **HEALTHY**).

## Security notes
- The relay only forwards to `*.gov.pk` over HTTPS (SSRF guard), listens on
  localhost only, and requires the `x-relay-secret` header.
- The `RELAY_SECRET` is **never committed** — it lives in the systemd unit on the
  box and in Vercel's env. Rotate it by changing both places.
- The box must be under your sole control (it carries clients' portal sessions).
