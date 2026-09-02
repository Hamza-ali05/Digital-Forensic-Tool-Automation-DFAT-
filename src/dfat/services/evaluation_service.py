"""Benchmark and usability evaluation services."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from dfat.ai_engine.fallback.rule_based import RuleBasedAnalyzer
from dfat.core.exceptions import EvidenceNotFoundError, GroundTruthNotFoundError
from dfat.core.models.artefact import ArtefactSet
from dfat.core.models.evaluation import BenchmarkResult, UsabilityResponse
from dfat.database.repositories.artefact_repo import SQLAlchemyArtefactRepository
from dfat.database.repositories.audit_repo import SQLAlchemyAuditRepository
from dfat.database.repositories.evaluation_repo import (
    SQLAlchemyBenchmarkRepository,
    SQLAlchemyUsabilityRepository,
)
from dfat.evaluation.baseline_store import ManualBaseline, ManualBaselineStore
from dfat.evaluation.benchmark.comparator import BenchmarkComparator
from dfat.evaluation.benchmark.dfrws_handler import GroundTruth
from dfat.evaluation.benchmark.ground_truth import GroundTruthLoader
from dfat.evaluation.benchmark.performance import PerformanceAnalyzer, PerformanceReport
from dfat.evaluation.benchmark.synthetic_recovery import SyntheticRecoveryBuilder
from dfat.evaluation.llm_eval_store import LLMEvalStore
from dfat.evaluation.llm_quality import LLMQualityResult, LLMSummaryEvaluator
from dfat.evaluation.usability.questionnaire import QuestionnaireInstrument
from dfat.evaluation.usability.response_analyzer import ResponseAnalyzer
from dfat.evaluation.usability.response_collector import ResponseCollector
from dfat.services.artefact_hydration import (
    load_artefact_set_for_evidence,
    require_artefact_set_for_evidence,
)


class EvaluationService:
    """Business logic for benchmark comparison and usability analysis."""

    def __init__(
        self,
        benchmark_repo: SQLAlchemyBenchmarkRepository,
        usability_repo: SQLAlchemyUsabilityRepository,
        benchmark_comparator: BenchmarkComparator,
        ground_truth_loader: GroundTruthLoader,
        audit_repo: SQLAlchemyAuditRepository,
        artefact_repo: SQLAlchemyArtefactRepository,
        response_collector: ResponseCollector,
        performance_analyzer: PerformanceAnalyzer,
        questionnaire: Optional[QuestionnaireInstrument] = None,
        report_repo: Any = None,
        output_dir: Optional[Path] = None,
    ) -> None:
        """Initialise the evaluation service."""
        self._benchmark_repo = benchmark_repo
        self._usability_repo = usability_repo
        self._comparator = benchmark_comparator
        self._ground_truth_loader = ground_truth_loader
        self._audit_repo = audit_repo
        self._artefact_repo = artefact_repo
        self._response_collector = response_collector
        self._performance_analyzer = performance_analyzer
        self._questionnaire = questionnaire or QuestionnaireInstrument()
        self._report_repo = report_repo
        store_root = Path(output_dir) if output_dir is not None else Path("./data/outputs")
        self._baseline_store = ManualBaselineStore(store_root / "manual_ttt_baseline.json")
        self._llm_eval_store = LLMEvalStore(store_root / "llm_summary_eval.jsonl")
        self._recovery = SyntheticRecoveryBuilder()
        self._llm_evaluator = LLMSummaryEvaluator()
        self._rule_analyzer = RuleBasedAnalyzer()

    async def run_benchmark(
        self,
        evidence_id: str,
        ground_truth_path: str,
        dataset_name: str,
        artefact_set: ArtefactSet,
        pipeline_start: datetime,
        pipeline_end: datetime,
        user_id: str,
    ) -> BenchmarkResult:
        """Compare recovered artefacts against ground truth and persist results."""
        ground_truth = self._ground_truth_loader.load(Path(ground_truth_path))
        name = dataset_name or ground_truth.dataset_name or dataset_name
        ground_truth.dataset_name = name
        return await self._comparator.compare(
            recovered=artefact_set,
            ground_truth=ground_truth,
            pipeline_start=pipeline_start,
            pipeline_end=pipeline_end,
            dataset_name=name,
            user_id=user_id,
        )

    async def run_benchmark_for_dataset(
        self,
        evidence_id: str,
        ground_truth_dataset: str,
        dataset_source: str,
        user_id: str,
        *,
        ground_truth_path: Optional[str] = None,
        dataset_name: Optional[str] = None,
    ) -> BenchmarkResult:
        """Run benchmark using a named local dataset (or explicit path)."""
        artefact_set = await require_artefact_set_for_evidence(
            self._artefact_repo,
            self._report_repo,
            evidence_id,
            purpose="benchmark",
        )

        ground_truth = self._load_named_ground_truth(
            ground_truth_dataset,
            dataset_source,
            ground_truth_path=ground_truth_path,
        )
        name = (
            dataset_name
            or ground_truth_dataset
            or ground_truth.dataset_name
            or "unknown"
        )
        ground_truth.dataset_name = name
        start, end = self._timing_window(artefact_set)
        return await self._comparator.compare(
            recovered=artefact_set,
            ground_truth=ground_truth,
            pipeline_start=start,
            pipeline_end=end,
            dataset_name=name,
            user_id=user_id,
        )

    async def run_offline_benchmark(
        self,
        dataset_source: str,
        ground_truth_dataset: str,
        user_id: str,
        *,
        omit_count: int = 2,
        extra_false_positives: int = 2,
        dataset_name: Optional[str] = None,
    ) -> BenchmarkResult:
        """Compare synthetic recovery of a local ground-truth file (no disk image).

        Used when DFRWS/CFReDS evidence images are not on disk. Recovers
        expected artefacts with a documented FN/FP mix, times rule-based
        triage, and persists precision/recall/F1.
        """
        ground_truth = self._load_named_ground_truth(
            ground_truth_dataset,
            dataset_source,
        )
        name = dataset_name or ground_truth_dataset or ground_truth.dataset_name
        ground_truth.dataset_name = name
        recovered = self._recovery.build(
            ground_truth,
            omit_count=omit_count,
            extra_false_positives=extra_false_positives,
        )
        start = datetime.now(UTC)
        self._rule_analyzer.analyze(recovered)
        end = datetime.now(UTC)
        if end <= start:
            end = start + timedelta(milliseconds=1)
        return await self._comparator.compare(
            recovered=recovered,
            ground_truth=ground_truth,
            pipeline_start=start,
            pipeline_end=end,
            dataset_name=name,
            user_id=user_id,
        )

    async def submit_usability_response(self, response: UsabilityResponse) -> str:
        """Persist an anonymised usability questionnaire response."""
        return await self._usability_repo.save(response)

    async def collect_usability_response(
        self,
        ratings: dict[str, int],
        free_text: Optional[str] = None,
    ) -> str:
        """Collect an anonymised questionnaire response via ``ResponseCollector``."""
        return await self._response_collector.collect_response(
            ratings=ratings,
            free_text=free_text,
        )

    async def get_benchmark_results(self) -> list[BenchmarkResult]:
        """List all stored benchmark results."""
        return await self._benchmark_repo.list_all()

    async def get_benchmark_result(self, benchmark_id: str) -> BenchmarkResult:
        """Load a single benchmark result by ID."""
        result = await self._benchmark_repo.get(benchmark_id)
        if result is None:
            raise EvidenceNotFoundError(
                f"Benchmark result not found: {benchmark_id}",
                context={"benchmark_id": benchmark_id},
            )
        return result

    async def get_performance_report(
        self,
        dataset_name: str,
        baseline_ttt: Optional[float] = None,
    ) -> PerformanceReport:
        """Build a performance analytics report for a dataset."""
        results = await self._performance_analyzer.get_historical_results(dataset_name)
        resolved = baseline_ttt
        if resolved is None:
            stored = self._baseline_store.load()
            if stored is not None:
                resolved = stored.baseline_ttt_seconds
        return self._performance_analyzer.generate_performance_report(
            results,
            baseline_ttt=resolved,
        )

    def get_manual_baseline(self) -> Optional[ManualBaseline]:
        """Return the stored operator-supplied manual TTT baseline."""
        return self._baseline_store.load()

    def set_manual_baseline(
        self,
        baseline_ttt_seconds: float,
        label: Optional[str] = None,
    ) -> ManualBaseline:
        """Persist the operator-supplied manual TTT baseline."""
        return self._baseline_store.save(baseline_ttt_seconds, label=label)

    async def evaluate_llm_summary(
        self,
        *,
        dataset_source: str = "dfrws",
        ground_truth_dataset: str = "",
        evidence_id: Optional[str] = None,
        report_id: Optional[str] = None,
        summary_text: Optional[str] = None,
        user_id: str = "",
    ) -> LLMQualityResult:
        """Score an investigative summary against artefacts (RQ2).

        Summary source order: explicit text, report narrative, then
        rule-based template from recovered/synthetic artefacts.
        """
        del user_id  # reserved for audit; scoring is metadata-only
        artefacts: list[Any] = []
        dataset_name = ground_truth_dataset or ""
        source = "operator_paste"

        if evidence_id:
            artefact_set = await load_artefact_set_for_evidence(
                self._artefact_repo,
                self._report_repo,
                evidence_id,
            )
            if artefact_set is not None:
                artefacts = list(artefact_set.artefacts)

        if not artefacts and ground_truth_dataset:
            ground_truth = self._load_named_ground_truth(
                ground_truth_dataset,
                dataset_source,
            )
            dataset_name = ground_truth.dataset_name
            recovered = self._recovery.build(
                ground_truth,
                omit_count=0,
                extra_false_positives=0,
            )
            artefacts = list(recovered.artefacts)

        text = (summary_text or "").strip()
        if text:
            source = "operator_paste"
        else:
            narrative = await self._load_narrative(report_id, evidence_id)
            if narrative:
                text = narrative
                source = "report_narrative"
            else:
                text = self._llm_evaluator.build_template_summary(artefacts)
                source = "rule_fallback"

        result = self._llm_evaluator.evaluate(
            text,
            artefacts,
            dataset_name=dataset_name,
            summary_source=source,
        )
        self._llm_eval_store.save(result)
        return result

    def list_llm_summary_results(self) -> list[LLMQualityResult]:
        """Return stored RQ2 summary-evaluation records."""
        return self._llm_eval_store.list_all()

    def list_datasets(self) -> dict[str, list[str]]:
        """List available local DFRWS/CFReDS datasets."""
        return self._ground_truth_loader.list_all_datasets()

    def get_questionnaire_instrument(self) -> dict[str, Any]:
        """Return the ethics-locked questionnaire instrument definition."""
        return {
            "instrument_version": self._questionnaire.INSTRUMENT_VERSION,
            "questions": list(self._questionnaire.QUESTIONS),
        }

    async def get_usability_analysis(self) -> dict[str, Any]:
        """Compute descriptive usability statistics via ``ResponseAnalyzer``."""
        responses = await self._usability_repo.get_all_responses()
        analyzer = ResponseAnalyzer(responses)
        report = analyzer.generate_evaluation_report()
        return report.model_dump(mode="json")

    async def export_usability_responses(self, format: str = "json") -> str:
        """Export anonymised usability responses."""
        return await self._response_collector.export_responses_anonymised(format)

    async def delete_usability_responses(self) -> int:
        """Destroy all usability responses (ethics data destruction)."""
        return await self._response_collector.delete_all_responses()

    def _load_named_ground_truth(
        self,
        ground_truth_dataset: str,
        dataset_source: str,
        *,
        ground_truth_path: Optional[str] = None,
    ) -> GroundTruth:
        """Load a named or path-specified ground-truth dataset."""
        if ground_truth_path:
            return self._ground_truth_loader.load(Path(ground_truth_path))
        source = (dataset_source or "dfrws").strip().lower()
        if source == "cfreds":
            return self._ground_truth_loader.load_cfreds(ground_truth_dataset)
        if source == "dfrws":
            return self._ground_truth_loader.load_dfrws(ground_truth_dataset)
        raise GroundTruthNotFoundError(
            f"Unknown dataset source: {dataset_source}",
            context={"dataset_source": dataset_source},
        )

    async def _load_narrative(
        self,
        report_id: Optional[str],
        evidence_id: Optional[str],
    ) -> str:
        """Return stored report narrative text when a report repository is wired."""
        if self._report_repo is None:
            return ""
        report = None
        if report_id:
            getter = getattr(self._report_repo, "get", None)
            if callable(getter):
                report = await getter(report_id)
        if report is None and evidence_id:
            by_evidence = getattr(self._report_repo, "get_by_evidence", None)
            if callable(by_evidence):
                report = await by_evidence(evidence_id)
        if report is None:
            return ""
        narrative = getattr(report, "narrative_report", None)
        if narrative is None:
            return ""
        return str(getattr(narrative, "summary_text", "") or "")

    @staticmethod
    def _timing_window(artefact_set: ArtefactSet) -> tuple[datetime, datetime]:
        """Derive a TTT window from extraction time, else a 1ms floor."""
        end = datetime.now(UTC)
        start = artefact_set.extraction_timestamp
        if start.tzinfo is None:
            start = start.replace(tzinfo=UTC)
        if start >= end:
            start = end - timedelta(milliseconds=1)
        return start, end
