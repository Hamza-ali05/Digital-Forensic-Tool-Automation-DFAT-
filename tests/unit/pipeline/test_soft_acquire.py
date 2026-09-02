"""Tests for pipeline soft-acquire detection."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from dfat.core.enums import EvidenceType, HashAlgorithm
from dfat.core.models.evidence import CaseMetadata, EvidenceImage
from dfat.pipeline import soft_acquire


def _evidence(path: Path) -> EvidenceImage:
    return EvidenceImage(
        evidence_id="ev-soft",
        file_path=path,
        evidence_type=EvidenceType.DISK_IMAGE,
        original_hash="a" * 64,
        hash_algorithm=HashAlgorithm.SHA256,
        file_size_bytes=path.stat().st_size,
        acquired_at=datetime.now(UTC),
        case=CaseMetadata(case_id="case-1", case_name="C", investigator="I"),
    )


def test_is_synthetic_disk_image_detects_tiny_fixture(tmp_path: Path) -> None:
    tiny = tmp_path / "inventory.dd"
    tiny.write_bytes(b"DFAT-E2E-FAKE-DISK-IMAGE\n")
    assert soft_acquire.is_synthetic_disk_image(tiny) is True


def test_should_soft_acquire_evidence_in_development(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tiny = tmp_path / "inventory.dd"
    tiny.write_bytes(b"x" * 1024)
    monkeypatch.setenv("DFAT_ENV", "development")
    monkeypatch.delenv("DFAT_E2E_SOFT_ACQUIRE", raising=False)
    assert soft_acquire.should_soft_acquire_evidence(_evidence(tiny)) is True


def test_should_not_soft_acquire_real_image_in_production(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    large = tmp_path / "disk.dd"
    large.write_bytes(b"x" * 70000)
    monkeypatch.setenv("DFAT_ENV", "production")
    monkeypatch.delenv("DFAT_E2E_SOFT_ACQUIRE", raising=False)
    assert soft_acquire.should_soft_acquire_evidence(_evidence(large)) is False


def test_should_skip_forensic_parsing_with_handler_context(tmp_path: Path) -> None:
    disk = tmp_path / "disk.dd"
    disk.write_bytes(b"x")
    evidence = _evidence(disk)
    assert soft_acquire.should_skip_forensic_parsing(
        evidence,
        {"soft_acquire": True},
    ) is True


def test_should_soft_acquire_on_disk_error_for_small_dev_image(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    medium = tmp_path / "disk.dd"
    medium.write_bytes(b"x" * 120_000)
    monkeypatch.setenv("DFAT_ENV", "development")
    assert soft_acquire.should_soft_acquire_on_disk_error(_evidence(medium)) is True


def test_should_not_soft_acquire_on_disk_error_in_production(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    medium = tmp_path / "disk.dd"
    medium.write_bytes(b"x" * 120_000)
    monkeypatch.setenv("DFAT_ENV", "production")
    assert soft_acquire.should_soft_acquire_on_disk_error(_evidence(medium)) is False
