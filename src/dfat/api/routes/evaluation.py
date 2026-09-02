"""Benchmark evaluation and usability questionnaire API routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import PlainTextResponse

from dfat.api.dependencies import get_evaluation_service, require_permission, require_role
from dfat.api.schemas.requests import (
    BenchmarkRunRequest,
    LLMSummaryEvalRequest,
    ManualBaselineRequest,
    OfflineBenchmarkRequest,
    UsabilityRespondRequest,
)
from dfat.api.schemas.responses import (
    BenchmarkResponse,
    DatasetListResponse,
    LLMQualityResponse,
    ManualBaselineResponse,
    UsabilityDeleteResponse,
    UsabilitySubmitResponse,
)
from dfat.evaluation.llm_quality import LLMQualityResult
from dfat.core.models.evaluation import BenchmarkResult
from dfat.database.models.user import UserORM
from dfat.services.evaluation_service import EvaluationService

router = APIRouter(prefix="/evaluation", tags=["Evaluation"])


def _to_benchmark(result: BenchmarkResult) -> BenchmarkResponse:
    """Map BenchmarkResult to API response."""
    return BenchmarkResponse(
        benchmark_id=result.benchmark_id,
        dataset_name=result.dataset_name,
        precision=result.precision,
        recall=result.recall,
        f1_score=result.f1_score,
        time_to_triage_seconds=result.time_to_triage_seconds,
        artefacts_expected=result.artefacts_expected,
        artefacts_recovered=result.artefacts_recovered,
        false_positives=result.false_positives,
        false_negatives=result.false_negatives,
        evaluated_at=result.evaluated_at,
    )


def _to_llm_quality(result: LLMQualityResult) -> LLMQualityResponse:
    """Map ``LLMQualityResult`` to the API response model."""
    return LLMQualityResponse(
        evaluation_id=result.evaluation_id,
        dataset_name=result.dataset_name,
        summary_source=result.summary_source,
        citation_coverage=result.citation_coverage,
        cited_identifiers=result.cited_identifiers,
        expected_identifiers=result.expected_identifiers,
        hallucination_risk=result.hallucination_risk,
        hallucinated_ids=list(result.hallucinated_ids),
        fabricated_terms=list(result.fabricated_terms),
        uncertain_tag_count=result.uncertain_tag_count,
        section_completeness=result.section_completeness,
        usefulness_proxy=result.usefulness_proxy,
        accuracy_proxy=result.accuracy_proxy,
        evaluated_at=result.evaluated_at,
        notes=list(result.notes),
    )


@router.post(
    "/benchmark",
    response_model=BenchmarkResponse,
    status_code=status.HTTP_200_OK,
)
async def run_benchmark(
    body: BenchmarkRunRequest,
    user: UserORM = Depends(require_permission("evaluation", "create")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> BenchmarkResponse:
    """Run benchmark comparison against a local ground-truth dataset."""
    dataset = body.ground_truth_dataset or body.dataset_name or ""
    result = await evaluation_service.run_benchmark_for_dataset(
        evidence_id=body.evidence_id,
        ground_truth_dataset=dataset,
        dataset_source=body.dataset_source,
        user_id=str(user.id),
        ground_truth_path=body.ground_truth_path,
        dataset_name=body.dataset_name or dataset,
    )
    return _to_benchmark(result)


@router.post(
    "/benchmark/offline",
    response_model=BenchmarkResponse,
    status_code=status.HTTP_200_OK,
)
async def run_offline_benchmark(
    body: OfflineBenchmarkRequest,
    user: UserORM = Depends(require_permission("evaluation", "create")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> BenchmarkResponse:
    """Compare synthetic recovery of a local ground-truth dataset (no image)."""
    result = await evaluation_service.run_offline_benchmark(
        dataset_source=body.dataset_source,
        ground_truth_dataset=body.ground_truth_dataset,
        user_id=str(user.id),
        omit_count=body.omit_count,
        extra_false_positives=body.extra_false_positives,
        dataset_name=body.dataset_name,
    )
    return _to_benchmark(result)


@router.get("/benchmark/baseline", response_model=Optional[ManualBaselineResponse])
async def get_manual_baseline(
    _: UserORM = Depends(require_permission("evaluation", "read")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> Optional[ManualBaselineResponse]:
    """Return the stored operator-supplied manual TTT baseline."""
    record = evaluation_service.get_manual_baseline()
    if record is None:
        return None
    return ManualBaselineResponse(
        baseline_ttt_seconds=record.baseline_ttt_seconds,
        label=record.label,
        updated_at=record.updated_at,
    )


@router.put("/benchmark/baseline", response_model=ManualBaselineResponse)
async def put_manual_baseline(
    body: ManualBaselineRequest,
    _: UserORM = Depends(require_permission("evaluation", "create")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> ManualBaselineResponse:
    """Save the operator-supplied manual TTT baseline for RQ3 speedup."""
    record = evaluation_service.set_manual_baseline(
        body.baseline_ttt_seconds,
        label=body.label,
    )
    return ManualBaselineResponse(
        baseline_ttt_seconds=record.baseline_ttt_seconds,
        label=record.label,
        updated_at=record.updated_at,
    )


@router.post(
    "/llm-summary",
    response_model=LLMQualityResponse,
    status_code=status.HTTP_200_OK,
)
async def evaluate_llm_summary(
    body: LLMSummaryEvalRequest,
    user: UserORM = Depends(require_permission("evaluation", "create")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> LLMQualityResponse:
    """Score an investigative summary against artefacts (RQ2 automated metrics)."""
    result = await evaluation_service.evaluate_llm_summary(
        dataset_source=body.dataset_source,
        ground_truth_dataset=body.ground_truth_dataset,
        evidence_id=body.evidence_id,
        report_id=body.report_id,
        summary_text=body.summary_text,
        user_id=str(user.id),
    )
    return _to_llm_quality(result)


@router.get("/llm-summary/results", response_model=list[LLMQualityResponse])
async def list_llm_summary_results(
    _: UserORM = Depends(require_permission("evaluation", "read")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> list[LLMQualityResponse]:
    """List stored RQ2 summary-evaluation records."""
    return [_to_llm_quality(item) for item in evaluation_service.list_llm_summary_results()]


@router.get("/benchmark/results", response_model=list[BenchmarkResponse])
async def list_benchmark_results(
    _: UserORM = Depends(require_permission("evaluation", "read")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> list[BenchmarkResponse]:
    """List all stored benchmark results."""
    results = await evaluation_service.get_benchmark_results()
    return [_to_benchmark(item) for item in results]


@router.get("/benchmark/results/{benchmark_id}", response_model=BenchmarkResponse)
async def get_benchmark_result(
    benchmark_id: str,
    _: UserORM = Depends(require_permission("evaluation", "read")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> BenchmarkResponse:
    """Get a specific benchmark result by ID."""
    result = await evaluation_service.get_benchmark_result(benchmark_id)
    return _to_benchmark(result)


@router.get("/benchmark/performance")
async def get_benchmark_performance(
    dataset_name: str = Query(..., min_length=1),
    baseline_ttt: Optional[float] = Query(None, gt=0),
    _: UserORM = Depends(require_permission("evaluation", "read")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> dict:
    """Return performance analytics for a dataset's historical runs."""
    report = await evaluation_service.get_performance_report(
        dataset_name=dataset_name,
        baseline_ttt=baseline_ttt,
    )
    return report.model_dump(mode="json")


@router.get("/benchmark/datasets", response_model=DatasetListResponse)
async def list_benchmark_datasets(
    _: UserORM = Depends(require_permission("evaluation", "read")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> DatasetListResponse:
    """List available local DFRWS/CFReDS ground-truth datasets."""
    datasets = evaluation_service.list_datasets()
    return DatasetListResponse(
        dfrws=list(datasets.get("dfrws", [])),
        cfreds=list(datasets.get("cfreds", [])),
    )


# Legacy alias retained for older clients.
@router.get("/results", response_model=list[BenchmarkResponse], include_in_schema=False)
async def list_benchmark_results_legacy(
    _: UserORM = Depends(require_permission("evaluation", "read")),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> list[BenchmarkResponse]:
    """Legacy list endpoint — prefer ``/benchmark/results``."""
    results = await evaluation_service.get_benchmark_results()
    return [_to_benchmark(item) for item in results]


@router.post(
    "/usability/respond",
    response_model=UsabilitySubmitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_usability_response(
    body: UsabilityRespondRequest,
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> UsabilitySubmitResponse:
    """Submit an anonymised usability questionnaire response (no auth)."""
    try:
        participant_id = await evaluation_service.collect_usability_response(
            ratings=body.ratings,
            free_text=body.free_text,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
    return UsabilitySubmitResponse(participant_id=participant_id)


@router.get("/usability/questionnaire")
async def get_usability_questionnaire(
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> dict:
    """Return the ethics-locked questionnaire instrument definition."""
    return evaluation_service.get_questionnaire_instrument()


@router.get("/usability/results")
async def get_usability_results(
    _: UserORM = Depends(require_role(["admin", "investigator"])),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> dict:
    """Return usability analysis results (admin/investigator only)."""
    return await evaluation_service.get_usability_analysis()


@router.get("/usability/export", response_class=PlainTextResponse)
async def export_usability_responses(
    _: UserORM = Depends(require_role(["admin"])),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> Response:
    """Export anonymised usability responses (admin only)."""
    payload = await evaluation_service.export_usability_responses("json")
    return Response(content=payload, media_type="application/json")


@router.delete(
    "/usability/responses",
    response_model=UsabilityDeleteResponse,
)
async def delete_usability_responses(
    _: UserORM = Depends(require_role(["admin"])),
    evaluation_service: EvaluationService = Depends(get_evaluation_service),
) -> UsabilityDeleteResponse:
    """Delete all usability responses (ethics data destruction; admin only)."""
    deleted = await evaluation_service.delete_usability_responses()
    return UsabilityDeleteResponse(deleted_count=deleted)
