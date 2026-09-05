from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from hugin.kernel.events import BudgetSpec
from hugin.programs.loader import (
    KNOWN_CAPABILITIES,
    Program,
    full_system_prompt,
    kernel_contract,
    load_programs,
)

SYSCALLS = [
    "munin_search",
    "munin_write",
    "proc_spawn",
    "proc_send",
    "proc_wait",
    "mission_report",
    "artifact_write",
]

WORKERS = ["judge", "scout", "scribe", "smith"]


def write_program(directory: Path, name: str, **overrides: object) -> Path:
    """Write a minimal valid program YAML into `directory` and return its path."""
    data: dict[str, object] = {
        "name": name,
        "role": "Tester",
        "icon": "bug",
        "accent": "cyan",
        "system_prompt": "You are a test program.",
    }
    data.update(overrides)
    path = directory / f"{name}.yaml"
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    return path


def test_all_five_programs_load_from_the_package_dir():
    programs = load_programs()
    assert set(programs) == {"planner", "scout", "smith", "judge", "scribe"}
    for name, program in programs.items():
        assert isinstance(program, Program)
        assert program.name == name
        assert program.driver == "claude"
        assert program.model == "sonnet"
        assert set(program.capabilities) <= KNOWN_CAPABILITIES
        assert len(program.system_prompt.splitlines()) <= 25


def test_planner_orchestrates_and_owns_the_artifact():
    planner = load_programs()["planner"]
    assert (planner.role, planner.icon, planner.accent) == ("Orchestrator", "compass", "violet")
    assert planner.tools == []
    assert set(planner.capabilities) == {
        "munin.read",
        "munin.write",
        "proc.spawn",
        "proc.wait",
        "proc.send",
        "artifact.write",
    }
    assert planner.budget == BudgetSpec(max_turns=20, max_seconds=900, max_output_tokens=12000)
    for syscall in ("proc_spawn", "proc_wait", "artifact_write"):
        assert syscall in planner.system_prompt


def test_scout_and_smith_tool_whitelists():
    programs = load_programs()
    scout = programs["scout"]
    assert (scout.role, scout.icon, scout.accent) == ("Researcher", "telescope", "cyan")
    assert scout.tools == ["WebSearch", "WebFetch"]
    assert scout.capabilities == ["munin.read", "munin.write", "report"]
    assert scout.budget == BudgetSpec()
    smith = programs["smith"]
    assert (smith.role, smith.icon, smith.accent) == ("Engineer", "hammer", "amber")
    assert smith.tools == ["Read", "Glob", "Grep", "Bash(ls *)", "Bash(cat *)", "Bash(wc *)"]
    assert smith.capabilities == ["munin.read", "munin.write", "report"]


def test_judge_and_scribe_are_read_only_with_judge_on_a_tight_budget():
    programs = load_programs()
    judge = programs["judge"]
    assert (judge.role, judge.icon, judge.accent) == ("Reviewer", "scale", "rose")
    assert judge.tools == []
    assert judge.capabilities == ["munin.read", "report"]
    assert judge.budget == BudgetSpec(max_turns=6, max_seconds=240, max_output_tokens=3000)
    scribe = programs["scribe"]
    assert (scribe.role, scribe.icon, scribe.accent) == ("Writer", "pen-line", "green")
    assert scribe.tools == []
    assert scribe.capabilities == ["munin.read", "report"]
    assert scribe.budget == BudgetSpec()


def test_only_the_planner_spawns_and_writes_artifacts():
    programs = load_programs()
    for name in WORKERS:
        capabilities = set(programs[name].capabilities)
        assert "artifact.write" not in capabilities
        assert "proc.spawn" not in capabilities
        assert "report" in capabilities
        assert "mission_report" in programs[name].system_prompt


def test_unknown_capability_is_rejected(tmp_path):
    write_program(tmp_path, "rogue", capabilities=["munin.read", "kernel.panic"])
    with pytest.raises(ValueError) as excinfo:
        load_programs(tmp_path)
    assert "kernel.panic" in str(excinfo.value)
    assert "rogue.yaml" in str(excinfo.value)


def test_name_must_match_the_file_stem(tmp_path):
    write_program(tmp_path, "alias").rename(tmp_path / "other.yaml")
    with pytest.raises(ValueError, match="alias"):
        load_programs(tmp_path)


def test_zero_budget_is_rejected(tmp_path):
    write_program(tmp_path, "greedy", budget={"max_seconds": 0})
    with pytest.raises(ValidationError):
        load_programs(tmp_path)


def test_full_system_prompt_is_program_prompt_plus_contract():
    planner = load_programs()["planner"]
    combined = full_system_prompt(planner)
    assert combined.startswith(planner.system_prompt)
    assert combined.endswith(kernel_contract())
    assert kernel_contract() not in planner.system_prompt


def test_contract_is_short_and_names_every_syscall():
    contract = kernel_contract()
    assert len(contract.splitlines()) <= 40
    assert "{pid}" in contract
    for syscall in SYSCALLS:
        assert syscall in contract
