from pathlib import Path
import re

source = Path("worker/src/index.js").read_text(encoding="utf-8")

checks = {
    "session cookies are HttpOnly and Secure": "HttpOnly; Secure" in source,
    "session signatures use HMAC SHA-256": 'hash:"SHA-256"' in source and 'name:"HMAC"' in source,
    "writes reject foreign or missing Origin": 'if (!requireSameOrigin(request, env)) return err("Origin not allowed",403);' in source,
    "session listing is user-scoped": 'WHERE user_id=? AND expires_at>datetime' in source,
    "session revocation is user-scoped": 'DELETE FROM sessions WHERE user_id=? AND id<>?' in source,
    "account export is authenticated": 'url.pathname === "/api/me/export"' in source and 'if(!user)return err("Sign in required",401);' in source[source.index('url.pathname === "/api/me/export"'):source.index('url.pathname === "/api/me/export"') + 250],
    "release upload checks file signature": 'hasExpectedSignature(file,ext,"release")' in source,
    "media upload checks file signature": 'hasExpectedSignature(file,ext,"media")' in source,
    "upload extension allowlist exists": '["jar","zip","mrpack","7z"]' in source,
    "API errors do not expose exception details": 'return json({error:"Internal server error" },500);' in source,
    "scheduled cleanup removes expired sessions": "DELETE FROM sessions WHERE expires_at <= datetime('now')" in source,
    "scheduled cleanup has analytics retention": "DELETE FROM analytics_events WHERE created_at < datetime('now','-180 days')" in source,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + name)
if failed:
    raise SystemExit(f"{len(failed)} security contract(s) failed: {failed}")
print(f"Validated {len(checks)} source-level security contracts.")
