import { fmtDuration } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/i18n";
import type { ProcState, Proc, Run } from "../../state/types";
import { occupancyOf } from "./occupancy";

const BAR_COLOR: Record<ProcState, string> = {
  queued: "bg-muted",
  spawning: "bg-amber",
  running: "bg-green",
  waiting_tool: "bg-amber",
  done: "bg-green",
  failed: "bg-red",
  killed: "bg-red",
};

type OccupancyChartProps = {
  run: Run;
  procs: Proc[];
  now: number;
};

/**
 * Who held a slot when. The diagram above shows the structure of a mission; this shows its
 * time, so parallel scouts read as parallel and a long wait reads as a long bar. The thin line
 * is "now" (or the replay cursor).
 */
export function OccupancyChart({ run, procs, now }: OccupancyChartProps) {
  const { bars, ticks, cursor } = occupancyOf(run, procs, now);
  if (bars.length === 0) return null;

  return (
    <section aria-label="Belegungsplan" className="border-t border-text/20 bg-surface-2 px-4 pt-3 pb-2 short:pt-2 short:pb-1">
      <h2 className="font-display text-[17px] leading-none font-semibold text-text">Belegungsplan</h2>
      <div className="mt-2 flex gap-3">
        <ul className="w-[6.5rem] shrink-0">
          {bars.map((bar) => (
            <li
              key={bar.pid}
              className="h-6 truncate text-[13px] leading-6 text-text short:h-[19px] short:leading-[19px]"
            >
              {ROLE_LABEL[bar.program] ?? bar.program}{" "}
              <span className="font-mono text-[11px] text-muted">{bar.pid}</span>
            </li>
          ))}
        </ul>
        <div className="relative min-w-0 flex-1">
          {bars.map((bar) => (
            <div key={bar.pid} className="relative h-6 short:h-[19px]">
              {/* The rail the process runs on; the bar is the train standing on it. */}
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border" />
              <span
                data-testid="occupancy-bar"
                className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px] ${BAR_COLOR[bar.state]}`}
                style={{ left: `${bar.from * 100}%`, width: `${Math.max(0.6, (bar.to - bar.from) * 100)}%` }}
              />
            </div>
          ))}
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-text"
            style={{ left: `${cursor * 100}%` }}
          />
          <div className="relative mt-1 h-4">
            {ticks.map((tick) => (
              <span
                key={tick.at}
                className="absolute top-0 text-[11px] whitespace-nowrap text-muted tabular-nums"
                style={{
                  left: `${tick.fraction * 100}%`,
                  transform: tick.fraction > 0.95 ? "translateX(-100%)" : undefined,
                }}
              >
                {fmtDuration(tick.at)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
