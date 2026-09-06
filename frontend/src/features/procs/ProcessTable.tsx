import { Kbd } from "../../components/Kbd";
import { Panel } from "../../components/Panel";
import { StateRing } from "../../components/StateRing";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { ROLE_LABEL, STATE_LABEL } from "../../lib/i18n";
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

const HEAD = "sticky top-0 z-10 bg-surface py-1.5 text-[10px] font-medium tracking-[0.12em] uppercase";

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
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted tabular-nums">
            {procs.length === 0 ? "" : `${alive}/${procs.length}`}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={showAll}
            title={showAll ? "Nur den laufenden Auftrag zeigen" : "Alle Prozesse zeigen"}
            onClick={() => onShowAllChange(!showAll)}
            className="ease-out-expo rounded-full border border-border px-2 py-0.5 text-[10px] tracking-[0.08em] text-muted uppercase transition-colors duration-150 hover:bg-surface-2 aria-checked:border-violet/50 aria-checked:bg-violet/12 aria-checked:text-violet"
          >
            Alle
          </button>
        </span>
      }
      className="h-full"
      bodyClassName="min-h-0 overflow-y-auto p-0"
    >
      {procs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[12px] text-muted">
            {showAll ? "Noch keine Prozesse" : "Kein laufender Auftrag"}
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted/70">
            Mission starten mit <Kbd>⌘K</Kbd>
          </p>
        </div>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead className="text-muted">
            <tr>
              <th className={`${HEAD} pl-3 text-left`}>PID</th>
              <th className={`${HEAD} text-left`}>Programm</th>
              <th className={`${HEAD} text-left`}>Status</th>
              <th className={`${HEAD} text-right`}>Rnd</th>
              <th className={`${HEAD} text-right`}>Tokens</th>
              <th className={`${HEAD} text-right`}>Zeit</th>
              <th className={`${HEAD} pr-3`}>
                <span className="sr-only">Beenden</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {procs.map((proc) => (
              <ProcessRow
                key={proc.pid}
                proc={proc}
                now={now}
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
  now: number;
  selected: boolean;
  onSelect: (pid: number) => void;
  onKill: (pid: number) => void;
};

function ProcessRow({ proc, now, selected, onSelect, onKill }: RowProps) {
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
      className="ease-out-expo cursor-pointer border-t border-border/60 transition-colors duration-150 outline-none hover:bg-surface-2 focus-visible:bg-surface-2 data-[selected=true]:bg-violet/12"
    >
      <td className="py-1.5 pl-3 font-mono text-[11px] text-muted tabular-nums">{proc.pid}</td>
      {/* `ROLE_LABEL` is keyed by program name; the kernel's own `role` is English prose
          and only stands in for a program the shell does not know. */}
      <td title={`${ROLE_LABEL[proc.program] ?? proc.role} — ${proc.task}`}>
        <span className="block max-w-24 truncate font-mono text-text">{proc.program}</span>
      </td>
      <td>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <StateRing state={proc.state} size={10} />
          {STATE_LABEL[proc.state]}
        </span>
      </td>
      <td className="text-right font-mono text-[11px] text-muted tabular-nums">
        {proc.usage.turns}
      </td>
      <td
        className="text-right font-mono text-[11px] text-muted tabular-nums"
        title="Ausgabe-Tokens"
      >
        {fmtTokens(proc.usage.output_tokens)}
      </td>
      <td className="text-right font-mono text-[11px] text-muted tabular-nums">
        {elapsed(proc, now)}
      </td>
      <td className="py-1.5 pr-3 text-right">
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
            className="rounded px-1 leading-none text-muted transition-colors duration-150 hover:bg-red/15 hover:text-red"
          >
            ⏻
          </button>
        )}
      </td>
    </tr>
  );
}

/** A process that has exited keeps the time it took; only a living one follows the clock. */
function elapsed(proc: Proc, now: number): string {
  if (proc.startedAt === null) return "–";
  return fmtDuration((proc.exitedAt ?? now) - proc.startedAt);
}
