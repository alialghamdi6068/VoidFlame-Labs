# YARA rules

Place reviewed, trusted YARA rule files (*.yar) in this directory before building the scanner image.
The service also performs archive safety checks and ClamAV signature scanning.
Do not copy random rules from untrusted sources into production without reviewing them.
No bundled custom rules are shipped by default; ClamAV provides the primary signature database.
