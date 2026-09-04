"""Integration tests for health and readiness endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_liveness_ok(app_client: TestClient) -> None:
    """Basic /health liveness endpoint reports that the process is up."""
    response = app_client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "timestamp" in body


def test_ready_checks_database(app_client: TestClient) -> None:
    """Readiness endpoint reports database connectivity."""
    # Arrange / Act
    response = app_client.get("/api/v1/health/ready")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert "checks" in body
    assert body["checks"]["database"] is True
    assert body["status"] in {"ready", "degraded"}
    assert "system_readiness" in body
    assert "services" in body
    assert isinstance(body["services"], dict)


def test_detailed_requires_admin(app_client: TestClient) -> None:
    """Detailed health is admin-only."""
    # Arrange / Act
    anonymous = app_client.get("/api/v1/health/detailed")
    viewer = app_client.get(
        "/api/v1/health/detailed",
        headers={"Authorization": f"Bearer {app_client.viewer_token}"},  # type: ignore[attr-defined]
    )
    admin = app_client.get(
        "/api/v1/health/detailed",
        headers={"Authorization": f"Bearer {app_client.admin_token}"},  # type: ignore[attr-defined]
    )

    # Assert
    assert anonymous.status_code in (401, 403)
    assert viewer.status_code == 403
    assert admin.status_code == 200
    assert "python_version" in admin.json()


def test_pipeline_websocket_connects(app_client: TestClient) -> None:
    """Unmatched /ws/pipeline used to 403; the live-progress socket must accept."""
    with app_client.websocket_connect("/ws/pipeline") as socket:
        payload = socket.receive_json()
    assert payload.get("status") == "connected"

