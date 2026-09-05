"""Liveness. The real subsystem report (`GET /api/system`) arrives with Task 21."""

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "name": "hugin"}
