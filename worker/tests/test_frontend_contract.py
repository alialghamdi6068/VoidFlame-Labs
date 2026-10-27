from pathlib import Path

profile = Path("profile.html").read_text(encoding="utf-8")
admin = Path("admin.html").read_text(encoding="utf-8")
config = Path("config.js").read_text(encoding="utf-8")

checks = {
    "profile exposes account export": 'id="exportData"' in profile and 'api("/api/me/export")' in profile,
    "profile exposes session inventory": 'id="refreshSessions"' in profile and 'api("/api/me/sessions")' in profile,
    "profile revokes only other sessions": 'id="revokeSessions"' in profile and 'method:"DELETE"' in profile,
    "profile uses credentialed API requests": 'credentials:"include"' in profile,
    "moderation UI includes release review": 'data-tab="versions"' in admin and '/api/admin/versions?status=pending' in admin,
    "release moderation warns about missing malware scanning": "This is not malware scanning" in admin,
    "frontend configuration contains no backend secrets": "apiBaseUrl: \"\"" in config and "SUPABASE_SERVICE_ROLE_KEY" not in config and "GITHUB_CLIENT_SECRET" not in config,
}
failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + name)
if failed:
    raise SystemExit(f"{len(failed)} frontend contract(s) failed: {failed}")
print(f"Validated {len(checks)} frontend privacy and configuration contracts.")
