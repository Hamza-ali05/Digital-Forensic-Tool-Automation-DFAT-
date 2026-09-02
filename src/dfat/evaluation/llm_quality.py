"""Automated usefulness/accuracy scoring for investigative summaries (RQ2).

Does not require a live LLM. Scores a summary against the artefact set it
claims to describe: identifier citation, hallucination risk, and completeness.
Operator-pasted LLaMA-3 output or report narratives can be scored the same way.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from dfat.ai_engine.validation.hallucination_guard import HallucinationGuard
from dfat.core.enums import ArtefactCategory, SuspicionLevel
from dfat.core.models.artefact import Artefact, ArtefactSet, RankedArtefact
from dfat.core.models.report import NarrativeReport


class LLMQualityResult(BaseModel):
    """Persisted RQ2 quality scores for one investigative summary."""

    model_config = ConfigDict(frozen=False, validate_assignment=True)

    evaluation_id: str = Field(default_factory=lambda: str(uuid4()))
    dataset_name: str = ""
    summary_source: str
    citation_coverage: float = Field(ge=0.0, le=1.0)
    cited_identifiers: int = Field(ge=0)
    expected_identifiers: int = Field(ge=0)
    hallucination_risk: str = "low"
    hallucinated_ids: list[str] = Field(default_factory=list)
    fabricated_terms: list[str] = Field(default_factory=list)
    uncertain_tag_count: int = Field(default=0, ge=0)
    section_completeness: float = Field(ge=0.0, le=1.0)
    usefulness_proxy: float = Field(ge=0.0, le=1.0)
    accuracy_proxy: float = Field(ge=0.0, le=1.0)
    evaluated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    notes: list[str] = Field(default_factory=list)


_SECTION_MARKERS = (
    "summary",
    "finding",
    "timeline",
    "ioc",
    "recommendation",
    "suspicion",
    "artefact",
    "key finding",
)

_TOKEN_KEYS = (
    "path",
    "filename",
    "url",
    "name",
    "identifier",
    "value_name",
    "key_path",
    "event_id",
    "remote_address",
    "pid",
)


class LLMSummaryEvaluator:
    """Score a narrative against the artefacts it should describe."""

    def evaluate(
        self,
        summary_text: str,
        artefacts: list[Artefact],
        *,
        dataset_name: str = "",
        summary_source: str = "unknown",
    ) -> LLMQualityResult:
        """Compute citation, hallucination, and completeness proxies.

        Args:
            summary_text: Investigative narrative to score.
            artefacts: Artefacts the summary should be grounded in.
            dataset_name: Optional dataset label.
            summary_source: ``llm``, ``report_narrative``, ``rule_fallback``,
                or ``operator_paste``.

        Returns:
            ``LLMQualityResult`` with usefulness/accuracy proxies in ``[0, 1]``.
        """
        text = summary_text or ""
        tokens = self._identifier_tokens(artefacts)
        cited = [token for token in tokens if self._mentioned(text, token)]
        expected = len(tokens)
        coverage = (len(cited) / expected) if expected else 0.0

        ids = {item.artefact_id for item in artefacts}
        categories = {item.value for item in ArtefactCategory}
        levels = {item.value for item in SuspicionLevel}
        facts = self._known_facts(artefacts)
        report = HallucinationGuard(ids, categories, levels, known_facts=facts).check_response(
            text
        )

        uncertain = len(re.findall(r"\[UNCERTAIN\]", text, flags=re.IGNORECASE))
        completeness = self._section_completeness(text)
        hallucination_penalty = {
            "low": 0.0,
            "medium": 0.2,
            "high": 0.45,
        }.get(report.risk_level, 0.2)

        accuracy = max(0.0, min(1.0, coverage * (1.0 - hallucination_penalty)))
        usefulness = max(
            0.0,
            min(1.0, 0.5 * coverage + 0.3 * completeness + 0.2 * (1.0 - hallucination_penalty)),
        )

        notes = [
            "Citation coverage is the share of artefact identifiers mentioned in the summary.",
            "Accuracy proxy down-weights coverage when hallucination risk is medium/high.",
            "Usefulness proxy blends citation, section completeness, and hallucination risk.",
            "These scores are automated and do not replace investigator Likert ratings (RQ5).",
        ]
        if summary_source == "rule_fallback":
            notes.append(
                "Summary was produced by the rule-based fallback (Ollama not required)."
            )

        return LLMQualityResult(
            dataset_name=dataset_name,
            summary_source=summary_source,
            citation_coverage=coverage,
            cited_identifiers=len(cited),
            expected_identifiers=expected,
            hallucination_risk=report.risk_level,
            hallucinated_ids=list(report.hallucinated_ids),
            fabricated_terms=list(report.fabricated_terms),
            uncertain_tag_count=uncertain,
            section_completeness=completeness,
            usefulness_proxy=usefulness,
            accuracy_proxy=accuracy,
            notes=notes,
        )

    def build_template_summary(self, artefacts: list[Artefact]) -> str:
        """Build a deterministic investigative summary from artefact fields.

        Used when no LLM or report narrative is available so RQ2 scoring still
        has a grounded text to evaluate (rule-based fallback path).
        """
        lines = [
            "Investigative summary",
            "Key findings:",
        ]
        for artefact in artefacts:
            token = self._primary_token(artefact) or artefact.artefact_id
            lines.append(
                f"- [{artefact.category.value}] {token}"
            )
        lines.extend(
            [
                "Timeline: derived from parsed artefact timestamps where present.",
                "IOC: identifiers listed above; treat as advisory pending investigator review.",
                "Recommendations: corroborate structured JSON artefacts before relying on narrative.",
                "This summary was produced by the rule-based fallback analyser (no LLM).",
            ]
        )
        return "\n".join(lines)

    def summary_from_report(self, report: NarrativeReport) -> str:
        """Return narrative text from a dual-output report."""
        return str(report.summary_text or "")

    def ranked_to_artefacts(self, ranked: list[RankedArtefact]) -> list[Artefact]:
        """Expose ranked artefacts as the base ``Artefact`` list."""
        return list(ranked)

    def from_artefact_set(self, artefact_set: ArtefactSet) -> list[Artefact]:
        """Return artefacts from a set."""
        return list(artefact_set.artefacts)

    @staticmethod
    def _identifier_tokens(artefacts: list[Artefact]) -> list[str]:
        """Collect distinctive identifier strings from artefact payloads."""
        tokens: list[str] = []
        seen: set[str] = set()
        for artefact in artefacts:
            raw = dict(artefact.raw_data or {})
            for key in _TOKEN_KEYS:
                value = str(raw.get(key) or "").strip()
                if not value or value.lower() in seen:
                    continue
                if len(value) < 3:
                    continue
                seen.add(value.lower())
                tokens.append(value)
            if artefact.source_path:
                path = artefact.source_path.strip()
                if path and path.lower() not in seen and len(path) >= 3:
                    seen.add(path.lower())
                    tokens.append(path)
        return tokens

    @staticmethod
    def _primary_token(artefact: Artefact) -> str:
        """Return the best human identifier for one artefact."""
        raw = dict(artefact.raw_data or {})
        for key in _TOKEN_KEYS:
            value = str(raw.get(key) or "").strip()
            if value:
                return value
        return str(artefact.source_path or "")

    @staticmethod
    def _mentioned(text: str, token: str) -> bool:
        """Return whether ``token`` appears in ``text`` (case-insensitive)."""
        haystack = text.lower()
        needle = token.lower().strip()
        if len(needle) < 3:
            return False
        if needle in haystack:
            return True
        # Paths may be written with either slash direction.
        alt = needle.replace("\\", "/")
        return alt in haystack.replace("\\", "/")

    @staticmethod
    def _section_completeness(text: str) -> float:
        """Share of expected investigative section markers present in ``text``."""
        lowered = text.lower()
        hits = sum(1 for marker in _SECTION_MARKERS if marker in lowered)
        return hits / float(len(_SECTION_MARKERS))

    @staticmethod
    def _known_facts(artefacts: list[Artefact]) -> set[str]:
        """Collect IP/domain/hash-like strings from artefact payloads."""
        facts: set[str] = set()
        for artefact in artefacts:
            raw = artefact.raw_data or {}
            for value in raw.values():
                if isinstance(value, str) and value.strip():
                    facts.add(value.strip().lower())
            if artefact.source_path:
                facts.add(artefact.source_path.lower())
        return facts
