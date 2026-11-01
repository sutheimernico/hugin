import { StateRing } from "../../components/StateRing";
import { stateLine } from "../../lib/activity";
import { budgetTone, FILL_CLASS } from "../../lib/budget";
import { fmtTokens } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/i18n";
import { FALLBACK_ICON, PROGRAM_ICON, programAccent } from "../../lib/programs";
import type { Proc } from "../../state/types";
import { treeRows } from "./tree";

const INDENT = 22;

type ProcessTreeProps = {
  procs: Proc[];
  selectedPid: number | null;
  onSelect: (pid: number) => void;
};

/**
 * The signal-box diagram on a phone: the same lamps, gauges and activity lines, laid out as a
 * vertical spawn tree with a track running down its left edge. A diagram that needs 800 px of
 * width is not squeezed into 390; it is re-drawn for the axis the screen has.
 */
export function ProcessTree({ procs, selectedPid, onSelect }: ProcessTreeProps) {
  const rows = treeRows(procs);
  return (
    <ol aria-label="Prozessbaum" className="px-4 py-3">
      {rows.map(({ proc, depth, last, trail }) => {
        const Icon = PROGRAM_ICON[proc.program] ?? FALLBACK_ICON;
        const selected = proc.pid === selectedPid;
        return (
          <li key={proc.pid} data-testid="tree-row" className="relative">
            {/* Track: a vertical rail for every ancestor level that still has siblings, and an
                elbow into this row at its own level. */}
            {trail.slice(1).map((ancestorLast, k) =>
              ancestorLast ? null : (
                <span
                  key={k}
                  aria-hidden
                  className="absolute inset-y-0 w-0.5 bg-text/35"
                  style={{ left: k * INDENT + 10 }}
                />
              ),
            )}
            {depth > 0 && (
              <span
                aria-hidden
                className={`absolute top-0 w-0.5 bg-text/35 ${last ? "h-8" : "h-full"}`}
                style={{ left: (depth - 1) * INDENT + 10 }}
              />
            )}
            {depth > 0 && (
              <span
                aria-hidden
                className="absolute top-8 h-0.5 bg-text/35"
                style={{ left: (depth - 1) * INDENT + 10, width: INDENT - 2 }}
              />
            )}
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(proc.pid)}
              style={{ marginLeft: depth * INDENT, width: `calc(100% - ${depth * INDENT}px)` }}
              className={`ease-out-expo my-1.5 flex items-stretch overflow-hidden rounded-part border-[1.5px] bg-surface text-left transition-colors duration-150 ${
                selected ? "border-text" : "border-text/35"
              }`}
            >
              <span
                aria-hidden
                className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-surface-2 pt-2.5"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-text">
                  <StateRing state={proc.state} size={14} />
                </span>
                <span className="mt-0.5 w-[3px] flex-1 bg-text" />
                <span className="h-1 w-5 bg-text" />
              </span>
              <span className="min-w-0 flex-1 px-3 py-2.5">
                <span className="flex items-center gap-1.5">
                  <Icon size={16} style={{ color: programAccent(proc.program) }} aria-hidden />
                  <span className="font-display truncate text-[19px] leading-6 font-semibold text-text">
                    {ROLE_LABEL[proc.program] ?? proc.role}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-muted tabular-nums">
                    PID {proc.pid}
                  </span>
                </span>
                <span className="block truncate text-[13px] text-text">
                  {stateLine(proc)}
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="hugin-gauge min-w-0 flex-1" aria-hidden>
                    <span
                      className={FILL_CLASS[budgetTone(proc.budgetPct)]}
                      style={{ transform: `scaleX(${Math.min(1, proc.budgetPct)})` }}
                    />
                  </span>
                  <span className="font-display text-[14px] font-semibold text-text tabular-nums">
                    {fmtTokens(proc.usage.output_tokens)}
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
