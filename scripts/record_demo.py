#!/usr/bin/env python
"""Export a finished run into `demo/recordings/` — the offline demo, made committable.

No server is involved: this reads the same SQLite event log the kernel writes, so it works
while hugin is running and after it has stopped.

    uv run python scripts/record_demo.py <run_id> <slug>
"""

import sys
from pathlib import Path

from hugin.kernel.log import EventLog
from hugin.replay.recorder import Recorder, ScrubError
from hugin.settings import Settings

USAGE = "usage: record_demo.py <run_id> <slug>"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(USAGE, file=sys.stderr)
        return 2
    run_id, slug = argv
    settings = Settings()
    log = EventLog(settings.db_path)
    try:
        recorder = Recorder(log, settings.recordings_dir, settings.repo_root, Path.home())
        recorder.export(run_id, slug)
    except KeyError:
        print(f"unknown run: {run_id}", file=sys.stderr)
        return 1
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    except ScrubError as error:
        # Loud on purpose: a recording is published, so a near-miss must be seen, not masked.
        print(f"refused: secret pattern {error.pattern_name} found", file=sys.stderr)
        return 1
    finally:
        log.close()
    print(settings.recordings_dir / f"{slug}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
