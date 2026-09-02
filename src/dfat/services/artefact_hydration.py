"""Load and hydrate artefact sets from the store or latest forensic report."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Optional

from dfat.core.enums import ArtefactCategory, SuspicionLevel
from dfat.core.models.artefact import Artefact, ArtefactSet, RankedArtefact
from dfat.database.repositories.artefact_repo import SQLAlchemyArtefactRepository
from dfat.database.repositories.report_repo import SQLAlchemyReportRepository
from dfat.evidence_management.exceptions import EvidenceValidationError


def artefacts_from_report_rows(
    evidence_id: str,
    rows: list[dict],
) -> list[Artefact]:
    """Rebuild domain artefacts from serialised JSON report rows."""
    artefacts: list[Artefact] = []
    for row in rows:
        category_raw = row.get("category")
        if not category_raw:
            continue
        try:
            category = ArtefactCategory(str(category_raw))
        except ValueError:
            continue
        base_kwargs = {
            "artefact_id": str(row.get("artefact_id") or uuid.uuid4()),
            "category": category,
            "source_evidence_id": evidence_id,
            "raw_data": dict(row.get("raw_data") or {}),
            "source_path": row.get("source_path"),
            "metadata": dict(row.get("metadata") or {}),
        }
        suspicion_raw = row.get("suspicion_level")
        if suspicion_raw is not None:
            try:
                suspicion = SuspicionLevel(str(suspicion_raw))
            except ValueError:
                suspicion = SuspicionLevel.INFORMATIONAL
            artefacts.append(
                RankedArtefact(
                    **base_kwargs,
                    suspicion_level=suspicion,
                    relevance_score=float(row.get("relevance_score") or 0.0),
                    classification_reasoning=row.get("classification_reasoning"),
                )
            )
        else:
            artefacts.append(Artefact(**base_kwargs))
    return artefacts


async def load_artefact_set_for_evidence(
    artefact_repo: SQLAlchemyArtefactRepository,
    report_repo: Optional[SQLAlchemyReportRepository],
    evidence_id: str,
    *,
    persist: bool = True,
) -> Optional[ArtefactSet]:
    """Load artefacts for evidence, hydrating from the latest report when needed."""
    artefact_set = await artefact_repo.get(evidence_id)
    if artefact_set is not None and artefact_set.artefacts:
        return artefact_set

    if report_repo is None:
        return artefact_set if artefact_set is not None and artefact_set.artefacts else None

    report = await report_repo.get_by_evidence(evidence_id)
    report_rows = list(report.json_report.artefact_data) if report is not None else []
    if not report_rows and report is not None:
        document = report.json_report.model_dump(mode="json")
        alt = document.get("artefacts")
        if isinstance(alt, list):
            report_rows = alt

    if not report_rows:
        return None

    artefacts = artefacts_from_report_rows(evidence_id, report_rows)
    if not artefacts:
        return None

    categories = sorted(
        {artefact.category for artefact in artefacts},
        key=lambda item: item.value,
    )
    hydrated = ArtefactSet(
        evidence_id=evidence_id,
        artefacts=artefacts,
        categories_present=categories,
        extraction_timestamp=(
            report.json_report.generated_at if report else datetime.now(UTC)
        ),
    )
    if persist:
        await artefact_repo.save(hydrated)
    return hydrated


async def require_artefact_set_for_evidence(
    artefact_repo: SQLAlchemyArtefactRepository,
    report_repo: Optional[SQLAlchemyReportRepository],
    evidence_id: str,
    *,
    purpose: str = "analysis",
    persist: bool = True,
    allow_empty: bool = False,
) -> ArtefactSet:
    """Load artefacts or raise a validation error with a purpose-specific message."""
    artefact_set = await load_artefact_set_for_evidence(
        artefact_repo,
        report_repo,
        evidence_id,
        persist=persist,
    )
    if artefact_set is not None and artefact_set.artefacts:
        return artefact_set

    if allow_empty:
        return ArtefactSet(evidence_id=evidence_id, artefacts=[])

    if purpose == "benchmark":
        message = (
            "No artefacts are available to benchmark for this evidence. Run the pipeline "
            "on a valid forensic image that yields parsed artefacts, or use Offline "
            "Benchmark to compare against ground truth without an image."
        )
    else:
        message = (
            "No artefacts are available for this evidence. Run the analysis pipeline on "
            "evidence that yields parsed artefacts, then retry."
        )

    raise EvidenceValidationError(
        message,
        validation_failures=[
            "No parsed artefacts found in the artefact store or latest forensic report."
        ],
        context={"evidence_id": evidence_id, "purpose": purpose},
    )
