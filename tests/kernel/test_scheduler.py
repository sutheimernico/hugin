"""The scheduler is pure: it answers "may this driver start one more process?", nothing else."""

from hugin.kernel.scheduler import DEFAULT_LIMIT, Scheduler


def test_can_start_below_the_limit():
    scheduler = Scheduler({"scripted": 2})
    assert scheduler.can_start("scripted", {}) is True
    assert scheduler.can_start("scripted", {"scripted": 1}) is True


def test_blocks_at_and_above_the_limit():
    scheduler = Scheduler({"scripted": 2})
    assert scheduler.can_start("scripted", {"scripted": 2}) is False
    assert scheduler.can_start("scripted", {"scripted": 3}) is False


def test_other_drivers_do_not_consume_the_slot():
    scheduler = Scheduler({"claude": 1, "ollama": 1})
    assert scheduler.can_start("claude", {"ollama": 1}) is True


def test_unknown_driver_runs_one_at_a_time():
    scheduler = Scheduler({"scripted": 8})
    assert DEFAULT_LIMIT == 1
    assert scheduler.limit_for("mystery") == DEFAULT_LIMIT
    assert scheduler.can_start("mystery", {}) is True
    assert scheduler.can_start("mystery", {"mystery": 1}) is False
