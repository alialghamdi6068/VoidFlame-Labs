#!/usr/bin/env python3
"""VoidFlame Labs isolated malware scanner.

Never executes uploaded files. ClamAV is required for a verdict. YARA rules and
archive/byte heuristics add signals. Optional AI triage only sees extracted text
and indicators; it can raise a flag but can never declare a file clean.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import time
import zipfile
from datetime import datetime, timezone
from pathlib import PurePosixPath
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

import clamd
import yara
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CLAMD_HOST = os.getenv("CLAMD_HOST", "clamav")
CLAMD_PORT = int(os.getenv("CLAMD_PORT", "3310"))
POLL_SECONDS = max(5, int(os.getenv("POLL_SECONDS", "15")))
MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", str(100 * 1024 * 1024)))
AI_ENABLED = os.getenv("AI_ENABLED", "false").lower() == "true"
AI_API_BASE = os.getenv("AI_API_BASE", "https://api.openai.com/v1").rstrip("/")
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4.1-mini")

db = create_client(SUPABASE_URL, SERVICE_KEY)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_yara():
    rules_dir = os.path.join(os.path.dirname(__file__), "rules")
    rule_files = {
        f"rule_{i}": os.path.join(rules_dir, name)
        for i, name in enumerate(sorted(os.listdir(rules_dir)))
        if name.endswith((".yar", ".yara"))
    }
    if not rule_files:
        return None
    return yara.compile(filepaths=rule_files)


def get_clam():
    scanner = clamd.ClamdNetworkSocket(host=CLAMD_HOST, port=CLAMD_PORT, timeout=90)
    scanner.ping()
    return scanner


def archive_inspection(data: bytes) -> tuple[list[str], list[str]]:
    """Return deterministic findings and bounded text indicators without extraction."""
    findings: list[str] = []
    samples: list[str] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > 20000:
                findings.append("archive_entry_limit_exceeded")
                return findings, samples
            expanded = 0
            for info in infos:
                name = info.filename.replace("\\", "/")
                normalized = PurePosixPath(name)
                if name.startswith("/") or ".." in normalized.parts or re.match(r"^[A-Za-z]:", name):
                    findings.append("archive_path_traversal")
                if info.file_size < 0 or info.compress_size < 0:
                    findings.append("invalid_archive_size")
                    continue
                expanded += info.file_size
                if expanded > 500 * 1024 * 1024:
                    findings.append("archive_expansion_limit_exceeded")
                    break
                if info.file_size > 1024 * 1024 and info.compress_size == 0:
                    findings.append("suspicious_compression_ratio")
                elif info.compress_size > 0 and info.file_size / info.compress_size > 1000:
                    findings.append("suspicious_compression_ratio")
                low = name.lower()
                if low.endswith((".exe", ".dll", ".scr", ".ps1", ".bat", ".cmd", ".sh", ".msi", ".com")):
                    findings.append("unexpected_executable_in_archive")
                if low.endswith((".jar", ".zip", ".7z", ".rar")):
                    findings.append("nested_archive_requires_review")
                # Read only small, text-like members; never extract to disk or execute.
                if len(samples) < 30 and info.file_size <= 128 * 1024 and low.endswith(
                    (".txt", ".json", ".yml", ".yaml", ".properties", ".mf", ".xml", ".js", ".html")
                ):
                    try:
                        raw = archive.read(info)
                        text = raw.decode("utf-8", errors="ignore")
                        if text.strip():
                            samples.append(f"[{name}]\n{text[:3000]}")
                    except (OSError, RuntimeError, zipfile.BadZipFile):
                        findings.append("archive_member_read_error")
            return sorted(set(findings)), samples
    except zipfile.BadZipFile:
        # JAR/ZIP uploads must be parseable archives.
        return ["invalid_or_corrupt_zip_archive"], samples


def byte_indicators(data: bytes) -> tuple[list[str], str]:
    indicators: list[str] = []
    if data.startswith(b"MZ") or data.startswith(b"\x7fELF"):
        indicators.append("uploaded_file_is_native_executable")
    # These are triage signals, not proof of malware on their own.
    text = data[:8 * 1024 * 1024].decode("latin-1", errors="ignore").lower()
    patterns = {
        "powershell_download_cradle": r"powershell(?:\.exe)?[^\\n]{0,160}(?:downloadstring|invoke-webrequest|frombase64string)",
        "runtime_exec_reflection": r"(?:runtime\.getruntime\(\)\.exec|processbuilder|classloader\.defineclass)",
        "credential_or_token_theft_terms": r"(?:steal(?:er)?|discord.{0,20}token|login.?data|wallet.{0,20}dat)",
        "obfuscated_payload_markers": r"(?:frombase64string|base64\.decode|\\x[0-9a-f]{2})",
        "suspicious_network_download": r"(?:https?://[^\\s\"']{0,200}\.(?:exe|dll|ps1)|urlopen\(|wget\s+https?://)",
    }
    for label, pattern in patterns.items():
        if re.search(pattern, text):
            indicators.append(label)
    # Provide a small, printable, bounded sample for optional AI triage.
    printable = re.sub(r"[^\x09\x0a\x0d\x20-\x7e]", " ", data[:512 * 1024].decode("latin-1", errors="ignore"))
    return indicators, printable[:12000]


def ai_triage(indicators: list[str], archive_findings: list[str], samples: list[str], printable: str) -> dict:
    if not AI_ENABLED:
        return {"enabled": False, "available": False, "result": "disabled"}
    if not AI_API_KEY:
        return {"enabled": True, "available": False, "error": "AI_API_KEY is missing"}
    # Do not upload the binary. The model is advisory and may only add suspicion.
    payload = {
        "model": AI_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a cautious malware triage assistant for Minecraft JAR/ZIP submissions. "
                    "Analyze only the supplied static indicators and bounded text snippets. Never claim "
                    "you executed or fully scanned a file. Return JSON with risk (low|medium|high), "
                    "reasons (array of short strings), and confidence (0..1). Low risk is NOT proof of safety."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "static_indicators": indicators,
                    "archive_findings": archive_findings,
                    "text_snippets": samples[:15],
                    "printable_sample": printable[:6000],
                }, ensure_ascii=True),
            },
        ],
    }
    req = Request(
        f"{AI_API_BASE}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=25) as response:
            result = json.loads(response.read(256 * 1024).decode("utf-8"))
        content = result["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        risk = parsed.get("risk")
        if risk not in ("low", "medium", "high"):
            raise ValueError("AI returned an invalid risk value")
        reasons = parsed.get("reasons", [])
        return {
            "enabled": True, "available": True, "risk": risk,
            "confidence": min(1.0, max(0.0, float(parsed.get("confidence", 0)))),
            "reasons": [str(x)[:300] for x in reasons[:10]],
        }
    except (HTTPError, URLError, TimeoutError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        return {"enabled": True, "available": False, "error": type(exc).__name__}


def scan_bytes(data: bytes, filename: str, yara_rules) -> dict:
    result = {
        "engine": "VoidFlame Scanner",
        "scanned_at": now_iso(),
        "filename": filename,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "clamav": {"status": "not_run"},
        "yara_matches": [],
        "archive_findings": [],
        "static_indicators": [],
        "ai_triage": {},
    }
    if len(data) == 0 or len(data) > MAX_FILE_BYTES:
        result["archive_findings"] = ["file_size_out_of_policy"]
        result["verdict"] = "rejected"
        return result

    archive_findings, samples = archive_inspection(data)
    indicators, printable = byte_indicators(data)
    result["archive_findings"] = archive_findings
    result["static_indicators"] = indicators
    try:
        cd = get_clam()
        clam_result = cd.instream(io.BytesIO(data))
        status, signature = clam_result.get("stream", ("ERROR", "No ClamAV stream result"))
        result["clamav"] = {"status": status.lower(), "signature": str(signature)[:300]}
        if status == "ERROR":
            result["verdict"] = "pending_scan"
            result["error"] = "ClamAV could not complete scanning"
            return result
        if status == "FOUND":
            result["verdict"] = "rejected"
            return result
    except Exception as exc:
        result["clamav"] = {"status": "unavailable", "error": type(exc).__name__}
        result["verdict"] = "pending_scan"
        result["error"] = "Required ClamAV scanner unavailable; fail-closed"
        return result

    if yara_rules:
        try:
            result["yara_matches"] = [str(m.rule) for m in yara_rules.match(data=data, timeout=10)]
        except Exception as exc:
            result["yara_error"] = type(exc).__name__
            result["verdict"] = "pending_scan"
            result["error"] = "YARA scan did not complete"
            return result

    ai = ai_triage(indicators, archive_findings, samples, printable)
    result["ai_triage"] = ai
    severe_archive = any(x in archive_findings for x in (
        "archive_path_traversal", "archive_expansion_limit_exceeded",
        "archive_entry_limit_exceeded", "invalid_or_corrupt_zip_archive",
        "unexpected_executable_in_archive", "invalid_archive_size",
    ))
    if severe_archive or result["yara_matches"]:
        result["verdict"] = "flagged"
    elif ai.get("available") and ai.get("risk") == "high":
        result["verdict"] = "flagged"
    elif len(indicators) >= 2 or "suspicious_compression_ratio" in archive_findings:
        result["verdict"] = "flagged"
    else:
        result["verdict"] = "clean"
    return result


def process_version(version: dict, yara_rules):
    version_id = version["id"]
    file_path = version["file_path"]
    file_name = version.get("file_name") or "uploaded-file"
    print(f"[{now_iso()}] scanning version={version_id} name={file_name}", flush=True)
    try:
        payload = db.storage.from_("project-files").download(file_path)
        if not isinstance(payload, bytes):
            payload = bytes(payload)
        report = scan_bytes(payload, file_name, yara_rules)
        expected_sha = (version.get("sha256") or "").strip().lower()
        if expected_sha and report.get("sha256") != expected_sha:
            report["verdict"] = "flagged"
            report["integrity_error"] = "Stored SHA-256 does not match uploaded file"
        verdict = report.get("verdict", "pending_scan")
        if verdict not in ("clean", "flagged", "rejected", "pending_scan"):
            verdict = "pending_scan"
        notes = "Automated scan: " + verdict + ". " + json.dumps({
            "clamav": report.get("clamav"),
            "yara_matches": report.get("yara_matches", []),
            "archive_findings": report.get("archive_findings", []),
            "static_indicators": report.get("static_indicators", []),
            "ai_triage": report.get("ai_triage", {}),
            "integrity_error": report.get("integrity_error"),
            "error": report.get("error"),
        }, ensure_ascii=True)[:3800]
        update = {
            "security_status": verdict,
            "security_review_notes": notes,
            "security_scanned_at": report.get("scanned_at", now_iso()),
            "security_scan_engine": "VoidFlame Scanner / ClamAV / YARA / static heuristics",
            "security_scan_report": report,
            "security_scan_sha256": report.get("sha256"),
        }
        # If ClamAV/YARA failed, leave the row queued for retry; never mark clean.
        if verdict == "pending_scan":
            print(f"[{now_iso()}] incomplete scan; leaving queued: {version_id}", flush=True)
            return
        db.table("project_versions").update(update).eq("id", version_id).eq("security_status", "pending_scan").execute()
        db.table("moderation_logs").insert({
            "project_id": version.get("project_id"),
            "action": "automated_security_scan_" + verdict,
            "details": {
                "version_id": version_id,
                "sha256": report.get("sha256"),
                "engine": update["security_scan_engine"],
                "clamav": report.get("clamav"),
                "ai_triage": report.get("ai_triage"),
            },
        }).execute()
        print(f"[{now_iso()}] verdict={verdict} version={version_id}", flush=True)
    except Exception as exc:
        # Do not update security_status on infrastructure errors. It stays pending_scan.
        print(f"[{now_iso()}] scan error version={version_id}: {type(exc).__name__}", flush=True)


def main():
    try:
        yara_rules = load_yara()
    except Exception as exc:
        raise RuntimeError(f"YARA rule compilation failed: {type(exc).__name__}") from exc
    print("VoidFlame scanner started; uploaded files are never executed.", flush=True)
    while True:
        try:
            response = (
                db.table("project_versions")
                .select("id,project_id,file_path,file_name,file_size,sha256,security_status")
                .eq("security_status", "pending_scan")
                .order("created_at")
                .limit(3)
                .execute()
            )
            versions = response.data or []
            for version in versions:
                process_version(version, yara_rules)
        except Exception as exc:
            print(f"[{now_iso()}] queue error: {type(exc).__name__}", flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
