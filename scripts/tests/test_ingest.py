import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ingest  # noqa: E402


def test_refuses_without_token(monkeypatch):
    monkeypatch.delenv("INGEST_TOKEN", raising=False)
    with pytest.raises(SystemExit, match="INGEST_TOKEN"):
        ingest.config()


def test_builds_add_payloads_in_batches(tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(ingest, "call", lambda cfg, body: sent.append(body) or {"added": [], "skipped": []})
    f = tmp_path / "new.json"
    f.write_text(json.dumps([{"title": f"T{i}", "org": "O", "market": "EU", "fit": "Good", "url": f"https://o/{i}"} for i in range(120)]))
    ingest.add({"url": "u", "token": "t"}, f)
    assert [len(b["roles"]) for b in sent] == [50, 50, 20]
    assert all(b["action"] == "add" for b in sent)
