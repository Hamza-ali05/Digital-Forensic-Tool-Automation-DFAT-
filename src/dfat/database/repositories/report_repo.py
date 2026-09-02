"""SQLAlchemy report repository implementing ``IReportRepository``."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dfat.core.interfaces.repository import IReportRepository
from dfat.core.models.report import ForensicReport
from dfat.database.exceptions import DatabaseError
from dfat.database.mappers import report_domain_to_orm, report_orm_to_domain
from dfat.database.models.evidence_orm import EvidenceRecordORM
from dfat.database.models.report_orm import ReportRecordORM


@dataclass(frozen=True)
class ReportSummaryRow:
    """Lightweight report list row without parsing JSON blobs."""

    report_id: str
    case_id: str
    case_name: str
    evidence_id: str
    evidence_name: str
    generated_at: datetime
    pipeline_duration_seconds: float
    llm_model_used: str


class SQLAlchemyReportRepository(IReportRepository):
    """Async SQLAlchemy implementation of the report repository port."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        """Initialise the report repository.

        Args:
            session_factory: Async SQLAlchemy session factory.
        """
        self._session_factory = session_factory

    async def save(self, entity: ForensicReport) -> str:  # type: ignore[override]
        """Persist a forensic report and return its identifier."""
        orm = report_domain_to_orm(entity)
        async with self._session_factory() as session:
            try:
                merged = await session.merge(orm)
                await session.commit()
                return str(merged.id)
            except SQLAlchemyError as exc:
                await session.rollback()
                raise DatabaseError(
                    "Failed to save report",
                    context={"report_id": entity.report_id, "error": str(exc)},
                ) from exc

    async def get(self, entity_id: str) -> Optional[ForensicReport]:  # type: ignore[override]
        """Load a forensic report by identifier."""
        async with self._session_factory() as session:
            try:
                orm = await session.get(ReportRecordORM, entity_id)
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "Failed to load report",
                    context={"report_id": entity_id, "error": str(exc)},
                ) from exc
            return report_orm_to_domain(orm) if orm is not None else None

    async def list_all(self) -> list[ForensicReport]:  # type: ignore[override]
        """List all forensic reports (newest first)."""
        async with self._session_factory() as session:
            try:
                result = await session.execute(
                    select(ReportRecordORM).order_by(ReportRecordORM.created_at.desc())
                )
                rows = result.scalars().all()
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "Failed to list reports",
                    context={"error": str(exc)},
                ) from exc
            return [report_orm_to_domain(row) for row in rows]

    async def list_summaries(self) -> list[ReportSummaryRow]:
        """List report metadata joined with evidence (no JSON parsing)."""
        async with self._session_factory() as session:
            try:
                result = await session.execute(
                    select(
                        ReportRecordORM.id,
                        ReportRecordORM.case_id,
                        ReportRecordORM.evidence_id,
                        ReportRecordORM.pipeline_duration_seconds,
                        ReportRecordORM.llm_model_used,
                        ReportRecordORM.created_at,
                        EvidenceRecordORM.file_path,
                        EvidenceRecordORM.case_name,
                    )
                    .join(
                        EvidenceRecordORM,
                        ReportRecordORM.evidence_id == EvidenceRecordORM.id,
                    )
                    .order_by(ReportRecordORM.created_at.desc())
                )
                rows = result.all()
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "Failed to list report summaries",
                    context={"error": str(exc)},
                ) from exc
            summaries: list[ReportSummaryRow] = []
            for row in rows:
                summaries.append(
                    ReportSummaryRow(
                        report_id=str(row.id),
                        case_id=str(row.case_id),
                        case_name=str(row.case_name or "Unknown"),
                        evidence_id=str(row.evidence_id),
                        evidence_name=Path(row.file_path).name if row.file_path else "",
                        generated_at=row.created_at,
                        pipeline_duration_seconds=float(row.pipeline_duration_seconds),
                        llm_model_used=str(row.llm_model_used or ""),
                    )
                )
            return summaries

    async def delete(self, entity_id: str) -> bool:  # type: ignore[override]
        """Delete a forensic report by identifier."""
        async with self._session_factory() as session:
            try:
                orm = await session.get(ReportRecordORM, entity_id)
                if orm is None:
                    return False
                await session.delete(orm)
                await session.commit()
                return True
            except SQLAlchemyError as exc:
                await session.rollback()
                raise DatabaseError(
                    "Failed to delete report",
                    context={"report_id": entity_id, "error": str(exc)},
                ) from exc

    async def get_by_case(self, case_id: str) -> list[ForensicReport]:
        """List reports for a case.

        Args:
            case_id: Case identifier.

        Returns:
            Matching forensic reports.
        """
        async with self._session_factory() as session:
            try:
                result = await session.execute(
                    select(ReportRecordORM).where(ReportRecordORM.case_id == case_id)
                )
                rows = result.scalars().all()
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "Failed to list reports by case",
                    context={"case_id": case_id, "error": str(exc)},
                ) from exc
            return [report_orm_to_domain(row) for row in rows]

    async def get_by_evidence(self, evidence_id: str) -> Optional[ForensicReport]:
        """Load the latest report for an evidence ID.

        Args:
            evidence_id: Evidence identifier.

        Returns:
            Forensic report if found; otherwise ``None``.
        """
        async with self._session_factory() as session:
            try:
                result = await session.execute(
                    select(ReportRecordORM)
                    .where(ReportRecordORM.evidence_id == evidence_id)
                    .order_by(ReportRecordORM.created_at.desc())
                    .limit(1)
                )
                orm = result.scalar_one_or_none()
            except SQLAlchemyError as exc:
                raise DatabaseError(
                    "Failed to load report by evidence",
                    context={"evidence_id": evidence_id, "error": str(exc)},
                ) from exc
            return report_orm_to_domain(orm) if orm is not None else None
