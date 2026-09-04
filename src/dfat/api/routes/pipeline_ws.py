"""Live pipeline progress over WebSocket (``/ws/pipeline``)."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from dfat.pipeline.enums import JobStatus

logger = logging.getLogger(__name__)

router = APIRouter()

_TERMINAL = {
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
    JobStatus.TIMED_OUT,
}


def _progress_payload(progress: Any) -> dict[str, Any]:
    if hasattr(progress, "model_dump"):
        return progress.model_dump(mode="json")
    if isinstance(progress, dict):
        return progress
    return {"status": str(progress)}


def _job_id_from_message(message: str) -> Optional[str]:
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        return message.strip() or None
    if isinstance(payload, dict):
        return str(payload.get("job_id") or payload.get("jobId") or "") or None
    return None


@router.websocket("/ws/pipeline")
async def pipeline_progress_socket(websocket: WebSocket) -> None:
    """Accept pipeline live-progress clients.

    Query ``job_id`` to stream status for a running job. Without a job id the
    socket stays open with periodic heartbeats so clients do not receive 403.
    """
    await websocket.accept()
    job_id = websocket.query_params.get("job_id") or websocket.query_params.get("jobId")

    container = getattr(websocket.app.state, "container", None)
    orchestrator = None
    if container is not None:
        try:
            orchestrator = container.pipeline.pipeline_orchestrator()
        except Exception:  # noqa: BLE001
            logger.debug("Pipeline orchestrator unavailable for websocket", exc_info=True)

    await websocket.send_json({"status": "connected", "job_id": job_id})

    try:
        while True:
            if job_id and orchestrator is not None:
                try:
                    progress = await orchestrator.get_pipeline_status(job_id)
                    await websocket.send_json(_progress_payload(progress))
                    status = getattr(progress, "status", None)
                    if status in _TERMINAL:
                        break
                except Exception as exc:  # noqa: BLE001
                    await websocket.send_json({"job_id": job_id, "error": str(exc)})
                    break
                await asyncio.sleep(2.0)
                continue

            try:
                incoming = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"status": "connected", "job_id": job_id})
                continue
            except WebSocketDisconnect:
                return
            job_id = _job_id_from_message(incoming) or job_id
    except WebSocketDisconnect:
        return
    except Exception:  # noqa: BLE001
        logger.debug("Pipeline websocket closed", exc_info=True)
    finally:
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
