import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Chip, type Tone } from "../../components/Chip";
import { CountUp } from "../../components/CountUp";
import { goalText } from "../../lib/describe";
import { budgetTone, FILL_CLASS } from "../../lib/budget";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { DRIVER_LABEL, STATE_LABEL } from "../../lib/i18n";
import { fmtDateTimeDe } from "../../lib/time";
import type { Proc, Run } from "../../state/types";
import { ledgerOf } from "./ledger";

const RUN_TONE: Record<Run["state"], Tone> = { running: "blue", done: "green", failed: "red" };
type MissionLedgerProps = {
  run: Run;
  procs: Proc[];
  /** Wall clock in seconds while live, the last event's timestamp during replay. */
  now: number;
  replaying: boolean;
};

/**
 * The mission in four numbers: the goal as the headline, then the ledger. No card around it —
 * the numbers sit directly on the console, separated from what follows by one hairline.
 */
export function MissionLedger({ run, procs, now, replaying }: MissionLedgerProps) {
  const ledger = ledgerOf(run, procs, now);
  const tone = budgetTone(ledger.budgetPct);

  return (
    <section aria-label="Mission" className="border-b border-border px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={RUN_TONE[run.state]} pulse={run.state === "running"}>
          {STATE_LABEL[run.state]}
        </Chip>
        <Chip tone="muted">{DRIVER_LABEL[run.driver] ?? run.driver}</Chip>
        <span className="text-[12px] text-muted">
          {replaying ? "Aufgezeichnet " : "Gestartet "}
          {fmtDateTimeDe(run.createdAt)}
        </span>
      </div>

      <h1
        className="font-display mt-2.5 line-clamp-5 text-[21px] leading-[1.18] font-semibold text-text"
        title={run.goal}
      >
        {goalText(run.goal)}
      </h1>
      {run.driver === "scripted" && !replaying && (
        <p className="mt-1.5 text-[12px] text-amber">Simulation: feste Beispiel-Mission</p>
      )}

      <dl className="mt-4 grid grid-cols-4 gap-x-3">
        <Figure label="Laufzeit" value={fmtDuration(ledger.elapsed)} />
        <Figure label="Runden" value={<CountUp value={ledger.turns} />} />
        <Figure label="Tokens" value={<CountUp value={ledger.outputTokens} format={fmtTokens} />} />
        <Figure
          label="Agenten"
          value={
            <>
              <CountUp value={ledger.procsAlive} />
              <span className="text-[16px] text-muted">/{ledger.procsTotal}</span>
            </>
          }
        />
      </dl>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[12px] text-muted">
          <span>Budget, vollster Agent</span>
          <span className="font-display text-[15px] font-semibold text-text tabular-nums">
            {Math.round(ledger.budgetPct * 100)} %
          </span>
        </div>
        <div className="hugin-gauge mt-1" role="presentation">
          <span className={FILL_CLASS[tone]} style={{ transform: `scaleX(${ledger.budgetPct})` }} />
        </div>
      </div>

      {run.artifacts.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          <FileText size={14} aria-hidden />
          {run.artifacts.join(", ")}
        </p>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dd className="font-display text-[28px] leading-none font-semibold text-text tabular-nums">
        {value}
      </dd>
      <dt className="mt-1 truncate text-[11px] text-muted">{label}</dt>
    </div>
  );
}
