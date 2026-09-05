"""Programs: the executables of hugin — one YAML file per agent role.

A program is metadata plus a system prompt; the kernel spawns a *process* from it. Loading is
strict on purpose: an unknown capability or a name that disagrees with its file is a typo that
would otherwise surface much later, as a syscall the agent silently never sees.
"""

from pathlib import Path
from typing import Literal

import yaml

from hugin.kernel.events import BudgetSpec, Strict

KNOWN_CAPABILITIES = {
    "munin.read",
    "munin.write",
    "proc.spawn",
    "proc.send",
    "proc.wait",
    "report",
    "artifact.write",
}

_PACKAGE_DIR = Path(__file__).parent
_CONTRACT_PATH = _PACKAGE_DIR / "contract.md"


class Program(Strict):
    name: str
    role: str
    icon: str
    accent: Literal["violet", "cyan", "amber", "green", "rose"]
    driver: Literal["claude", "ollama", "scripted"] = "claude"
    model: str = "sonnet"
    tools: list[str] = []
    capabilities: list[str] = []
    budget: BudgetSpec = BudgetSpec()
    system_prompt: str


def load_programs(directory: Path | None = None) -> dict[str, Program]:
    """Load every `*.yaml` of `directory` (default: the package dir) into `{name: Program}`."""
    directory = _PACKAGE_DIR if directory is None else directory
    programs: dict[str, Program] = {}
    for path in sorted(directory.glob("*.yaml")):
        program = Program.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        if program.name != path.stem:
            raise ValueError(f"program name {program.name!r} does not match file {path.name}")
        unknown = sorted(set(program.capabilities) - KNOWN_CAPABILITIES)
        if unknown:
            raise ValueError(f"unknown capabilities {unknown} in {path.name}")
        programs[program.name] = program
    return programs


def kernel_contract() -> str:
    """The contract text appended to every system prompt; `{pid}` is filled in at spawn time."""
    return _CONTRACT_PATH.read_text(encoding="utf-8")


def full_system_prompt(program: Program) -> str:
    """The program's own prompt followed by the kernel contract."""
    return program.system_prompt + "\n\n" + kernel_contract()
