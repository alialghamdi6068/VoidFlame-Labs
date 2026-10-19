# VoidFlame Labs — Security and DDoS protection

## What is implemented in the Worker

- Cloudflare-native per-IP request limits run before D1 queries: general API 300/minute, authentication 12/minute, upload endpoints 10/minute. The Worker returns HTTP 429 when a configured binding rejects a request.
- Request body size guard: JSON/API bodies are capped at 1 MiB and upload request bodies at 52 MiB before parsing; release and gallery files retain their stricter 50 MiB / 30 MiB and 8 MiB limits.
- Existing user/action limits remain as a second application layer.
- Security response headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and restrictive `Permissions-Policy`.
- The Worker fails closed with HTTP 503 if a configured native rate-limit binding errors; it does not silently skip an available protection layer.

## Required Cloudflare dashboard setup

Worker bindings are not a replacement for Cloudflare's network and HTTP DDoS protection. Complete these steps in the Cloudflare account that owns the production hostname:

1. **Use a custom domain proxied by Cloudflare** for the site/API where possible. Keep the API on the same site or same registrable domain to reduce third-party-cookie problems. Do not expose an origin server directly; restrict origin access to Cloudflare if you later add one.
2. Open **Security → Settings** and confirm Cloudflare DDoS protection is enabled for the proxied hostname. Keep the managed HTTP DDoS rules enabled.
3. Under **Security → WAF → Rate limiting rules** (menu/availability varies by plan), add limits before launch:
   - Authentication: expression `http.request.uri.path starts_with "/api/auth/"`; threshold **10 requests per IP per 60 seconds**; action **Block** for **10 minutes**.
   - Uploads: expression `http.request.method eq "POST" and (ends_with(http.request.uri.path, "/upload") or ends_with(http.request.uri.path, "/media"))`; threshold **12 requests per IP per 60 seconds**; action **Block** for **10 minutes**.
   - API baseline: expression `http.request.uri.path starts_with "/api/"`; threshold **300 requests per IP per 60 seconds**; action **Managed Challenge** or **Block** based on observed legitimate traffic.
4. If available on the plan, enable bot protections and managed WAF rules. Monitor Security Events and tune thresholds to avoid blocking shared school/mobile carrier IPs.
5. Set Cloudflare alerts/notifications for traffic spikes and review logs after any incident. Keep OAuth secrets in Worker secrets only; never place them in `config.js`.
6. Before public uploads, add malware scanning/quarantine and an abuse response process. Extension allowlists and MIME checks do not prove that an uploaded file is safe.

## Limits and honest guarantees

No application-level rule can guarantee protection from every DDoS attack. Cloudflare's network-level protection applies only when traffic reaches a protected Cloudflare hostname; a `workers.dev` URL or an unproxied origin may not have the same controls available as a configured custom domain. Rate limiting is approximate/distributed and can affect legitimate users behind shared IPs. Verify the dashboard rules and test ordinary user flows before relying on them.
