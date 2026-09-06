"""Liveness and the subsystem report the boot screen, the palette and the gate all read."""

from fastapi import APIRouter

from hugin.api.deps import SystemDep

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "name": "hugin"}


@router.get("/system")
async def system(status: SystemDep) -> dict:
    """The snapshot verbatim — its shape is the frontend's `SystemStatus` type."""
    return await status.snapshot()
