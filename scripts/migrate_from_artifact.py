# /// script
# requires-python = ">=3.11"
# ///
"""Upsert roles exported from the claude.ai Contract Pipeline into Supabase.

Usage: uv run scripts/migrate_from_artifact.py seed/
The export directory holds one JSON file per document, either the artifact store's
{"id", "data", "version"} shape or a bare document body (id = file stem).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from supabase_rest import COLUMNS, DATE_COLUMNS, load_env, upsert_roles

FIELD_MAP = {"next": "next_step", "nextDate": "next_date"}


def artifact_doc_to_row(doc_id: str, data: dict) -> dict:
    # Every row carries every column: PostgREST bulk upserts reject rows whose keys differ.
    row: dict = {col: (None if col in DATE_COLUMNS else "") for col in COLUMNS}
    row.update({"id": doc_id, "status": "Shortlist"})
    for key, value in data.items():
        col = FIELD_MAP.get(key, key)
        if col not in COLUMNS or col == "id":
            continue
        row[col] = (value or None) if col in DATE_COLUMNS else ("" if value is None else value)
    return row


def load_export(path: Path) -> list[dict]:
    rows = []
    for f in sorted(path.rglob("*.json")):
        obj = json.loads(f.read_text())
        if isinstance(obj, dict) and isinstance(obj.get("data"), dict):
            rows.append(artifact_doc_to_row(str(obj.get("id") or f.stem), obj["data"]))
        elif isinstance(obj, dict):
            rows.append(artifact_doc_to_row(f.stem, obj))
    return rows


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: uv run scripts/migrate_from_artifact.py <export-dir>")
    rows = load_export(Path(sys.argv[1]))
    upsert_roles(rows, load_env(Path(__file__).resolve().parents[1]))
    print(f"Upserted {len(rows)} roles.")


if __name__ == "__main__":
    main()
