"""Tests for development soft-acquire fallback in EvidenceLoader."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from dfat.core.enums import EvidenceType, HashAlgorithm
from dfat.core.exceptions import DiskParsingError
from dfat.core.models.evidence import CaseMetadata, EvidenceImage
from dfat.pipeline.evidence_loader import EvidenceLoader


def _evidence(path: Path) -> EvidenceImage:
    return EvidenceImage(
        evidence_id="ev-soft-fallback",
        file_path=path,
        evidence_type=EvidenceType.DISK_IMAGE,
        original_hash="a" * 64,
        hash_algorithm=HashAlgorithm.SHA256,
        file_size_bytes=path.stat().st_size,
        acquired_at=datetime.now(UTC),
        case=CaseMetadata(case_id="case-1", case_name="C", investigator="I"),
    )


@pytest.mark.asyncio
async def test_loader_returns_soft_acquire_context_on_disk_error_in_dev(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image = tmp_path / "placeholder.dd"
    image.write_bytes(b"not-a-real-filesystem" * 5000)
    evidence = _evidence(image)
    monkeypatch.setenv("DFAT_ENV", "development")

    disk_handler = MagicMock()
    disk_handler.open_image.return_value = object()
    disk_handler.get_filesystem.side_effect = DiskParsingError(
        "Failed to open filesystem at offset 0",
        context={"offset": 0, "error": "Cannot determine file system type"},
    )

    loader = EvidenceLoader(
        disk_handler=disk_handler,
        memory_handler=MagicMock(),
        integrity_checker=MagicMock(verify_integrity=MagicMock(return_value=True)),
        hash_service=MagicMock(),
        audit_service=MagicMock(log_action=AsyncMock(return_value=None)),
    )

    loaded = await loader.load_evidence(evidence)
    assert loaded.handler_context.get("soft_acquire") is True
    disk_handler.close_image.assert_called_once()
