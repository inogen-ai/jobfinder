# /// script
# requires-python = ">=3.11"
# ///
"""Talk to the ingest-roles Edge Function (used by the daily search routine).

  INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest-roles INGEST_TOKEN=... \\
    python3 scripts/ingest.py list            # JSON of current roles: id, title, org, market, url, status, deadline, touched
    python3 scripts/ingest.py add new.json    # JSON array of roles in the tracker schema; batched by 50
    python3 scripts/ingest.py close close.json  # JSON array of {"id": ..., "reason": ...}
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BATCH = 50


def config() -> dict:
    token = os.environ.get("INGEST_TOKEN", "")
    url = os.environ.get("INGEST_URL", "https://unvfkjsgxmzqasrblszo.supabase.co/functions/v1/ingest-roles")
    if not token:
        raise SystemExit("Set INGEST_TOKEN (and optionally INGEST_URL).")
    return {"url": url, "token": token}


def call(cfg: dict, body: dict) -> dict:
    req = urllib.request.Request(cfg["url"], data=json.dumps(body).encode(), method="POST",
                                 headers={"x-ingest-token": cfg["token"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ingest-roles HTTP {e.code}: {e.read().decode()[:300]}") from e


def add(cfg: dict, path: Path) -> dict:
    roles = json.loads(Path(path).read_text())
    out = {"added": [], "skipped": []}
    for i in range(0, len(roles), BATCH):
        res = call(cfg, {"action": "add", "roles": roles[i:i + BATCH]})
        out["added"] += res.get("added", [])
        out["skipped"] += [{**s, "index": s["index"] + i} for s in res.get("skipped", [])]
    return out


def main() -> None:
    cfg = config()
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "list":
        print(json.dumps(call(cfg, {"action": "list"}), indent=1))
    elif cmd == "add" and len(sys.argv) == 3:
        print(json.dumps(add(cfg, Path(sys.argv[2])), indent=1))
    elif cmd == "close" and len(sys.argv) == 3:
        print(json.dumps(call(cfg, {"action": "close", "items": json.loads(Path(sys.argv[2]).read_text())}), indent=1))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
