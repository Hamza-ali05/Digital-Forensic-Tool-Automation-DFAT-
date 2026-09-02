"""Offline benchmark and LLM-summary evaluation through EvaluationService."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from dfat.evaluation.benchmark.cfreds_handler import CFReDSHandler
from dfat.evaluation.benchmark.comparator import BenchmarkComparator
from dfat.evaluation.benchmark.dfrws_handler import DFRWSHandler
from dfat.evaluation.benchmark.ground_truth import GroundTruthLoader
from dfat.evaluation.benchmark.metrics import MetricsCalculator
from dfat.services.evaluation_service import EvaluationService


def _service(tmp_path: Path, fixtures_dir: Path) -> EvaluationService:
    """Build an EvaluationService backed by fixture ground truth."""
    gt_dir = fixtures_dir / "ground_truth"
    loader = GroundTruthLoader(
        gt_dir,
        DFRWSHandler(gt_dir),
        CFReDSHandler(gt_dir),
    )
    comparator = BenchmarkComparator(
        metrics=MetricsCalculator(),
        ground_truth_loader=loader,
        audit_service=AsyncMock(),
        benchmark_repo=AsyncMock(),
        thresholds={"precision_min": 0.0, "recall_min": 0.0, "f1_min": 0.0},
    )
    artefact_repo = AsyncMock()
    artefact_repo.save = AsyncMock(return_value="synthetic")
    artefact_repo.get = AsyncMock(return_value=None)
    return EvaluationService(
        benchmark_repo=AsyncMock(),
        usability_repo=AsyncMock(),
        benchmark_comparator=comparator,
        ground_truth_loader=loader,
        audit_repo=AsyncMock(),
        artefact_repo=artefact_repo,
        response_collector=AsyncMock(),
        performance_analyzer=MagicMock(),
        output_dir=tmp_path,
    )


@pytest.mark.asyncio
async def test_offline_benchmark_computes_metrics(
    tmp_path: Path,
    fixtures_dir: Path,
) -> None:
    """Synthetic recovery vs DFRWS fixture yields precision/recall/F1."""
    service = _service(tmp_path, fixtures_dir)
    result = await service.run_offline_benchmark(
        dataset_source="dfrws",
        ground_truth_dataset="dfrws_sample",
        user_id="user-1",
        omit_count=2,
        extra_false_positives=2,
    )
    assert result.artefacts_expected == 10
    assert result.false_negatives == 2
    assert result.false_positives == 2
    assert result.precision == pytest.approx(0.8)
    assert result.recall == pytest.approx(0.8)
    assert result.f1_score == pytest.approx(0.8)
    assert result.time_to_triage_seconds > 0


@pytest.mark.asyncio
async def test_evaluate_llm_summary_rule_fallback(
    tmp_path: Path,
    fixtures_dir: Path,
) -> None:
    """RQ2 scoring persists a result for the rule-based fallback summary."""
    service = _service(tmp_path, fixtures_dir)
    scored = await service.evaluate_llm_summary(
        dataset_source="dfrws",
        ground_truth_dataset="dfrws_sample",
        user_id="user-1",
    )
    assert scored.summary_source == "rule_fallback"
    assert scored.expected_identifiers > 0
    assert scored.citation_coverage > 0.0
    listed = service.list_llm_summary_results()
    assert len(listed) == 1
    assert listed[0].evaluation_id == scored.evaluation_id
