"""Unit tests for the operator-supplied manual TTT baseline store (RQ3)."""

from __future__ import annotations

from pathlib import Path

from dfat.evaluation.baseline_store import ManualBaselineStore
from dfat.evaluation.llm_eval_store import LLMEvalStore
from dfat.evaluation.llm_quality import LLMQualityResult


def test_baseline_round_trip(tmp_path: Path) -> None:
    """Saving a baseline then loading it returns the same duration."""
    store = ManualBaselineStore(tmp_path / "baseline.json")
    assert store.load() is None
    saved = store.save(1800.0, label="manual Autopsy session")
    loaded = store.load()
    assert loaded is not None
    assert loaded.baseline_ttt_seconds == 1800.0
    assert loaded.label == "manual Autopsy session"
    assert saved.baseline_ttt_seconds == loaded.baseline_ttt_seconds


def test_llm_eval_store_appends(tmp_path: Path) -> None:
    """JSONL store keeps successive RQ2 results."""
    store = LLMEvalStore(tmp_path / "llm.jsonl")
    first = LLMQualityResult(
        dataset_name="dfrws_sample",
        summary_source="rule_fallback",
        citation_coverage=0.5,
        cited_identifiers=1,
        expected_identifiers=2,
        uncertain_tag_count=0,
        section_completeness=0.4,
        usefulness_proxy=0.4,
        accuracy_proxy=0.4,
    )
    store.save(first)
    rows = store.list_all()
    assert len(rows) == 1
    assert rows[0].dataset_name == "dfrws_sample"
