import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
migrations = sorted(Path("worker/migrations").glob("*.sql"))
if not migrations:
    raise SystemExit("No D1 migrations found")
for migration in migrations:
    db.executescript(migration.read_text(encoding="utf-8"))

required = {
    "users", "sessions", "projects", "versions", "favorites", "follows",
    "comments", "reports", "analytics_events", "rate_limits"
}
actual = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
missing = required - actual
if missing:
    raise SystemExit(f"Missing tables after migrations: {sorted(missing)}")

db.execute("INSERT INTO users(id,github_id,username) VALUES('u1','gh1','creator')")
db.execute("INSERT INTO projects(id,slug,owner_id,name,summary,category) VALUES('p1','project-one','u1','Project One','A test summary','Mods')")
db.execute("INSERT INTO versions(id,project_id,version_number,game_versions,loaders) VALUES('v1','p1','1.0.0','[\"1.21.1\"]','[\"Fabric\"]')")
try:
    db.execute("INSERT INTO versions(id,project_id,version_number) VALUES('v2','p1','1.0.0')")
    raise SystemExit("Duplicate project version unexpectedly accepted")
except sqlite3.IntegrityError:
    pass
try:
    db.execute("INSERT INTO projects(id,slug,owner_id,name,summary,category) VALUES('p2','orphan','missing','Orphan','A test summary','Mods')")
    raise SystemExit("Foreign-key violation unexpectedly accepted")
except sqlite3.IntegrityError:
    pass
db.execute("INSERT INTO rate_limits(key,window_started,count) VALUES('test',100,1)")
print(f"Validated {len(migrations)} D1 migrations, {len(required)} tables, unique versions, foreign keys and rate-limit storage.")
