import { Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { CountUp } from "../../components/CountUp";
import { goalText } from "../../lib/describe";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { DRIVER_LABEL } from "../../lib/i18n";
import { applyEvents, initialState } from "../../state/reducer";
import { selectProcs } from "../../state/selectors";
import type { HEvent } from "../../state/types";
import { OccupancyChart } from "../graph/OccupancyChart";
import { ledgerOf } from "../shell/ledger";

type RunPreviewProps = {
  /** Identifies what is previewed; a change starts a fresh load. */
  sourceKey: string;
  goal: string;
  driver: string;
  load: () => Promise<HEvent[]>;
  busy: boolean;
  onReplay: () => void;
};

/**
 * What a run looked like in the end, before anyone presses Replay: its occupancy plan and
 * the four ledger numbers, folded out of the very events the replay would play. It answers
 * "which of these is worth watching" and gives the view something to show besides a list.
 */
export function RunPreview({ sourceKey, goal, driver, load, busy, onReplay }: RunPreviewProps) {
  const [loaded, setLoaded] = useState<{ key: string; events: HEvent[] | null }>({
    key: sourceKey,
    events: null,
  });

  useEffect(() => {
    let live = true;
    load()
      .then((events) => live && setLoaded({ key: sourceKey, events }))
      .catch(() => live && setLoaded({ key: sourceKey, events: [] }));
    return () => {
      live = false;
    };
    // `load` is a fresh closure per render; `sourceKey` names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const events = loaded.key === sourceKey ? loaded.events : null;
  const final = useMemo(() => (events === null ? null : applyEvents(initialState, events)), [events]);
  const run = final?.activeRunId == null ? undefined : final.runs[final.activeRunId];
  const end = events?.at(-1)?.ts ?? 0;

  return (
    <aside aria-label="Vorschau" className="flex min-w-0 flex-col bg-surface">
      <div className="border-b border-border px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="muted">{DRIVER_LABEL[driver] ?? driver}</Chip>
          {run?.artifacts.map((name) => (
            <Chip key={name} tone="green">
              {name}
            </Chip>
          ))}
        </div>
        <h2 className="font-display mt-3 line-clamp-4 text-[24px] leading-[1.15] font-semibold text-text">
          {goalText(goal)}
        </h2>
        <Button variant="primary" size="md" disabled={busy} onClick={onReplay} className="mt-4">
          <Play size={14} fill="currentColor" aria-hidden />
          {busy ? "lädt…" : "Replay starten"}
        </Button>
      </div>

      {run === undefined || final === null ? (
        <p className="px-5 py-8 text-[13px] text-muted">
          {events === null ? "Lade Vorschau …" : "Keine Vorschau verfügbar."}
        </p>
      ) : (
        <Summary key={sourceKey} run={run} final={final} end={end} />
      )}
    </aside>
  );
}

function Summary({
  run,
  final,
  end,
}: {
  run: NonNullable<ReturnType<typeof applyEvents>["runs"][string]>;
  final: ReturnType<typeof applyEvents>;
  end: number;
}) {
  const procs = selectProcs(final, run.id);
  const ledger = ledgerOf(run, procs, end);
  return (
    <>
      <dl className="grid grid-cols-4 gap-x-3 border-b border-border px-5 py-4">
        <Number label="Laufzeit" value={fmtDuration(ledger.elapsed)} />
        <Number label="Runden" value={<CountUp value={ledger.turns} />} />
        <Number label="Tokens" value={<CountUp value={ledger.outputTokens} format={fmtTokens} />} />
        <Number label="Agenten" value={<CountUp value={ledger.procsTotal} />} />
      </dl>
      <OccupancyChart run={run} procs={procs} now={end} />
    </>
  );
}

function Number({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dd className="font-display text-[28px] leading-none font-semibold text-text tabular-nums">{value}</dd>
      <dt className="mt-1 truncate text-[11px] text-muted">{label}</dt>
    </div>
  );
}
