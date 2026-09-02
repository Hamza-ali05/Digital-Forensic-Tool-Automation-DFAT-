"""Human-readable pipeline error messages for UI and job records."""

from __future__ import annotations

import re
from typing import Optional

from dfat.core.exceptions import DFATError

_CLASS_PREFIX = re.compile(r"^\[[A-Za-z]+Error\]\s*")
_CONTEXT_SUFFIX = re.compile(r"\s*\(context:\s*\{.*\}\)\s*$", re.DOTALL)


def _strip_technical_wrapper(text: str) -> str:
    """Remove ``[ErrorClass]`` prefixes and trailing context blobs."""
    cleaned = str(text or "").strip()
    cleaned = _CLASS_PREFIX.sub("", cleaned)
    cleaned = _CONTEXT_SUFFIX.sub("", cleaned).strip()
    return cleaned


def humanize_pipeline_error_text(
    text: str,
    *,
    exc_class: Optional[str] = None,
) -> str:
    """Convert a raw pipeline error string into investigator-friendly text."""
    original = str(text or "").strip()
    cls = exc_class or ""
    if not cls:
        inner = re.match(r"^\[([A-Za-z]+Error)\]", original)
        if inner:
            cls = inner.group(1)

    raw = _strip_technical_wrapper(original)
    lower = raw.lower()

    if (
        "cannot determine file system type" in lower
        or "failed to open filesystem" in lower
        or "unable to open the image as a filesystem" in lower
    ):
        return (
            "This disk image does not contain a recognisable file system. "
            "Use a valid forensic disk image (for example E01, DD, or raw) "
            "from data/datasets/ or a real acquisition, then run the pipeline again."
        )

    if cls == "DiskParsingError" or "diskparsingerror" in original.lower():
        if "failed to open disk image" in lower:
            return (
                "The disk image could not be opened. The file may be corrupt, "
                "truncated, or not a supported disk image format."
            )
        return (
            "The disk image could not be parsed. Verify the evidence file is a "
            "complete forensic image before re-running the pipeline."
        )

    if cls == "MemoryParsingError" or "memoryparsingerror" in lower:
        return (
            "The memory dump could not be parsed. Verify the file is a valid "
            "memory capture supported by Volatility."
        )

    if cls == "IntegrityVerificationError" or "integrityverificationerror" in lower:
        return (
            "Evidence integrity verification failed. The file may have been "
            "modified since it was registered."
        )

    if cls == "EvidenceNotFoundError" or "evidence not found" in lower:
        return "The evidence file could not be found or accessed for this job."

    if cls == "UnsupportedFormatError" or ("unsupported" in lower and "format" in lower):
        return "The evidence format is not supported for automated pipeline analysis."

    if cls == "PipelineTimeoutError" or "timed out" in lower:
        return "The pipeline timed out before completing. Try again or use a smaller evidence file."

    if cls == "PipelineCancelledError" or "cancelled" in lower:
        return "This pipeline job was cancelled."

    if cls == "AllParsersFailedError" or "all parsers failed" in lower:
        return (
            "No forensic parsers could extract artefacts from this evidence. "
            "Check that the image type matches the registered evidence category."
        )

    if "no evidence available for parsing" in lower:
        return "No evidence was loaded for parsing. Re-run the pipeline from validated evidence."

    if "reporting requires" in lower:
        return "Reporting could not start because earlier stages did not produce artefacts."

    return raw or "An unexpected error occurred during pipeline execution."


def pipeline_error_message(exc: BaseException | str) -> str:
    """Format an exception (or string) for storage and API responses."""
    if isinstance(exc, str):
        return humanize_pipeline_error_text(exc)
    if isinstance(exc, DFATError):
        return humanize_pipeline_error_text(
            exc.message,
            exc_class=type(exc).__name__,
        )
    return humanize_pipeline_error_text(str(exc), exc_class=type(exc).__name__)
