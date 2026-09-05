"""Request-scoped handles. Routes reach the running system only through these.

The kernel is built once in the app lifespan and parked on `app.state`, so a dependency is a
lookup, never a construction — and a test can swap the whole stack by building its own app.
"""

from typing import Annotated

from fastapi import Depends, Request

from hugin.kernel.kernel import Kernel
from hugin.munin.store import MuninStore


def get_kernel(request: Request) -> Kernel:
    return request.app.state.kernel


def get_munin(request: Request) -> MuninStore:
    return request.app.state.kernel.syscalls.munin


KernelDep = Annotated[Kernel, Depends(get_kernel)]
MuninDep = Annotated[MuninStore, Depends(get_munin)]
