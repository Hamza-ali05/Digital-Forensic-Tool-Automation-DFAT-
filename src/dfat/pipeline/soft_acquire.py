"""Detect synthetic or placeholder evidence for development / E2E soft-acquire."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

from dfat.core.enums import EvidenceType
from dfat.core.models.evidence import EvidenceImage

_E2E_MARKER = b"DFAT-E2E-FAKE-DISK-IMAGE"
_SYNTHETIC_MAX_BYTES = 65536
_DEV_SOFT_ACQUIRE_MAX_BYTES = 4 * 1024 * 1024

def is_soft_acquire_env_enabled() -> bool:
    """Return whether soft-acquire was explicitly enabled via environment."""
    return os.environ.get("DFAT_E2E_SOFT_ACQUIRE") == "1"


def is_development_env() -> bool:
    """Return whether the app is running in development mode."""
    return os.environ.get("DFAT_ENV", "development") == "development"


def is_synthetic_disk_image(path: Path) -> bool:
    """Return whether a disk image looks like a tiny E2E / placeholder fixture."""
    if not path.is_file():
        return False
    try:
        size = path.stat().st_size
    except OSError:
        return False
    if size <= _SYNTHETIC_MAX_BYTES:
        return True
    try:
        head = path.read_bytes()[:4096]
    except OSError:
        return False
    return _E2E_MARKER in head


def is_soft_acquire_handler_context(handler_context: Optional[dict[str, Any]]) -> bool:
    """Return whether acquisition returned a soft-acquire handler stub."""
    return bool(handler_context and handler_context.get("soft_acquire"))


def should_skip_forensic_parsing(
    evidence: EvidenceImage,
    handler_context: Optional[dict[str, Any]] = None,
) -> bool:
    """Return whether parsing stages should skip real forensic parsers."""
    if is_soft_acquire_handler_context(handler_context):
        return True
    return should_soft_acquire_evidence(evidence)


def should_soft_acquire_evidence(evidence: EvidenceImage) -> bool:
    """Return whether pipeline stages should skip real forensic handlers/parsers."""
    if is_soft_acquire_env_enabled():
        return True
    if evidence.evidence_type is not EvidenceType.DISK_IMAGE:
        return False
    if not is_development_env():
        return False
    return is_synthetic_disk_image(Path(evidence.file_path))


def should_soft_acquire_on_disk_error(evidence: EvidenceImage) -> bool:
    """Allow dev fallback when pytsk3 cannot open a small/placeholder image."""
    if not is_development_env():
        return False
    if evidence.evidence_type is not EvidenceType.DISK_IMAGE:
        return False
    path = Path(evidence.file_path)
    if is_synthetic_disk_image(path):
        return True
    try:
        size = path.stat().st_size
    except OSError:
        return False
    return size <= _DEV_SOFT_ACQUIRE_MAX_BYTES
