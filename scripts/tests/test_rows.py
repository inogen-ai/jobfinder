import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from add_role import build_row, slugify  # noqa: E402
from migrate_from_artifact import artifact_doc_to_row, load_export  # noqa: E402
from supabase_rest import COLUMNS  # noqa: E402


def test_artifact_doc_maps_camel_fields_and_empty_dates():
    row = artifact_doc_to_row("nl-x", {
        "title": "AI Engineer", "org": "Interex", "market": "NL", "fit": "Strong", "status": "Shortlist",
        "next": "Send CV", "nextDate": "2026-10-07", "deadline": "", "posted": None,
        "created": "2026-10-05T12:00:00Z", "updated": "x",
    })
    assert row["id"] == "nl-x"
    assert row["next_step"] == "Send CV"
    assert row["next_date"] == "2026-10-07"
    assert row["deadline"] is None and row["posted"] is None
    assert "created" not in row and "updated" not in row and "next" not in row


def test_rows_with_different_source_keys_share_one_key_set():
    # PostgREST bulk upserts reject rows whose keys differ (PGRST102).
    a = artifact_doc_to_row("a", {"title": "A", "org": "O", "market": "UK", "fit": "Good", "nextDate": "2026-10-07"})
    b = artifact_doc_to_row("b", {"title": "B", "org": "O", "market": "EU", "fit": "Good", "contact": "x"})
    assert set(a) == set(b) == COLUMNS
    assert a["contact"] == "" and b["next_date"] is None


def test_load_export_reads_both_shapes(tmp_path: Path):
    (tmp_path / "roles").mkdir()
    (tmp_path / "roles" / "a.json").write_text(json.dumps({"id": "a", "data": {"title": "A", "org": "O", "market": "UK", "fit": "Good"}, "version": 1}))
    (tmp_path / "roles" / "b.json").write_text(json.dumps({"title": "B", "org": "O", "market": "EU", "fit": "Good"}))
    rows = sorted(load_export(tmp_path), key=lambda r: r["id"])
    assert [r["id"] for r in rows] == ["a", "b"]
    assert rows[1]["title"] == "B"


def test_slugify():
    assert slugify("NL", "Morgan Black", "GCP Data/AI Engineer") == "nl-morgan-black-gcp-data-ai-engineer"


def test_build_row_defaults_and_validation():
    row = build_row({"title": "T", "org": "O", "market": "NL", "fit": "Good"})
    # No status unless given: a new row gets the column default (Shortlist), an existing one keeps its status.
    assert row["id"] == "nl-o-t" and "status" not in row
    assert build_row({"title": "T", "org": "O", "market": "NL", "fit": "Good", "status": "Applied"})["status"] == "Applied"
    with pytest.raises(ValueError, match="market"):
        build_row({"title": "T", "org": "O", "market": "Mars", "fit": "Good"})
    with pytest.raises(ValueError, match="title"):
        build_row({"org": "O", "market": "NL", "fit": "Good"})
