import { Chip, type Tone } from "../../components/Chip";
import { Kbd } from "../../components/Kbd";
import { fmtDuration } from "../../lib/format";
import { STATE_LABEL } from "../../lib/i18n";
import type { Run } from "../../state/types";

const RUN_TONE: Record<Run["state"], Tone> = {
  running: "violet",
  done: "green",
  failed: "red",
};

type MissionBarProps = {
  /** The newest run — a finished one stays on the bar, so its outcome is still readable. */
  run: Run | undefined;
  /** Wall clock in seconds while live, the last event's timestamp during replay. */
  now: number;
};

export function MissionBar({ run, now }: MissionBarProps) {
  if (run === undefined) {
    return (
      <footer className="flex h-10 items-center gap-2 border-t border-border bg-surface/60 px-4 text-[12px] text-muted">
        <span>Keine aktive Mission — </span>
        <Kbd>⌘K</Kbd>
      </footer>
    );
  }

  const elapsed = (run.doneAt ?? now) - run.createdAt;
  return (
    <footer className="flex h-10 items-center gap-3 border-t border-border bg-surface/60 px-4">
      <span className="text-[11px] tracking-[0.12em] text-muted uppercase">Mission</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-text" title={run.goal}>
        {run.goal}
      </span>
      {run.artifacts.length > 0 && (
        <span className="hidden font-mono text-[11px] text-muted sm:inline">
          {run.artifacts.length} Artefakt{run.artifacts.length === 1 ? "" : "e"}
        </span>
      )}
      <span className="font-mono text-[11px] text-muted tabular-nums">{fmtDuration(elapsed)}</span>
      <Chip tone={RUN_TONE[run.state]} pulse={run.state === "running"}>
        {STATE_LABEL[run.state]}
      </Chip>
    </footer>
  );
}
