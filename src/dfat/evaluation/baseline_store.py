"""Persist an operator-supplied manual time-to-triage baseline (RQ3).

The proposal requires comparison against a manual/baseline process. Measuring
Autopsy or Volatility by hand is operator work. This store keeps the number
they enter so performance analytics can compute speedup.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class ManualBaseline(BaseModel):
    """Stored manual triage duration for speedup comparison."""

    model_config = ConfigDict(frozen=False, validate_assignment=True)

    baseline_ttt_seconds: float = Field(gt=0)
    label: str = "manual Autopsy/Volatility (operator-supplied)"
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ManualBaselineStore:
    """JSON file store for the manual TTT baseline."""

    def __init__(self, path: Path) -> None:
        """Initialise the store.

        Args:
            path: JSON file path (created on first save).
        """
        self._path = Path(path)

    def load(self) -> Optional[ManualBaseline]:
        """Return the stored baseline, or ``None`` when unset/invalid."""
        if not self._path.is_file():
            return None
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        try:
            return ManualBaseline.model_validate(payload)
        except Exception:  # noqa: BLE001 — corrupt file is treated as unset
            return None

    def save(self, baseline_ttt_seconds: float, label: Optional[str] = None) -> ManualBaseline:
        """Persist a positive baseline duration.

        Args:
            baseline_ttt_seconds: Manual triage duration in seconds.
            label: Optional description of how the baseline was measured.

        Returns:
            Saved ``ManualBaseline``.
        """
        record = ManualBaseline(
            baseline_ttt_seconds=float(baseline_ttt_seconds),
            label=label or "manual Autopsy/Volatility (operator-supplied)",
        )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = record.model_dump(mode="json")
        self._path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return record
