"""Unit tests for token-bucket rate limiting."""

from __future__ import annotations

import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dfat.api.middleware.rate_limiter import RateLimiterMiddleware, TokenBucket


def test_rate_limit_allows_within_limit() -> None:
    """Requests within the bucket capacity are allowed."""
    # Arrange
    bucket = TokenBucket(rate=10.0, capacity=5)

    # Act / Assert
    for _ in range(5):
        assert bucket.consume() is True


def test_rate_limit_blocks_over_limit() -> None:
    """Auth endpoint group returns HTTP 429 after capacity is exhausted."""
    # Arrange
    app = FastAPI()
    app.add_middleware(RateLimiterMiddleware)

    @app.post("/api/v1/auth/login")
    def login() -> dict[str, str]:
        return {"ok": "true"}

    client = TestClient(app)

    # Act
    statuses = [
        client.post("/api/v1/auth/login", json={"username": "a", "password": "b"}).status_code
        for _ in range(12)
    ]

    # Assert
    assert all(code == 200 for code in statuses[:10])
    assert statuses[10] == 429
    assert "Retry-After" in client.post(
        "/api/v1/auth/login",
        json={"username": "a", "password": "b"},
    ).headers


def test_rate_limit_recovers_after_window() -> None:
    """After refill, previously exhausted buckets accept new requests."""
    # Arrange — high refill rate so a short sleep restores a token.
    bucket = TokenBucket(rate=100.0, capacity=1)
    assert bucket.consume() is True
    assert bucket.consume() is False

    # Act
    time.sleep(0.03)
    recovered = bucket.consume()

    # Assert
    assert recovered is True


def test_evidence_verify_is_rate_limit_exempt() -> None:
    """Integrity verification POSTs bypass rate limiting entirely."""
    app = FastAPI()
    app.add_middleware(RateLimiterMiddleware)

    @app.post("/api/v1/evidence/{evidence_id}/verify-integrity")
    def verify(evidence_id: str) -> dict[str, str]:
        return {"ok": evidence_id}

    client = TestClient(app)
    statuses = [
        client.post("/api/v1/evidence/ev-1/verify-integrity").status_code
        for _ in range(20)
    ]

    assert all(code == 200 for code in statuses)


def test_evidence_verify_uses_general_rate_not_upload_bucket() -> None:
    """Integrity verification POSTs must not share the strict register bucket."""
    app = FastAPI()
    app.add_middleware(RateLimiterMiddleware)

    @app.post("/api/v1/evidence/register")
    def register() -> dict[str, str]:
        return {"ok": "registered"}

    @app.post("/api/v1/evidence/{evidence_id}/verify-integrity")
    def verify(evidence_id: str) -> dict[str, str]:
        return {"ok": evidence_id}

    client = TestClient(app)

    register_statuses = [
        client.post("/api/v1/evidence/register", json={"file_path": "x"}).status_code
        for _ in range(7)
    ]
    verify_statuses = [
        client.post("/api/v1/evidence/ev-1/verify-integrity").status_code
        for _ in range(12)
    ]

    assert 429 in register_statuses
    assert all(code == 200 for code in verify_statuses)
