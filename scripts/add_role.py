# /// script
# requires-python = ">=3.11"
# ///
"""Add or update one role. Used by Claude to log newly found roles.

Usage:
  uv run scripts/add_role.py --title "AI Engineer" --org "Acme" --market NL --fit Strong \
      --url https://... --why "..." [--rate ...] [--deadline 2026-10-31] [--id custom-id]
  uv run scripts/add_role.py --json role.json
Re-running with the same market/org/title updates the same row.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from supabase_rest import COLUMNS, DATE_COLUMNS, FITS, MARKETS, STATUSES, load_env, upsert_roles


def slugify(*parts: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", "-".join(parts).lower()).strip("-")[:80]


def build_row(fields: dict) -> dict:
    for required in ("title", "org", "market", "fit"):
        if not fields.get(required):
            raise ValueError(f"{required} is required")
    if fields["market"] not in MARKETS:
        raise ValueError(f"market must be one of {sorted(MARKETS)}")
    if fields["fit"] not in FITS:
        raise ValueError(f"fit must be one of {sorted(FITS)}")
    status = fields.get("status") or "Shortlist"
    if status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    row = {k: v for k, v in fields.items() if k in COLUMNS and v is not None}
    row["status"] = status
    row["id"] = fields.get("id") or slugify(fields["market"], fields["org"], fields["title"])
    for col in DATE_COLUMNS:
        if col in row and row[col] == "":
            row[col] = None
    return row


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", type=Path)
    for col in sorted(COLUMNS):
        p.add_argument(f"--{col.replace('_', '-')}", dest=col)
    args = vars(p.parse_args())
    fields = json.loads(args.pop("json").read_text()) if args.get("json") else {}
    fields.update({k: v for k, v in args.items() if v is not None and k != "json"})
    row = build_row(fields)
    upsert_roles([row], load_env(Path(__file__).resolve().parents[1]))
    print(f"Saved role {row['id']}")


if __name__ == "__main__":
    main()
