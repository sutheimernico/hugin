import { Power } from "lucide-react";
import { memo } from "react";
import { Kbd } from "../../components/Kbd";
import { Panel } from "../../components/Panel";
import { StateRing } from "../../components/StateRing";
import { stateLine } from "../../lib/activity";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/i18n";
import { isAlive } from "../../state/selectors";
import type { Proc } from "../../state/types";

type ProcessTableProps = {
  /** Already ordered by pid (`selectProcs`) — the order they were spawned in. */
  procs: Proc[];
  /** Wall clock in seconds while live, the last event's timestamp during replay. */
  now: number;
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  onKill: (pid: number) => void;
  /** False (default): only the active mission. True: every process this kernel supervised. */
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
};

const HEAD =
  "sticky top-0 z-10 bg-surface px-1.5 py-2 whitespace-nowrap text-[12px] font-medium text-muted";

export function ProcessTable({
  procs,
  now,
  selectedPid,
  onSelect,
  onKill,
  showAll,
  onShowAllChange,
}: ProcessTableProps) {
  const alive = procs.filter(isAlive).length;
  return (
    <Panel
      title="Prozesse"
      right={
        <span className="flex items-center gap-2.5">
          <span className="font-display text-[15px] font-semibold text-muted tabular-nums">
            {procs.length === 0 ? "" : `${alive} von ${procs.length} aktiv`}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={showAll}
            title={showAll ? "Nur den laufenden Auftrag zeigen" : "Alle Prozesse zeigen"}
            onClick={() => onShowAllChange(!showAll)}
            className="ease-out-expo rounded-part border border-border px-2 py-0.5 font-display text-[13px] font-semibold text-muted transition-colors duration-150 hover:bg-surface-2 aria-checked:border-text aria-checked:bg-text aria-checked:text-surface-2"
          >
            Alle
          </button>
        </span>
      }
      className="h-full"
      bodyClassName="min-h-0 overflow-x-hidden overflow-y-auto p-0"
    >
      {procs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <p className="text-[13px] text-muted">
            {showAll ? "Noch keine Prozesse" : "Kein laufender Auftrag"}
          </p>
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            Mission starten mit <Kbd>⌘K</Kbd>
          </p>
        </div>
      ) : (
        <table className="w-full table-fixed border-collapse text-[13px]">
          {/* Fixed columns: the agent cell truncates instead of pushing the kill switch out. */}
          <colgroup>
            <col />
            <col className="w-16" />
            <col className="w-14" />
            <col className="w-10" />
          </colgroup>
          <thead>
            <tr>
              <th className={`${HEAD} pl-4 text-left`}>Agent</th>
              <th className={`${HEAD} text-right`}>Tokens</th>
              <th className={`${HEAD} text-right`}>Zeit</th>
              <th className={`${HEAD} pr-2`}>
                <span className="sr-only">Beenden</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {procs.map((proc) => (
              <ProcessRow
                key={proc.pid}
                proc={proc}
                // Not `now`: an exited process has a fixed end, and passing the ticking clock
                // would invalidate every finished row once a second for nothing.
                end={proc.exitedAt ?? now}
                selected={proc.pid === selectedPid}
                onSelect={onSelect}
                onKill={onKill}
              />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

type RowProps = {
  proc: Proc;
  /** When this process's clock stops: its exit, or the wall clock while it lives. */
  end: number;
  selected: boolean;
  onSelect: (pid: number) => void;
  onKill: (pid: number) => void;
};

/**
 * Memoised on purpose: a streaming mission rewrites one `Proc` object per event while the
 * others keep their identity, so without this every token would re-render the whole table.
 * Every prop is stable per row — the reducer hands out frozen objects, `end` only moves for a
 * living process, and the two callbacks come from `useCallback` in `App`.
 */
const ProcessRow = memo(function ProcessRow({ proc, end, selected, onSelect, onKill }: RowProps) {
  const living = isAlive(proc);
  return (
    <tr
      data-testid="proc-row"
      data-selected={selected ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      tabIndex={0}
      onClick={() => onSelect(proc.pid)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(proc.pid);
      }}
      className="ease-out-expo cursor-pointer border-t border-border/70 transition-colors duration-150 outline-none hover:bg-surface-2 focus-visible:bg-surface-2 data-[selected=true]:bg-surface-2 data-[selected=true]:shadow-[inset_3px_0_0_var(--color-text)]"
    >
      {/* `ROLE_LABEL` is keyed by program name; the kernel's own `role` is English prose
          and only stands in for a program the shell does not know. */}
      <td className="overflow-hidden py-2 pr-1 pl-4" title={`${ROLE_LABEL[proc.program] ?? proc.role} — ${proc.task}`}>
        <span className="flex items-center gap-2.5">
          <StateRing state={proc.state} size={12} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className="font-display truncate text-[16px] leading-5 font-semibold text-text">
                {ROLE_LABEL[proc.program] ?? proc.role}
              </span>
              <span className="font-mono text-[11px] text-muted tabular-nums">{proc.pid}</span>
            </span>
            <span className="block truncate text-[12px] text-muted">
              {stateLine(proc)}
            </span>
          </span>
        </span>
      </td>
      <td
        className="px-1.5 text-right font-display text-[15px] font-semibold whitespace-nowrap text-text tabular-nums"
        title="Ausgabe-Tokens"
      >
        {fmtTokens(proc.usage.output_tokens)}
      </td>
      <td className="px-1.5 text-right font-mono text-[12px] whitespace-nowrap text-muted tabular-nums">
        {elapsed(proc, end)}
      </td>
      <td className="py-1.5 pr-2 text-right">
        {living && (
          <button
            type="button"
            aria-label={`Prozess ${proc.pid} beenden`}
            title="Prozess beenden"
            onClick={(event) => {
              // The row itself selects; the kill switch must not do both.
              event.stopPropagation();
              onKill(proc.pid);
            }}
            className="rounded p-1 leading-none text-muted transition-colors duration-150 hover:bg-red/15 hover:text-red"
          >
            <Power size={15} aria-hidden />
          </button>
        )}
      </td>
    </tr>
  );
});

/** A process that has exited keeps the time it took; only a living one follows the clock. */
function elapsed(proc: Proc, end: number): string {
  if (proc.startedAt === null) return "–";
  return fmtDuration(end - proc.startedAt);
}
