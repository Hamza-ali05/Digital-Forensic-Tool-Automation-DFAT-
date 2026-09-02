"""Tests for humanized pipeline error messages."""

from __future__ import annotations

from dfat.core.exceptions import DiskParsingError
from dfat.pipeline.error_messages import humanize_pipeline_error_text, pipeline_error_message


def test_humanize_filesystem_error() -> None:
    raw = (
        "[DiskParsingError] Failed to open filesystem at offset 0 "
        "(context: {'offset': 0, 'error': 'Cannot determine file system type'})"
    )
    message = humanize_pipeline_error_text(raw)
    assert "recognisable file system" in message
    assert "context:" not in message


def test_pipeline_error_message_uses_dfat_message() -> None:
    exc = DiskParsingError(
        "Failed to open filesystem at offset 0",
        context={"offset": 0, "error": "Cannot determine file system type"},
    )
    message = pipeline_error_message(exc)
    assert "recognisable file system" in message
