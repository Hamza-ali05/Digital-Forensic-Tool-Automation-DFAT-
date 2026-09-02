"""Tests for artefact hydration helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from dfat.core.enums import ArtefactCategory, HashAlgorithm
from dfat.core.models.artefact import Artefact, ArtefactSet
from dfat.core.models.evidence import CaseMetadata, EvidenceImage
from dfat.core.models.report import ForensicReport, JSONReport, NarrativeReport
from dfat.evidence_management.exceptions import EvidenceValidationError
from dfat.services.artefact_hydration import (
    load_artefact_set_for_evidence,
    require_artefact_set_for_evidence,
)


def _report(evidence_id: str, rows: list[dict]) -> ForensicReport:
    case = CaseMetadata(case_id="case-1", case_name="Case", investigator="Inv")
    json_report = JSONReport(
        report_id="rep-1",
        evidence_id=evidence_id,
        artefact_data=rows,
        schema_version="1.0",
        generated_at=datetime.now(UTC),
        integrity_hash="abc",
    )
    narrative = NarrativeReport(
        report_id="rep-1",
        evidence_id=evidence_id,
        summary_text="Summary",
        llm_model_used="test",
        generation_parameters={},
        generated_at=datetime.now(UTC),
    )
    return ForensicReport(
        report_id="rep-1",
        case=case,
        json_report=json_report,
        narrative_report=narrative,
        pipeline_duration_seconds=1.0,
    )


@pytest.mark.asyncio
async def test_load_artefact_set_hydrates_from_report() -> None:
    evidence_id = "ev-hydrate"
    artefact_repo = AsyncMock()
    artefact_repo.get = AsyncMock(return_value=None)
    artefact_repo.save = AsyncMock(return_value=evidence_id)
    report_repo = AsyncMock()
    report_repo.get_by_evidence = AsyncMock(
        return_value=_report(
            evidence_id,
            [
                {
                    "artefact_id": "art-1",
                    "category": ArtefactCategory.FILESYSTEM_METADATA.value,
                    "raw_data": {"path": "/tmp"},
                }
            ],
        )
    )

    loaded = await load_artefact_set_for_evidence(
        artefact_repo,
        report_repo,
        evidence_id,
    )
    assert loaded is not None
    assert len(loaded.artefacts) == 1
    artefact_repo.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_require_artefact_set_for_benchmark_raises_validation_error() -> None:
    artefact_repo = AsyncMock()
    artefact_repo.get = AsyncMock(return_value=None)
    report_repo = AsyncMock()
    report_repo.get_by_evidence = AsyncMock(return_value=None)

    with pytest.raises(EvidenceValidationError, match="benchmark"):
        await require_artefact_set_for_evidence(
            artefact_repo,
            report_repo,
            "ev-empty",
            purpose="benchmark",
        )


@pytest.mark.asyncio
async def test_require_artefact_set_allow_empty_returns_empty_set() -> None:
    artefact_repo = AsyncMock()
    artefact_repo.get = AsyncMock(return_value=None)
    report_repo = AsyncMock()
    report_repo.get_by_evidence = AsyncMock(return_value=None)

    loaded = await require_artefact_set_for_evidence(
        artefact_repo,
        report_repo,
        "ev-empty",
        allow_empty=True,
    )
    assert loaded.evidence_id == "ev-empty"
    assert loaded.artefacts == []
