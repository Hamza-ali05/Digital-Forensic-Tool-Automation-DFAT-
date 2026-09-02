"""Unit tests for synthetic ground-truth recovery used by offline evaluation."""

from __future__ import annotations

from dfat.core.enums import ArtefactCategory
from dfat.evaluation.benchmark.synthetic_recovery import SyntheticRecoveryBuilder


def test_synthetic_recovery_omit_and_false_positives(sample_ground_truth) -> None:
    """Kept artefacts plus decoys produce a controlled FN/FP mix."""
    builder = SyntheticRecoveryBuilder()
    recovered = builder.build(
        sample_ground_truth,
        omit_count=2,
        extra_false_positives=2,
    )

    expected = len(sample_ground_truth.artefacts)
    assert recovered.total_count == expected - 2 + 2
    assert all(item.source_evidence_id == recovered.evidence_id for item in recovered.artefacts)
    decoys = [
        item
        for item in recovered.artefacts
        if item.metadata.get("role") == "false_positive"
    ]
    assert len(decoys) == 2
    assert ArtefactCategory.FILESYSTEM_METADATA in recovered.categories_present


def test_synthetic_recovery_can_keep_all_expected(sample_ground_truth) -> None:
    """omit_count=0 recovers every ground-truth entry."""
    recovered = SyntheticRecoveryBuilder().build(
        sample_ground_truth,
        omit_count=0,
        extra_false_positives=0,
    )
    assert recovered.total_count == len(sample_ground_truth.artefacts)
