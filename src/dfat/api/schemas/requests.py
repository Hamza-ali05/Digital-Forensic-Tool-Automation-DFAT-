"""Pydantic request models for the DFAT REST API."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from dfat.api.path_safety import assert_no_path_traversal

from dfat.core.enums import EvidenceType


class EvidenceUploadRequest(BaseModel):
    """Request body for registering forensic evidence."""

    file_path: str
    case_name: str
    investigator: str
    description: Optional[str] = None
    evidence_type: EvidenceType

    @field_validator("file_path")
    @classmethod
    def _reject_traversal(cls, value: str) -> str:
        return assert_no_path_traversal(value)


class AnalysisRunRequest(BaseModel):
    """Request body for starting a pipeline analysis run."""

    evidence_id: str
    mode: str = Field(default="full", pattern="^(full|parse-only|triage-only)$")
    use_fallback: bool = False


class PipelineRunRequest(BaseModel):
    """Request body for submitting a pipeline job."""

    evidence_id: str
    case_id: str
    mode: str = Field(default="full", pattern="^(full|parse-only|triage-only)$")
    use_fallback: bool = False


class BenchmarkRunRequest(BaseModel):
    """Request body for running a benchmark evaluation."""

    evidence_id: str
    ground_truth_dataset: str = ""
    dataset_source: Literal["dfrws", "cfreds"] = "dfrws"
    # Legacy fields retained for older clients / tests.
    ground_truth_path: Optional[str] = None
    dataset_name: Optional[str] = None


class OfflineBenchmarkRequest(BaseModel):
    """Run precision/recall against local ground truth without parsed evidence."""

    ground_truth_dataset: str = Field(min_length=1)
    dataset_source: Literal["dfrws", "cfreds"] = "dfrws"
    dataset_name: Optional[str] = None
    omit_count: int = Field(default=2, ge=0, le=50)
    extra_false_positives: int = Field(default=2, ge=0, le=50)


class ManualBaselineRequest(BaseModel):
    """Operator-supplied manual time-to-triage baseline (seconds)."""

    baseline_ttt_seconds: float = Field(gt=0)
    label: Optional[str] = None


class LLMSummaryEvalRequest(BaseModel):
    """Score an investigative summary against artefacts (RQ2)."""

    dataset_source: Literal["dfrws", "cfreds"] = "dfrws"
    ground_truth_dataset: str = ""
    evidence_id: Optional[str] = None
    report_id: Optional[str] = None
    summary_text: Optional[str] = None


class ReportCompareRequest(BaseModel):
    """Request body for reproducibility comparison of two reports."""

    report_id_a: str
    report_id_b: str


class UsabilityRespondRequest(BaseModel):
    """Anonymous usability questionnaire submission body."""

    ratings: dict[str, int] = Field(default_factory=dict)
    free_text: Optional[str] = None
