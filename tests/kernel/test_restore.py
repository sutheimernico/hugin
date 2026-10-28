"""A kernel that boots on an old log knows the old runs: the log really is the source of truth."""

from pathlib import Path

import pytest

from hugin.drivers.scripted import ScriptedDriver
from hugin.kernel.bus import EventBus
from hugin.kernel.events import EventKind
from hugin.kernel.kernel import Kernel
from hugin.kernel.log import EventLog
from hugin.munin.store import MuninStore
from hugin.programs.loader import load_programs
from hugin.settings import Settings


async def _no_sleep(_seconds: float) -> None:
    pass


class Life:
    """One life of a kernel on a shared data directory; `end()` is a clean shutdown."""

    def __init__(self, root: Path, limits: dict[str, int]):
        self.settings = Settings(
            data_dir=root / "data", runs_dir=root / "runs", max_concurrent=limits
        )
        self.log = EventLog(self.settings.db_path)
        self.munin = MuninStore(self.settings.db_path)
        drivers = {"scripted": ScriptedDriver(clock_sleep=_no_sleep)}
        self.kernel = Kernel(
            self.settings,
            self.log,
            EventBus(self.log),
            load_programs(),
            drivers,
            self.munin,
            tick_s=0.01,
        )

    async def start(self) -> Kernel:
        await self.kernel.boot()
        return self.kernel

    def crash(self) -> None:
        """The process dies: nothing is finalised, the log is all that is left."""
        self.munin.close()
        self.log.close()

    async def end(self) -> None:
        await self.kernel.shutdown()
        self.crash()


async def test_finished_runs_come_back_after_a_restart(tmp_path, until):
    first = Life(tmp_path, {"scripted": 8})
    kernel = await first.start()
    run_id = await kernel.create_run("Briefing", driver="scripted")
    await kernel.spawn(run_id, "planner", "Briefing", driver="scripted")
    await until(lambda: kernel.runs[run_id].state == "done", timeout=10)
    before = kernel.runs[run_id]
    usage_before = kernel.run_usage(run_id)
    pids_before = [p.pid for p in kernel.procs.for_run(run_id)]
    await first.end()

    second = Life(tmp_path, {"scripted": 8})
    restored = await second.start()

    run = restored.runs[run_id]
    assert (run.goal, run.driver, run.state) == ("Briefing", "scripted", "done")
    assert run.root_pid == before.root_pid
    # The event carries its own timestamp, taken a few microseconds after the run object's.
    assert run.created_at == pytest.approx(before.created_at, abs=0.01)
    assert run.done_at == pytest.approx(before.done_at, abs=0.01)
    assert [p.pid for p in restored.procs.for_run(run_id)] == pids_before
    assert restored.run_usage(run_id) == usage_before
    assert all(p.token == "" for p in restored.procs.all())  # no credential survives a restart
    await second.end()


async def test_a_run_the_last_kernel_left_open_is_closed_as_interrupted(tmp_path):
    first = Life(tmp_path, {"scripted": 0})
    kernel = await first.start()
    run_id = await kernel.create_run("Unfinished", driver="scripted")
    planner = await kernel.spawn(run_id, "planner", "x", driver="scripted")
    await kernel.set_state(planner, "spawning")
    await kernel.set_state(planner, "running")
    queued = await kernel.spawn(run_id, "scout", "y", driver="scripted", ppid=planner)
    orphan_run = await kernel.create_run("Never started", driver="scripted")
    first.crash()  # no shutdown: the log still says the planner is running

    second = Life(tmp_path, {"scripted": 0})
    restored = await second.start()

    assert restored.runs[run_id].state == "failed"
    assert restored.runs[orphan_run].state == "failed"
    assert restored.procs.get(planner).exit_reason == "interrupted"
    assert restored.procs.get(planner).state == "failed"
    assert restored.procs.get(queued).state == "killed"
    assert not restored.procs.alive()
    kinds = [e.kind for e in second.log.for_run(run_id)]
    assert kinds[-1] == EventKind.RUN_FAILED
    # The cleanup is written before this life's `kernel.boot`, so a shell that backfills from
    # boot does not see processes it never learned about.
    boot_seq = second.log.last_boot_seq()
    assert all(e.seq < boot_seq for e in second.log.for_run(run_id))
    await second.end()


async def test_new_pids_do_not_collide_with_restored_ones(tmp_path):
    first = Life(tmp_path, {"scripted": 0})
    kernel = await first.start()
    run_id = await kernel.create_run("A", driver="scripted")
    old = await kernel.spawn(run_id, "planner", "x", driver="scripted")
    first.crash()

    second = Life(tmp_path, {"scripted": 0})
    restored = await second.start()
    run_b = await restored.create_run("B", driver="scripted")
    new = await restored.spawn(run_b, "planner", "x", driver="scripted")

    assert new > old
    await second.end()
