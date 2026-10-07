"""Minimal Supabase REST client for local scripts (service key, bypasses RLS). Standard library only."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

COLUMNS = {
    "id", "title", "org", "market", "location", "remote", "rate", "ir35", "duration", "posted", "deadline",
    "next_date", "fit", "status", "why", "caveat", "url", "contact", "next_step", "notes", "cv", "job_description",
}
DATE_COLUMNS = {"posted", "deadline", "next_date"}
MARKETS = {"UK", "NL", "EU", "Global"}
FITS = {"Strong", "Good", "Stretch"}
STATUSES = {"Shortlist", "Applied", "Interviewing", "Offer", "Won", "Rejected", "Closed", "Parked"}


def load_env(root: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    dotenv = root / ".env"
    if dotenv.exists():
        for line in dotenv.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(key):
            raise SystemExit(f"Missing {key}. Add it to .env (see .env.example).")
    return env


def upsert_roles(rows: list[dict], env: dict[str, str]) -> None:
    if not rows:
        return
    req = urllib.request.Request(
        f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/roles?on_conflict=id",
        data=json.dumps(rows).encode(),
        method="POST",
        headers={
            "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
            "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status not in (200, 201, 204):
                raise SystemExit(f"Upsert failed: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Upsert failed: HTTP {e.code}: {e.read().decode()[:500]}") from e
