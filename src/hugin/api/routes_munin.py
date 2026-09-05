"""The memory browser's routes — a thin proxy in front of the munin store."""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query

from hugin.api.deps import MuninDep

router = APIRouter(prefix="/api/munin", tags=["munin"])

MAX_LIMIT = 100


# Declared before `/{memory_id}` so the literal paths win the match.
@router.get("/search")
async def search(
    munin: MuninDep, q: str = "", limit: int = Query(default=10, ge=1, le=MAX_LIMIT)
) -> list[dict]:
    return [asdict(memory) for memory in munin.search(q, limit)]


@router.get("/recent")
async def recent(munin: MuninDep, limit: int = Query(default=20, ge=1, le=MAX_LIMIT)) -> list[dict]:
    return [asdict(memory) for memory in munin.recent(limit)]


@router.get("/{memory_id}")
async def get_memory(memory_id: int, munin: MuninDep) -> dict:
    memory = munin.get(memory_id)
    if memory is None:
        raise HTTPException(status_code=404, detail=f"Erinnerung {memory_id} ist unbekannt.")
    return asdict(memory)
