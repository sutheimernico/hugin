/**
 * Runs & Replay (spec §2.9, view 5): everything that has already happened, and the way back
 * into it.
 *
 * Like the munin browser this view is not a projection — a finished run is gone from the live
 * event stream, so its list comes from the API. Pressing "Replay" loads that run's events once
 * and hands them to the store; from there on the shell is a projection again, of a cursor
 * instead of a stream.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Chip, type Tone } from "../../components/Chip";
import { Panel } from "../../components/Panel";
import {
  getRecordingEvents,
  getRecordings,
  getRunEvents,
  getRuns,
  type ApiRecording,
} from "../../lib/api";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { DRIVER_LABEL, STATE_LABEL } from "../../lib/i18n";
import { fmtDateTimeDe } from "../../lib/time";
import { useHuginStore } from "../../state/store";
import type { Driver, HEvent, Run } from "../../state/types";

const DRIVER_TONE: Record<string, Tone> = {
  claude: "violet",
  ollama: "amber",
  scripted: "cyan",
};

const RUN_TONE: Record<Run["state"], Tone> = {
  running: "violet",
  done: "green",
  failed: "red",
};

export function RunsView() {
  const runs = useLoaded(getRuns);
  const recordings = useLoaded(getRecordings);
  const enterReplay = useHuginStore((store) => store.enterReplay);
  const setView = useHuginStore((store) => store.setView);

  // Which row is fetching its events, and what went wrong if it did not arrive.
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const start = useCallback(
    async (source: { runId?: string; slug?: string }, load: () => Promise<HEvent[]>) => {
      const key = source.runId ?? source.slug ?? "";
      setBusy(key);
      setProblem(null);
      try {
        enterReplay(source, await load());
        setView("control");
      } catch (reason) {
        setProblem(errorText(reason));
      } finally {
        setBusy(null);
      }
    },
    [enterReplay, setView],
  );

  const ordered = [...(runs.rows ?? [])].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Panel title="Runs & Replay" className="h-full" bodyClassName="min-h-0 overflow-y-auto p-0">
      {problem !== null && <p className="border-b border-border p-3 text-[13px] text-red">{problem}</p>}

      <Section title="Läufe">
        {runs.error !== null && <Note tone="error">{runs.error}</Note>}
        {runs.error === null && runs.rows !== null && ordered.length === 0 && (
          <Note>Noch keine Runs — starte eine Mission.</Note>
        )}
        <ul>
          {ordered.map((run) => (
            <li key={run.id}>
              <RunRow
                run={run}
                busy={busy === run.id}
                onReplay={() => void start({ runId: run.id }, () => getRunEvents(run.id, 0))}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Demo-Aufnahmen">
        {recordings.error !== null && <Note tone="error">{recordings.error}</Note>}
        {recordings.error === null && recordings.rows !== null && recordings.rows.length === 0 && (
          <Note>Noch keine Aufnahmen exportiert.</Note>
        )}
        <ul>
          {(recordings.rows ?? []).map((recording) => (
            <li key={recording.slug}>
              <RecordingRow
                recording={recording}
                busy={busy === recording.slug}
                onReplay={() =>
                  void start({ slug: recording.slug }, () => getRecordingEvents(recording.slug))
                }
              />
            </li>
          ))}
        </ul>
      </Section>
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-display sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 text-[11px] tracking-[0.14em] text-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p className={`p-3 text-[13px] ${tone === "error" ? "text-red" : "text-muted"}`}>{children}</p>
  );
}

function RunRow({ run, busy, onReplay }: { run: Run; busy: boolean; onReplay: () => void }) {
  return (
    <Row
      title={run.goal}
      chips={
        <>
          <Chip tone={DRIVER_TONE[run.driver] ?? "muted"}>{driverLabel(run.driver)}</Chip>
          <Chip tone={RUN_TONE[run.state]}>{STATE_LABEL[run.state]}</Chip>
        </>
      }
      meta={[
        fmtDateTimeDe(run.createdAt),
        `${fmtTokens(run.usage.output_tokens)} Tokens`,
        `${run.artifacts.length} Artefakt${run.artifacts.length === 1 ? "" : "e"}`,
      ]}
      busy={busy}
      onReplay={onReplay}
      testId="run-row"
    />
  );
}

function RecordingRow({
  recording,
  busy,
  onReplay,
}: {
  recording: ApiRecording;
  busy: boolean;
  onReplay: () => void;
}) {
  return (
    <Row
      title={recording.goal === "" ? recording.slug : recording.goal}
      chips={
        <>
          <Chip tone="muted" className="font-mono">
            {recording.slug}
          </Chip>
          <Chip tone={DRIVER_TONE[recording.driver] ?? "muted"}>
            {driverLabel(recording.driver)}
          </Chip>
        </>
      }
      meta={[`${recording.events} Ereignisse`, fmtDuration(recording.duration_s)]}
      busy={busy}
      onReplay={onReplay}
      testId="recording-row"
    />
  );
}

type RowProps = {
  title: string;
  chips: ReactNode;
  meta: string[];
  busy: boolean;
  onReplay: () => void;
  testId: string;
};

function Row({ title, chips, meta, busy, onReplay, testId }: RowProps) {
  return (
    <div
      data-testid={testId}
      className="ease-out-expo flex items-center gap-3 border-b border-border/60 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text" title={title}>
          {title}
        </span>
        <span className="mt-1 block truncate font-mono text-[11px] text-muted">
          {meta.join(" · ")}
        </span>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">{chips}</div>
      <Button variant="primary" size="sm" disabled={busy} onClick={onReplay}>
        {busy ? "lädt…" : "Replay"}
      </Button>
    </div>
  );
}

/** An unknown driver is shown as it came, never renamed into something friendlier. */
function driverLabel(driver: Driver | string): string {
  return DRIVER_LABEL[driver] ?? (driver === "" ? "unbekannt" : driver);
}

/** One list, loaded once. `load` is a module-level API function, so the effect runs once. */
function useLoaded<T>(load: () => Promise<T[]>): { rows: T[] | null; error: string | null } {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    load()
      .then((answer) => {
        if (live) setRows(answer);
      })
      .catch((reason: unknown) => {
        if (!live) return;
        setRows([]);
        setError(errorText(reason));
      });
    return () => {
      live = false;
    };
  }, [load]);

  return { rows, error };
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Der Kernel ist gerade nicht erreichbar.";
}
