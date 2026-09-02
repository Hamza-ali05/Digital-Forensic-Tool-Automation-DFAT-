"""Unit tests for automated investigative-summary quality scoring (RQ2)."""

from __future__ import annotations

from dfat.core.enums import ArtefactCategory
from dfat.core.models.artefact import Artefact
from dfat.evaluation.llm_quality import LLMSummaryEvaluator


def test_template_summary_cites_identifiers() -> None:
    """Grounded template mentions artefact paths and scores above zero."""
    artefacts = [
        Artefact(
            category=ArtefactCategory.FILESYSTEM_METADATA,
            source_evidence_id="ev-1",
            raw_data={"path": "/windows/system32/evil.dll", "filename": "evil.dll"},
            source_path="/windows/system32/evil.dll",
        ),
        Artefact(
            category=ArtefactCategory.BROWSER_HISTORY,
            source_evidence_id="ev-1",
            raw_data={"url": "http://malicious.example/payload"},
        ),
    ]
    evaluator = LLMSummaryEvaluator()
    summary = evaluator.build_template_summary(artefacts)
    result = evaluator.evaluate(
        summary,
        artefacts,
        dataset_name="dfrws_sample",
        summary_source="rule_fallback",
    )

    assert "evil.dll" in summary
    assert result.citation_coverage > 0.0
    assert result.expected_identifiers >= 2
    assert result.usefulness_proxy >= 0.0
    assert result.accuracy_proxy >= 0.0
    assert result.hallucination_risk in {"low", "medium", "high"}


def test_unrelated_summary_has_low_citation() -> None:
    """A summary that cites nothing should have zero coverage."""
    artefacts = [
        Artefact(
            category=ArtefactCategory.RUNNING_PROCESS,
            source_evidence_id="ev-1",
            raw_data={"name": "mimikatz.exe", "pid": 1337},
        )
    ]
    result = LLMSummaryEvaluator().evaluate(
        "No forensic content is discussed here.",
        artefacts,
        summary_source="operator_paste",
    )
    assert result.citation_coverage == 0.0
    assert result.cited_identifiers == 0
