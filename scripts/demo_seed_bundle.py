"""Service-layer demo data for DFAT UI modules (artefacts, reports, pipeline jobs)."""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures" / "sample_artefacts"

_SUSPICION_CYCLE = [
    "critical",
    "high",
    "medium",
    "low",
    "informational",
]


def _repo_src() -> None:
    src = REPO_ROOT / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


def _load_json(name: str) -> list[dict[str, Any]]:
    path = FIXTURES_DIR / name
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _identifier(raw: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = raw.get(key)
        if value:
            return str(value).lower()
    return str(uuid4())


def build_demo_artefact_set(evidence_id: str):
    """Build a rich artefact set from JSON fixtures for timeline/IOC/AI modules."""
    _repo_src()
    from dfat.core.enums import ArtefactCategory, SuspicionLevel
    from dfat.core.models.artefact import Artefact, ArtefactSet, RankedArtefact

    parsed_at = datetime.now(UTC) - timedelta(hours=2)
    artefacts: list[RankedArtefact] = []
    index = 0
    evidence_key = evidence_id.replace("-", "")[:8]

    mapping = [
        ("filesystem_metadata.json", ArtefactCategory.FILESYSTEM_METADATA, ("path",)),
        ("registry_entries.json", ArtefactCategory.REGISTRY_KEY, ("key_path",)),
        ("browser_history.json", ArtefactCategory.BROWSER_HISTORY, ("url",)),
        ("event_log_entries.json", ArtefactCategory.EVENT_LOG, ("event_id", "message")),
        ("memory_processes.json", ArtefactCategory.RUNNING_PROCESS, ("name", "pid")),
    ]

    for filename, category, id_keys in mapping:
        for row in _load_json(filename):
            raw = dict(row)
            raw["identifier"] = _identifier(raw, *id_keys)
            suspicion = SuspicionLevel(_SUSPICION_CYCLE[index % len(_SUSPICION_CYCLE)])
            score = round(max(0.35, 1.0 - (index % 5) * 0.12), 2)
            artefacts.append(
                RankedArtefact(
                    artefact_id=f"demo-{evidence_key}-{category.value[:6]}-{index:03d}",
                    category=category,
                    source_evidence_id=evidence_id,
                    raw_data=raw,
                    parsed_at=parsed_at + timedelta(minutes=index),
                    source_path=str(raw.get("path") or raw.get("url") or raw.get("key_path") or ""),
                    suspicion_level=suspicion,
                    relevance_score=score,
                    classification_reasoning=f"Demo seed ranking ({suspicion.value})",
                )
            )
            index += 1

    # Extra network IOC for the IOC dashboard.
    artefacts.append(
        RankedArtefact(
            artefact_id=f"demo-{evidence_key}-net-001",
            category=ArtefactCategory.NETWORK_CONNECTION,
            source_evidence_id=evidence_id,
            raw_data={
                "remote_address": "203.0.113.45",
                "remote_port": 443,
                "local_port": 49812,
                "protocol": "tcp",
                "process_name": "payload.exe",
                "identifier": "203.0.113.45:443",
            },
            parsed_at=parsed_at + timedelta(minutes=index),
            source_path="netstat",
            suspicion_level=SuspicionLevel.CRITICAL,
            relevance_score=0.98,
            classification_reasoning="Outbound connection to suspicious host",
        )
    )

    categories = sorted({item.category for item in artefacts}, key=lambda c: c.value)
    return ArtefactSet(
        evidence_id=evidence_id,
        artefacts=artefacts,
        categories_present=categories,
        extraction_timestamp=parsed_at,
    )


def _artefact_rows(artefact_set) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in artefact_set.artefacts:
        payload = item.model_dump(mode="json")
        rows.append(payload)
    return rows


def _integrity_hash(rows: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256(
        json.dumps(rows, sort_keys=True, default=str).encode("utf-8")
    )
    return digest.hexdigest()


def demo_artefact_count_fallback(count: int) -> int:
    """Use fixture-sized demo totals when a report was generated with zero artefacts."""
    if count and count > 0:
        return count
    sample = build_demo_artefact_set("count-probe")
    return len(sample.artefacts)


async def refresh_report_artefact_data(
    report_repo,
    report,
    artefact_set,
) -> int:
    """Ensure a report's JSON layer includes demo artefact rows."""
    rows = _artefact_rows(artefact_set)
    if not rows:
        return 0
    if report.json_report.artefact_data:
        return len(report.json_report.artefact_data)
    report.json_report.artefact_data = rows
    report.json_report.integrity_hash = _integrity_hash(rows)
    await report_repo.save(report)
    return len(rows)


async def refresh_all_empty_demo_reports(report_repo, artefact_repo) -> None:
    """Backfill empty report JSON for any evidence that already has demo artefacts."""
    summaries = await report_repo.list_summaries()
    refreshed = 0
    for summary in summaries:
        report = await report_repo.get(summary.report_id)
        if not report or report.json_report.artefact_data:
            continue
        evidence_id = report.json_report.evidence_id
        artefact_set = await artefact_repo.get(evidence_id)
        if artefact_set is None or not artefact_set.artefacts:
            try:
                artefact_set = build_demo_artefact_set(evidence_id)
                await artefact_repo.save(artefact_set)
            except Exception:
                artefact_set = build_demo_artefact_set(evidence_id)
        count = await refresh_report_artefact_data(report_repo, report, artefact_set)
        if count:
            refreshed += 1
    if refreshed:
        _print_bundle(f"  Refreshed {refreshed} empty report(s) with demo artefacts")


def build_demo_report(case_metadata, evidence_id: str, artefact_set):
    """Build a dual-output forensic report for the Reports / JSON viewer modules."""
    _repo_src()
    from dfat.core.models.report import ForensicReport, JSONReport, NarrativeReport

    rows = _artefact_rows(artefact_set)
    report_id = str(uuid4())
    now = datetime.now(UTC)
    narrative = (
        "## Executive summary\n"
        "Demo seed data: suspicious persistence, malicious downloads, and C2 beaconing "
        "were identified on the victim workstation.\n\n"
        "## Key findings\n"
        "- Registry Run key pointing to user AppData payload\n"
        "- Browser visits to malicious.example and c2.example\n"
        "- Process execution: mimikatz.exe and encoded PowerShell\n"
        "- Outbound TCP connection to 203.0.113.45:443\n\n"
        "## Recommended actions\n"
        "Isolate the host, preserve chain of custody, and correlate IOCs across cases."
    )
    json_report = JSONReport(
        report_id=report_id,
        evidence_id=evidence_id,
        artefact_data=rows,
        generated_at=now,
        integrity_hash=_integrity_hash(rows),
    )
    narrative_report = NarrativeReport(
        report_id=report_id,
        evidence_id=evidence_id,
        summary_text=narrative,
        llm_model_used="rule_engine+fallback_summary",
        generated_at=now,
    )
    return ForensicReport(
        report_id=report_id,
        case=case_metadata,
        json_report=json_report,
        narrative_report=narrative_report,
        pipeline_duration_seconds=42.5,
        stage_timings={
            "acquisition_s": 4.0,
            "parsing_s": 12.0,
            "triage_s": 8.5,
            "reporting_s": 6.0,
            "evaluation_s": 12.0,
        },
        audit_metadata={"seed": "demo_seed_bundle", "use_fallback": True},
    )


def _parsing_stage_with_parsers(artefact_count: int):
    """Build a completed parsing stage with realistic parser_results for demo UI."""
    _repo_src()
    from dfat.core.enums import ArtefactCategory, PipelineStage
    from dfat.pipeline.enums import ParserStatus, StageStatus
    from dfat.pipeline.models import ParserResult, StageExecution

    now = datetime.now(UTC)
    parser_defs = [
        ("FileSystemParser", ArtefactCategory.FILESYSTEM_METADATA, 5, 2.4),
        ("RegistryParser", ArtefactCategory.REGISTRY_KEY, 5, 1.8),
        ("BrowserParser", ArtefactCategory.BROWSER_HISTORY, 5, 1.6),
        ("EventLogParser", ArtefactCategory.EVENT_LOG, 5, 2.1),
        ("ProcessParser", ArtefactCategory.RUNNING_PROCESS, 5, 1.5),
        ("NetworkParser", ArtefactCategory.NETWORK_CONNECTION, 1, 0.9),
    ]
    parser_results = {
        name: ParserResult(
            parser_name=name,
            status=ParserStatus.COMPLETED,
            artefacts_found=count,
            duration_seconds=duration,
            category=category,
        )
        for name, category, count, duration in parser_defs
    }
    return StageExecution(
        stage=PipelineStage.PARSING,
        status=StageStatus.COMPLETED,
        started_at=now - timedelta(seconds=12.0),
        completed_at=now,
        duration_seconds=12.0,
        output_summary={"artefact_count": artefact_count, "seed": True},
        parser_results=parser_results,
    )


def _stage_execution(stage, status, *, duration: float = 1.0, errors: Optional[list[str]] = None):
    _repo_src()
    from dfat.core.enums import PipelineStage
    from dfat.pipeline.enums import StageStatus
    from dfat.pipeline.models import StageExecution

    now = datetime.now(UTC)
    return StageExecution(
        stage=PipelineStage(stage),
        status=StageStatus(status),
        started_at=now - timedelta(seconds=duration),
        completed_at=now,
        duration_seconds=duration,
        output_summary={"seed": True},
        errors=list(errors or []),
    )


def build_demo_pipeline_jobs(
    *,
    evidence_id: str,
    case_id: str,
    user_id: str,
    report_id: Optional[str] = None,
    artefact_count: int = 26,
) -> list:
    """Create pipeline jobs covering queued, running, completed, failed, and cancelled."""
    _repo_src()
    from dfat.core.enums import PipelineStage
    from dfat.pipeline.enums import JobStatus
    from dfat.pipeline.models import PipelineJob

    now = datetime.now(UTC)
    parsing_stage = _parsing_stage_with_parsers(artefact_count)
    jobs = [
        PipelineJob(
            job_id=str(uuid4()),
            evidence_id=evidence_id,
            case_id=case_id,
            user_id=user_id,
            status=JobStatus.COMPLETED,
            mode="full",
            use_fallback_analyzer=True,
            created_at=now - timedelta(hours=3),
            started_at=now - timedelta(hours=3),
            completed_at=now - timedelta(hours=2, minutes=40),
            total_duration_seconds=42.5,
            current_stage=PipelineStage.EVALUATION,
            stage_executions={
                PipelineStage.ACQUISITION.value: _stage_execution("acquisition", "completed", duration=4.0),
                PipelineStage.PARSING.value: parsing_stage,
                PipelineStage.AI_TRIAGE.value: _stage_execution("ai_triage", "completed", duration=8.5),
                PipelineStage.REPORTING.value: _stage_execution("reporting", "completed", duration=6.0),
                PipelineStage.EVALUATION.value: _stage_execution("evaluation", "completed", duration=12.0),
            },
            artefact_count=artefact_count,
            report_id=report_id,
        ),
        PipelineJob(
            job_id=str(uuid4()),
            evidence_id=evidence_id,
            case_id=case_id,
            user_id=user_id,
            status=JobStatus.FAILED,
            mode="full",
            use_fallback_analyzer=True,
            created_at=now - timedelta(hours=1),
            started_at=now - timedelta(hours=1),
            completed_at=now - timedelta(minutes=55),
            total_duration_seconds=5.2,
            current_stage=PipelineStage.PARSING,
            stage_executions={
                PipelineStage.ACQUISITION.value: _stage_execution("acquisition", "completed", duration=2.0),
                PipelineStage.PARSING.value: _stage_execution(
                    "parsing",
                    "failed",
                    duration=3.2,
                    errors=["DiskParsingError: placeholder image (demo failed job)"],
                ),
            },
            error_message="Parsing stage failed on placeholder evidence",
            artefact_count=0,
        ),
        PipelineJob(
            job_id=str(uuid4()),
            evidence_id=evidence_id,
            case_id=case_id,
            user_id=user_id,
            status=JobStatus.QUEUED,
            mode="parse-only",
            use_fallback_analyzer=True,
            created_at=now - timedelta(minutes=10),
            stage_executions={},
            artefact_count=0,
        ),
        PipelineJob(
            job_id=str(uuid4()),
            evidence_id=evidence_id,
            case_id=case_id,
            user_id=user_id,
            status=JobStatus.CANCELLED,
            mode="triage-only",
            use_fallback_analyzer=True,
            created_at=now - timedelta(minutes=30),
            started_at=now - timedelta(minutes=29),
            completed_at=now - timedelta(minutes=28),
            total_duration_seconds=60.0,
            current_stage=PipelineStage.PARSING,
            stage_executions={
                PipelineStage.ACQUISITION.value: _stage_execution("acquisition", "completed", duration=1.0),
                PipelineStage.PARSING.value: _stage_execution("parsing", "skipped"),
            },
            error_message="Cancelled by investigator (demo)",
            artefact_count=0,
        ),
    ]
    return jobs


async def enrich_completed_jobs_for_demo(
    pipeline_repo,
    *,
    evidence_id: str,
    case_id: str,
    report_id: str,
    artefact_count: int,
) -> None:
    """Link reports and parser outcomes to completed jobs for demo UI."""
    _repo_src()
    from dfat.core.enums import PipelineStage
    from dfat.pipeline.enums import JobStatus

    jobs = await pipeline_repo.list_jobs()
    parsing_stage = _parsing_stage_with_parsers(
        demo_artefact_count_fallback(artefact_count)
    )
    artefact_count = demo_artefact_count_fallback(artefact_count)
    enriched = 0

    for job in jobs:
        if job.status != JobStatus.COMPLETED:
            continue

        parsing = job.stage_executions.get(PipelineStage.PARSING.value)
        has_parsers = bool(parsing and parsing.parser_results)
        if job.report_id and has_parsers and job.artefact_count:
            continue

        if not job.report_id:
            job.report_id = report_id
        if not job.artefact_count:
            job.artefact_count = artefact_count
        if not has_parsers:
            job.stage_executions[PipelineStage.PARSING.value] = parsing_stage

        await pipeline_repo.save(job)
        enriched += 1

    if enriched:
        _print_bundle(f"  Enriched {enriched} completed pipeline job(s) with demo results")


async def ensure_demo_artefacts_and_report(
    *,
    case_id: str,
    evidence_id: str,
) -> dict[str, Any]:
    """Persist demo artefacts and a forensic report for one evidence item."""
    _repo_src()
    from dfat.container import build_application_container

    container = build_application_container()
    case_service = container.services.case_service()
    artefact_repo = container.repositories.artefact_repo()
    report_repo = container.repositories.report_repo()

    case = await case_service.get_case(case_id)
    case_metadata = case.metadata

    artefact_set = await artefact_repo.get(evidence_id)
    if artefact_set is None or not artefact_set.artefacts:
        artefact_set = build_demo_artefact_set(evidence_id)
        await artefact_repo.save(artefact_set)
        _print_bundle(f"  Saved {len(artefact_set.artefacts)} demo artefacts for {evidence_id[:8]}")

    existing_report = await report_repo.get_by_evidence(evidence_id)
    if existing_report is not None:
        report = existing_report
        refreshed = await refresh_report_artefact_data(
            report_repo, report, artefact_set
        )
        if refreshed:
            _print_bundle(
                f"  Refreshed report for {evidence_id[:8]} ({refreshed} artefacts)"
            )
    else:
        report = build_demo_report(case_metadata, evidence_id, artefact_set)
        await report_repo.save(report)
        _print_bundle(f"  Saved demo report {report.report_id[:8]} for {evidence_id[:8]}")

    artefact_count = len(report.json_report.artefact_data) or len(
        artefact_set.artefacts
    )
    return {
        "report_id": report.report_id,
        "artefact_count": artefact_count,
        "evidence_id": evidence_id,
    }


async def seed_forensic_bundle(
    *,
    case_id: str,
    evidence_id: str,
    admin_user_id: str,
) -> dict[str, Any]:
    """Persist artefacts, report, and sample pipeline jobs for demo UI modules."""
    _repo_src()
    from dfat.container import build_application_container

    container = build_application_container()
    db_engine = container.database.database_engine()
    settings = container.settings()
    if settings.database.create_tables_on_startup:
        import dfat.database  # noqa: F401

        await db_engine.create_tables()

    case_service = container.services.case_service()
    artefact_repo = container.repositories.artefact_repo()
    report_repo = container.repositories.report_repo()
    pipeline_repo = container.repositories.pipeline_repo()
    evidence_repo = container.repositories.evidence_repo()
    custody_service = container.services.chain_of_custody_service()

    case = await case_service.get_case(case_id)
    case_metadata = case.metadata

    await refresh_all_empty_demo_reports(report_repo, artefact_repo)

    artefact_set = await artefact_repo.get(evidence_id)
    if artefact_set is None or not artefact_set.artefacts:
        artefact_set = build_demo_artefact_set(evidence_id)
        await artefact_repo.save(artefact_set)
        _print_bundle(f"  Saved {len(artefact_set.artefacts)} demo artefacts")

    existing_report = await report_repo.get_by_evidence(evidence_id)
    if existing_report is not None:
        report = existing_report
        _print_bundle(f"  Report exists for evidence {evidence_id}")
        refreshed = await refresh_report_artefact_data(
            report_repo, report, artefact_set
        )
        if refreshed:
            _print_bundle(f"  Refreshed report JSON with {refreshed} demo artefacts")
    else:
        report = build_demo_report(case_metadata, evidence_id, artefact_set)
        await report_repo.save(report)
        _print_bundle(f"  Saved demo report {report.report_id}")

    artefact_count = len(report.json_report.artefact_data) or len(
        artefact_set.artefacts
    )

    existing_jobs = await pipeline_repo.list_jobs(case_id=case_id)
    has_parser_demo = any(
        (job.stage_executions.get("parsing") or None)
        and getattr(job.stage_executions.get("parsing"), "parser_results", None)
        for job in existing_jobs
    )
    if not has_parser_demo and len(existing_jobs) < 3:
        for job in build_demo_pipeline_jobs(
            evidence_id=evidence_id,
            case_id=case_id,
            user_id=admin_user_id,
            report_id=report.report_id,
            artefact_count=artefact_count,
        ):
            await pipeline_repo.save(job)
        _print_bundle("  Saved demo pipeline jobs (completed/failed/queued/cancelled)")
    else:
        _print_bundle(f"  Pipeline jobs already present for case ({len(existing_jobs)})")

    await enrich_completed_jobs_for_demo(
        pipeline_repo,
        evidence_id=evidence_id,
        case_id=case_id,
        report_id=report.report_id,
        artefact_count=artefact_count,
    )

    try:
        evidence = await evidence_repo.get(evidence_id)
        file_path = getattr(evidence, "file_path", None) if evidence else None
        if file_path:
            await custody_service.record_analysis(
                evidence_id=evidence_id,
                file_path=file_path,
                user_id=admin_user_id,
                user_name="DFAT Administrator",
                pipeline_id="demo-seed-pipeline",
            )
            await custody_service.record_access(
                evidence_id=evidence_id,
                file_path=file_path,
                user_id=admin_user_id,
                user_name="DFAT Administrator",
                reason="Demo seed integrity verification",
            )
    except Exception as exc:  # noqa: BLE001
        _print_bundle(f"  Custody extras skipped ({exc})")

    await db_engine.dispose()
    return {
        "report_id": report.report_id,
        "artefact_count": len(report.json_report.artefact_data),
    }


def _print_bundle(msg: str) -> None:
    print(msg, flush=True)
