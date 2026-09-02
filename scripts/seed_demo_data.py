#!/usr/bin/env python3
"""Seed comprehensive demo data for all DFAT modules and status values.

Requires a running API (``make dev-backend``). Creates users, cases in every
lifecycle status, evidence, artefacts, reports, pipeline jobs, evaluation
records, and usability responses so each sidebar module has sample data.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Optional

import httpx

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from demo_seed_bundle import ensure_demo_artefacts_and_report, seed_forensic_bundle  # noqa: E402
from seed_dev_data import (  # noqa: E402
    API_BASE,
    SeedError,
    USERS,
    _bootstrap_admin,
    _ensure_user,
    _find_case_id,
    _login,
    _print,
)

DEMO_EVIDENCE_DIR = REPO_ROOT / "data" / "evidence" / "demo"
DEMO_DATASETS_DIR = REPO_ROOT / "data" / "datasets" / "demo"

DEMO_CASES = (
    {"case_name": "Demo — Created", "target_status": "created", "description": "Case in CREATED status"},
    {"case_name": "Demo — Open", "target_status": "open", "description": "Case in OPEN status"},
    {"case_name": "Demo — Active", "target_status": "active", "description": "Primary demo case with full forensic data"},
    {"case_name": "Demo — Under Review", "target_status": "under_review", "description": "Case in UNDER_REVIEW status"},
    {"case_name": "Demo — Closed", "target_status": "closed", "description": "Case in CLOSED status"},
    {"case_name": "Demo — Archived", "target_status": "archived", "description": "Case in ARCHIVED status"},
    {"case_name": "Dev Sample", "target_status": "open", "description": "Seeded OPEN case for local development"},
    {"case_name": "Dev Sample Lab", "target_status": "active", "description": "Seeded ACTIVE case for local development"},
)

EVIDENCE_SPECS = (
    {
        "filename": "primary.dd",
        "case_name": "Demo — Active",
        "description": "Primary demo disk image with rich artefacts",
        "key": "primary",
    },
    {
        "filename": "secondary.dd",
        "case_name": "Demo — Open",
        "description": "Secondary evidence for inventory variety",
        "key": "secondary",
    },
    {
        "filename": "quarantine.dd",
        "case_name": "Demo — Active",
        "description": "Evidence item to quarantine for status demo",
        "key": "quarantine",
        "quarantine": True,
    },
)


async def _get_user_id(client: httpx.AsyncClient, token: str, username: str) -> Optional[str]:
    response = await client.get(
        f"{API_BASE}/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code != 200:
        return None
    payload = response.json()
    users = payload if isinstance(payload, list) else payload.get("users") or []
    for item in users:
        if item.get("username") == username:
            return str(item.get("id") or item.get("user_id"))
    return None


async def _assign_lead_investigator(
    client: httpx.AsyncClient,
    token: str,
    case_id: str,
    investigator_id: str,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.post(
        f"{API_BASE}/cases/{case_id}/investigators",
        headers=headers,
        json={"user_id": investigator_id, "role": "lead"},
    )
    if response.status_code >= 500:
        raise SeedError(
            f"Failed to assign investigator to {case_id}: "
            f"{response.status_code} {response.text}"
        )


async def _apply_case_status(
    client: httpx.AsyncClient,
    token: str,
    case_id: str,
    target: str,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    reason = {"reason": "Demo seed lifecycle transition"}

    async def _post(path: str, *, json_body: Optional[dict] = None) -> None:
        response = await client.post(
            f"{API_BASE}/cases/{case_id}/{path}",
            headers=headers,
            json=json_body,
        )
        if response.status_code >= 500:
            raise SeedError(
                f"Case transition {path} failed for {case_id}: "
                f"{response.status_code} {response.text}"
            )

    if target == "created":
        return

    await _post("open")
    if target == "open":
        return

    await _post("activate")
    if target == "active":
        return

    await _post("submit-review")
    if target == "under_review":
        return

    await _post("close", json_body=reason)
    if target == "closed":
        return

    await _post("archive")
    if target == "archived":
        return


async def _ensure_demo_case(
    client: httpx.AsyncClient,
    token: str,
    spec: dict[str, str],
    investigator_id: Optional[str],
) -> str:
    existing = await _find_case_id(client, token, spec["case_name"])
    if existing:
        _print(f"  Case exists: {spec['case_name']} ({existing})")
        case_id = existing
    else:
        response = await client.post(
            f"{API_BASE}/cases",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "case_name": spec["case_name"],
                "description": spec["description"],
            },
        )
        if response.status_code not in (200, 201):
            raise SeedError(
                f"Failed to create case {spec['case_name']}: "
                f"{response.status_code} {response.text}"
            )
        case_id = str(response.json()["case_id"])
        _print(f"  Created case: {spec['case_name']} ({case_id})")

    if investigator_id and spec["target_status"] != "created":
        await _assign_lead_investigator(client, token, case_id, investigator_id)

    await _apply_case_status(client, token, case_id, spec["target_status"])
    _print(f"  Case status '{spec['target_status']}' applied for {spec['case_name']}")
    return case_id


def _ensure_demo_files() -> None:
    DEMO_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    DEMO_DATASETS_DIR.mkdir(parents=True, exist_ok=True)

    samples = {
        "primary.dd": b"DFAT-DEMO-PRIMARY-EVIDENCE-SEED\n" + b"\x00" * 512,
        "secondary.dd": b"DFAT-DEMO-SECONDARY-EVIDENCE\n" + b"\x00" * 256,
        "quarantine.dd": b"DFAT-DEMO-QUARANTINE-EVIDENCE\n" + b"\x00" * 128,
    }
    for name, content in samples.items():
        path = DEMO_EVIDENCE_DIR / name
        if not path.is_file():
            path.write_bytes(content)
            _print(f"  Created evidence file {path}")

    gt_source = (
        REPO_ROOT / "tests" / "fixtures" / "ground_truth" / "dfrws_sample.json"
    )
    if not gt_source.is_file():
        gt_source = REPO_ROOT / "data" / "ground_truth" / "dfrws" / "dfrws_sample.json"
    gt_target = DEMO_DATASETS_DIR / "dfrws_sample.json"
    if gt_source.is_file() and not gt_target.is_file():
        gt_target.write_text(gt_source.read_text(encoding="utf-8"), encoding="utf-8")
        _print(f"  Copied ground-truth sample to {gt_target}")


async def _find_evidence_id(
    client: httpx.AsyncClient,
    token: str,
    file_name: str,
) -> Optional[str]:
    response = await client.get(
        f"{API_BASE}/evidence/inventory",
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code != 200:
        return None
    payload = response.json()
    items = payload.get("items") or []
    for item in items:
        if str(item.get("file_name") or "").lower() == file_name.lower():
            return str(item.get("evidence_id"))
    return None


async def _ensure_evidence(
    client: httpx.AsyncClient,
    token: str,
    *,
    file_path: Path,
    case_id: str,
    description: str,
    quarantine: bool = False,
) -> str:
    existing = await _find_evidence_id(client, token, file_path.name)
    if existing:
        _print(f"  Evidence exists: {file_path.name} ({existing})")
        evidence_id = existing
    else:
        response = await client.post(
            f"{API_BASE}/evidence/register",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "file_path": str(file_path),
                "case_id": case_id,
                "evidence_type": "disk_image",
                "description": description,
            },
        )
        if response.status_code not in (200, 201):
            raise SeedError(
                f"Failed to register {file_path.name}: "
                f"{response.status_code} {response.text}"
            )
        evidence_id = str(response.json()["evidence_id"])
        _print(f"  Registered evidence: {file_path.name} ({evidence_id})")

    if quarantine:
        response = await client.post(
            f"{API_BASE}/evidence/{evidence_id}/quarantine",
            headers={"Authorization": f"Bearer {token}"},
            json={"reason": "Demo seed — suspicious placeholder flagged for review"},
        )
        if response.status_code >= 500:
            raise SeedError(
                f"Failed to quarantine {evidence_id}: "
                f"{response.status_code} {response.text}"
            )
        _print(f"  Quarantined evidence {evidence_id}")

    return evidence_id


async def _seed_evaluation(client: httpx.AsyncClient, token: str, evidence_id: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}

    try:
        baseline = await client.get(f"{API_BASE}/evaluation/benchmark/baseline", headers=headers)
        if baseline.status_code == 200 and baseline.json() is None:
            response = await client.put(
                f"{API_BASE}/evaluation/benchmark/baseline",
                headers=headers,
                json={
                    "baseline_ttt_seconds": 3600.0,
                    "label": "Manual baseline (demo seed)",
                },
            )
            if response.status_code in (200, 201):
                _print("  Saved evaluation manual baseline")
    except httpx.HTTPError as exc:
        _print(f"  Evaluation baseline skipped: {exc}")

    for source, dataset in (("dfrws", "dfrws_sample.json"), ("cfreds", "cfreds_sample.json")):
        try:
            response = await client.post(
                f"{API_BASE}/evaluation/benchmark/offline",
                headers=headers,
                json={
                    "dataset_source": source,
                    "ground_truth_dataset": dataset,
                    "dataset_name": f"Demo {source.upper()}",
                    "omit_count": 1,
                    "extra_false_positives": 1,
                },
            )
        except httpx.HTTPError as exc:
            _print(f"  Offline benchmark skipped ({source}): {exc}")
            continue
        if response.status_code in (200, 201):
            _print(f"  Ran offline benchmark ({source})")
        else:
            _print(f"  Offline benchmark skipped ({source}): {response.status_code}")

    usability_samples = (
        {"Q1": 5, "Q2": 4, "Q3": 5, "Q4": 4, "Q5": 4, "free_text": "Clear triage overview."},
        {"Q1": 4, "Q2": 4, "Q3": 4, "Q4": 3, "Q5": 3, "free_text": "Useful for lab exercises."},
        {"Q1": 5, "Q2": 5, "Q3": 4, "Q4": 5, "Q5": 4, "free_text": "Reports and timeline helped a lot."},
    )
    for index, sample in enumerate(usability_samples, start=1):
        payload = dict(sample)
        free_text = payload.pop("free_text")
        try:
            response = await client.post(
                f"{API_BASE}/evaluation/usability/respond",
                json={"ratings": payload, "free_text": free_text},
            )
        except httpx.HTTPError as exc:
            _print(f"  Usability response #{index} skipped: {exc}")
            continue
        if response.status_code in (200, 201):
            _print(f"  Usability response #{index} recorded")
        else:
            _print(f"  Usability response #{index} skipped: {response.status_code}")

    try:
        response = await client.post(
            f"{API_BASE}/evaluation/llm-summary",
            headers=headers,
            json={
                "dataset_source": "dfrws",
                "ground_truth_dataset": "dfrws_sample.json",
                "evidence_id": evidence_id,
            },
        )
    except httpx.HTTPError as exc:
        _print(f"  LLM summary evaluation skipped: {exc}")
        return
    if response.status_code in (200, 201):
        _print("  LLM summary evaluation recorded")
    else:
        _print(f"  LLM summary evaluation skipped: {response.status_code}")


async def _seed_ai(client: httpx.AsyncClient, token: str, evidence_id: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    for path, label in (
        ("/ai/classify", "AI classify"),
        ("/ai/summarize", "AI summarize"),
    ):
        try:
            response = await client.post(
                f"{API_BASE}{path}",
                headers=headers,
                json={"evidence_id": evidence_id, "use_fallback": True},
                timeout=60.0,
            )
        except httpx.HTTPError as exc:
            _print(f"  {label} skipped: {exc}")
            continue
        if response.status_code in (200, 201):
            _print(f"  {label} completed")
        else:
            _print(f"  {label} skipped: {response.status_code}")


async def _seed_datasets(client: httpx.AsyncClient, token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.post(f"{API_BASE}/datasets/scan", headers=headers)
    if response.status_code in (200, 201):
        _print("  Dataset registry scan completed")
    else:
        _print(f"  Dataset scan skipped: {response.status_code}")


async def _verify_integrity(client: httpx.AsyncClient, token: str, evidence_id: str) -> None:
    response = await client.post(
        f"{API_BASE}/evidence/{evidence_id}/verify-integrity",
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code in (200, 201):
        _print(f"  Integrity verified for {evidence_id}")


async def main() -> int:
    _print("=== DFAT Demo Data Seed ===")
    _print(f"API: {API_BASE}")

    admin = USERS[0]
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            health = await client.get(f"{API_BASE}/health/ready")
            health.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            _print(
                "ERROR: API is not reachable. Start it with `make dev-backend` "
                f"first.\n  ({exc})"
            )
            return 1

        token = await _login(client, admin["username"], admin["password"])
        if not token:
            _print("Admin login failed — bootstrapping first admin…")
            await _bootstrap_admin(admin)
            token = await _login(client, admin["username"], admin["password"])
        if not token:
            raise SeedError("Unable to obtain admin access token after bootstrap")

        headers = {"Authorization": f"Bearer {token}"}

        _print("Seeding users…")
        for user in USERS[1:]:
            await _ensure_user(client, token, user)
        _print(f"  User ready: {admin['username']} (admin)")

        investigator_id = await _get_user_id(client, token, "investigator1")
        admin_id = await _get_user_id(client, token, admin["username"])

        _print("Preparing demo files…")
        _ensure_demo_files()

        _print("Seeding cases (all lifecycle statuses)…")
        case_ids: dict[str, str] = {}
        for spec in DEMO_CASES:
            case_id = await _ensure_demo_case(client, token, spec, investigator_id)
            case_ids[spec["case_name"]] = case_id

        active_case_id = case_ids.get("Demo — Active")
        if not active_case_id:
            raise SeedError("Demo — Active case was not created")

        _print("Seeding evidence…")
        evidence_ids: dict[str, str] = {}
        for spec in EVIDENCE_SPECS:
            case_id = case_ids.get(spec["case_name"])
            if not case_id:
                continue
            file_path = DEMO_EVIDENCE_DIR / spec["filename"]
            evidence_id = await _ensure_evidence(
                client,
                token,
                file_path=file_path,
                case_id=case_id,
                description=spec["description"],
                quarantine=bool(spec.get("quarantine")),
            )
            evidence_ids[spec["key"]] = evidence_id

        primary_evidence_id = evidence_ids.get("primary")
        if not primary_evidence_id:
            raise SeedError("Primary demo evidence was not registered")

        _print("Seeding artefacts and reports for all demo evidence…")
        for spec in EVIDENCE_SPECS:
            evidence_id = evidence_ids.get(spec["key"])
            case_id = case_ids.get(spec["case_name"])
            if not evidence_id or not case_id:
                continue
            result = await ensure_demo_artefacts_and_report(
                case_id=case_id,
                evidence_id=evidence_id,
            )
            _print(
                f"  {spec['key']}: {result.get('artefact_count', 0)} artefacts "
                f"(report {str(result.get('report_id', ''))[:8]})"
            )

        _print("Seeding forensic bundle (artefacts, reports, pipeline jobs)…")
        bundle = await seed_forensic_bundle(
            case_id=active_case_id,
            evidence_id=primary_evidence_id,
            admin_user_id=admin_id or "admin",
        )
        _print(f"  Demo report: {bundle.get('report_id')} ({bundle.get('artefact_count')} artefacts)")

        _print("Seeding AI analysis…")
        for evidence_id in evidence_ids.values():
            await _seed_ai(client, token, evidence_id)

        _print("Seeding evaluation modules…")
        await _seed_evaluation(client, token, primary_evidence_id)

        _print("Seeding datasets…")
        await _seed_datasets(client, token)

        _print("Recording integrity check…")
        await _verify_integrity(client, token, primary_evidence_id)

        # Optional online benchmark when parsed artefacts exist.
        try:
            response = await client.post(
                f"{API_BASE}/evaluation/benchmark",
                headers=headers,
                json={
                    "evidence_id": primary_evidence_id,
                    "ground_truth_dataset": "dfrws_sample.json",
                    "dataset_source": "dfrws",
                },
            )
            if response.status_code in (200, 201):
                _print("  Online benchmark recorded")
            else:
                _print(f"  Online benchmark skipped: {response.status_code}")
        except httpx.HTTPError as exc:
            _print(f"  Online benchmark skipped: {exc}")

    _print("=== Demo seed complete ===")
    _print("Logins:")
    for user in USERS:
        _print(f"  {user['username']} / {user['password']} ({user['role_name']})")
    _print("")
    _print("Modules populated:")
    _print("  Dashboard, Cases (all statuses), Evidence, Integrity Check")
    _print("  Pipeline (queued/running/completed/failed/cancelled)")
    _print("  AI Analysis -> Timeline, IOCs, Summary")
    _print("  Reports -> JSON Artefacts")
    _print("  Evaluation -> Benchmark, History, Performance, Usability, LLM summaries")
    _print("  Datasets (scan data/datasets/demo/)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except SeedError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        raise SystemExit(1) from err
