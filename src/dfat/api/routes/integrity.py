"""Evidence integrity batch verification routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from dfat.api.dependencies import get_evidence_management_service, require_permission
from dfat.database.models.user import UserORM
from dfat.evidence_management.schemas import (
    BatchIntegrityVerifyItem,
    BatchIntegrityVerifyRequest,
    BatchIntegrityVerifyResponse,
)
from dfat.services.evidence_management_service import EvidenceManagementService

router = APIRouter(prefix="/integrity", tags=["Integrity"])


@router.post("/batch-verify", response_model=BatchIntegrityVerifyResponse)
async def batch_verify_integrity(
    body: BatchIntegrityVerifyRequest,
    current_user: UserORM = Depends(require_permission("evidence", "read")),
    evidence_mgmt: EvidenceManagementService = Depends(
        get_evidence_management_service
    ),
) -> BatchIntegrityVerifyResponse:
    """Verify integrity for all evidence or a filtered subset in one request."""
    result = await evidence_mgmt.batch_verify_evidence(
        current_user.id,
        current_user.full_name,
        case_id=body.case_id,
        evidence_ids=body.evidence_ids,
    )
    items = [
        BatchIntegrityVerifyItem(**item) for item in result.get("items") or []
    ]
    return BatchIntegrityVerifyResponse(
        items=items,
        total=int(result.get("total") or 0),
        passed=int(result.get("passed") or 0),
        failed=int(result.get("failed") or 0),
    )
