"""The workspace rule: a task may only name paths inside the configured workspace root.

This is a *convenience guard on text*, not a sandbox. It turns the obvious mistake ("analyse
/etc/passwd", an injected "read ~/.ssh/id_rsa") into an immediate, readable refusal before an
agent is even spawned. The boundary that actually holds is the path-scoped tool rule the Claude
driver hands to `claude -p` (see `hugin.drivers.claude_code.file_scope_rules`); an agent can
phrase a path in ways no regex catches.
"""

import re
from pathlib import Path

# URLs are stripped first: the "//host/path" of a URL would otherwise read as an absolute path.
_URL = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)
# An absolute, home or parent-relative path. The lookbehind keeps prose out — "und/oder" and
# "km/h" are not paths — and at least one name character must follow the slash.
_PATH = re.compile(r"(?<![\w:.])(?:~/|/|\.\./)[\w.~-]+(?:/[\w.~-]*)*")


class WorkspaceViolation(ValueError):
    """A task names a path outside the workspace root."""


def foreign_paths(text: str, root: Path) -> list[str]:
    """Every path in `text` that does not resolve to somewhere under `root`."""
    root = root.expanduser().resolve()
    found: list[str] = []
    for match in _PATH.finditer(_URL.sub(" ", text)):
        candidate = Path(match.group()).expanduser()
        if not candidate.is_absolute():
            # A parent-relative path has no meaning without a cwd; the only honest reading is
            # "somewhere that is not under the root".
            found.append(match.group())
        elif not candidate.resolve().is_relative_to(root):
            found.append(match.group())
    return found


def ensure_inside(text: str, root: Path) -> None:
    """Raise `WorkspaceViolation` if `text` names a path outside `root`."""
    foreign = foreign_paths(text, root)
    if foreign:
        raise WorkspaceViolation(
            f"path {foreign[0]!r} is outside the workspace root {root} — paths must stay inside it"
        )
