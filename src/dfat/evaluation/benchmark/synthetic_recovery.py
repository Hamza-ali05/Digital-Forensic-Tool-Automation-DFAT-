"""Build recovered artefact sets from local ground truth for offline evaluation.

Public DFRWS/CFReDS disk images are operator-supplied and may be absent.
This builder produces a recovered ``ArtefactSet`` from a ground-truth file so
precision/recall/F1 can be computed without a parsed evidence image.

The recovery model is explicit and deterministic:
- omit the last ``omit_count`` expected artefacts (false negatives)
- append ``extra_false_positives`` decoy artefacts (false positives)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from dfat.core.enums import ArtefactCategory
from dfat.core.models.artefact import Artefact, ArtefactSet
from dfat.evaluation.benchmark.dfrws_handler import GroundTruth, GroundTruthArtefact

_DECOY_RAW: list[tuple[ArtefactCategory, dict[str, Any]]] = [
    (
        ArtefactCategory.FILESYSTEM_METADATA,
        {
            "filename": "readme.txt",
            "path": "/users/public/readme.txt",
            "identifier": "/users/public/readme.txt",
        },
    ),
    (
        ArtefactCategory.BROWSER_HISTORY,
        {
            "url": "http://noise.invalid/index",
            "title": "Noise",
            "browser_type": "chrome",
        },
    ),
    (
        ArtefactCategory.RUNNING_PROCESS,
        {"name": "notepad.exe", "pid": 4242},
    ),
    (
        ArtefactCategory.EVENT_LOG,
        {"event_id": "1", "channel": "Application"},
    ),
]


class SyntheticRecoveryBuilder:
    """Construct a recovered artefact set from ground-truth entries."""

    def build(
        self,
        ground_truth: GroundTruth,
        *,
        evidence_id: str | None = None,
        omit_count: int = 2,
        extra_false_positives: int = 2,
    ) -> ArtefactSet:
        """Return recovered artefacts with a controlled FN/FP mix.

        Args:
            ground_truth: Loaded DFRWS/CFReDS ground truth.
            evidence_id: Optional evidence identifier for the set.
            omit_count: Number of expected artefacts to drop (false negatives).
            extra_false_positives: Number of decoy artefacts to append.

        Returns:
            ``ArtefactSet`` suitable for ``BenchmarkComparator.compare``.
        """
        eid = evidence_id or f"synthetic-{ground_truth.dataset_name}-{uuid4().hex[:8]}"
        expected = list(ground_truth.artefacts)
        keep_count = max(0, len(expected) - max(0, omit_count))
        kept = expected[:keep_count]

        artefacts = [self._from_expected(entry, eid) for entry in kept]
        decoy_n = max(0, extra_false_positives)
        for index in range(decoy_n):
            category, raw = _DECOY_RAW[index % len(_DECOY_RAW)]
            payload = dict(raw)
            payload["decoy_index"] = index
            artefacts.append(
                Artefact(
                    category=category,
                    source_evidence_id=eid,
                    raw_data=payload,
                    source_path=str(payload.get("path") or payload.get("url") or ""),
                    metadata={"synthetic": True, "role": "false_positive"},
                )
            )

        categories = sorted(
            {item.category for item in artefacts},
            key=lambda item: item.value,
        )
        return ArtefactSet(
            evidence_id=eid,
            artefacts=artefacts,
            categories_present=categories,
            extraction_timestamp=datetime.now(UTC),
        )

    @staticmethod
    def _from_expected(entry: GroundTruthArtefact, evidence_id: str) -> Artefact:
        """Map one ground-truth entry onto a recovered artefact."""
        raw = dict(entry.expected_data or {})
        if entry.identifier and "identifier" not in raw:
            raw["identifier"] = entry.identifier
        path = str(raw.get("path") or entry.identifier or "")
        return Artefact(
            category=entry.category,
            source_evidence_id=evidence_id,
            raw_data=raw,
            source_path=path or None,
            metadata={"synthetic": True, "role": "true_positive_candidate"},
        )
