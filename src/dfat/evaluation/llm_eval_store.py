"""JSONL persistence for automated LLM-summary quality results (RQ2)."""

from __future__ import annotations

import json
from pathlib import Path

from dfat.evaluation.llm_quality import LLMQualityResult


class LLMEvalStore:
    """Append-only JSONL store for ``LLMQualityResult`` records."""

    def __init__(self, path: Path) -> None:
        """Initialise the store.

        Args:
            path: JSONL file path.
        """
        self._path = Path(path)

    def save(self, result: LLMQualityResult) -> str:
        """Append one result and return its evaluation id."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        line = result.model_dump_json()
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(line)
            handle.write("\n")
        return result.evaluation_id

    def list_all(self) -> list[LLMQualityResult]:
        """Load all stored results (newest last)."""
        if not self._path.is_file():
            return []
        results: list[LLMQualityResult] = []
        for raw in self._path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                results.append(LLMQualityResult.model_validate_json(line))
            except Exception:  # noqa: BLE001 — skip corrupt rows
                continue
        return results
