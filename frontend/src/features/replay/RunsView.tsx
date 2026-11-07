/**
 * Läufe & Replay: everything that has already happened, and the way back into it.
 *
 * Like the munin browser this view is not a projection — a finished run is gone from the live
 * event stream, so its list comes from the API. Pressing "Replay" loads that run's events once
 * and hands them to the store; from there on the shell is a projection again, of a cursor
 * instead of a stream.
 */

import { useState, type ReactNode } from "react";
import { useLoaded } from "../../hooks/useLoaded";
import { getRecordingEvents, getRecordings, getRunEvents, getRuns } from "../../lib/api";
import { Chip, type Tone } from "../../components/Chip";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { STATE_LABEL } from "../../lib/i18n";
import type { Run } from "../../state/types";
import { fmtDateTimeDe } from "../../lib/time";
import { ReplayRow } from "./ReplayRow";
import { RunPreview } from "./RunPreview";
import { useReplayLauncher } from "./useReplayLauncher";

const RUN_TONE: Record<Run["state"], Tone> = { running: "blue", done: "green", failed: "red" };

export function RunsView() {
  const runs = useLoaded(getRuns);
  const recordings = useLoaded(getRecordings);
  const { busy, problem, startRun, startRecording } = useReplayLauncher();

  const ordered = [...(runs.rows ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const showRuns = !__REPLAY_ONLY__;

  // What the preview shows: the row the reader pointed at, otherwise the first recording —
  // the Claude run, which is the one worth seeing first.
  const [pick, setPick] = useState<{ kind: "run" | "recording"; id: string } | null>(null);
  const first = recordings.rows?.[0];
  const chosen =
    pick ?? (first === undefined ? null : ({ kind: "recording", id: first.slug } as const));
  const chosenRun = chosen?.kind === "run" ? ordered.find((run) => run.id === chosen.id) : undefined;
  const chosenRecording =
    chosen?.kind === "recording" ? recordings.rows?.find((rec) => rec.slug === chosen.id) : undefined;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-surface min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(400px,38%)]">
    <div className="min-h-0 overflow-y-auto">
      <header className="border-b border-border px-5 py-5">
        <h1 className="font-display text-[30px] leading-none font-semibold text-text">
          Läufe &amp; Replay
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted">
          Jeder Lauf ist ein Ereignisprotokoll. Replay spielt es im Stellwerk noch einmal ab, mit
          Zeitleiste, Tempo und Einzelschritt.
        </p>
      </header>
      {problem !== null && (
        <p className="border-b border-border px-5 py-3 text-[13px] text-red">{problem}</p>
      )}

      {showRuns && (
        <Section title="Eigene Läufe">
          {runs.error !== null && <Note tone="error">{runs.error}</Note>}
          {runs.error === null && runs.rows !== null && ordered.length === 0 && (
            <Note>Noch keine Läufe — starte eine Mission.</Note>
          )}
          {ordered.map((run, index) => (
            <ReplayRow
              key={run.id}
              index={index}
              testId="run-row"
              title={run.goal}
              driver={run.driver}
              extra={
                <Chip tone={RUN_TONE[run.state]}>{STATE_LABEL[run.state]}</Chip>
              }
              meta={[
                fmtDateTimeDe(run.createdAt),
                `${fmtTokens(run.usage.output_tokens)} Tokens`,
                `${run.artifacts.length} Artefakt${run.artifacts.length === 1 ? "" : "e"}`,
              ]}
              busy={busy === run.id}
              selected={chosen?.kind === "run" && chosen.id === run.id}
              onSelect={() => setPick({ kind: "run", id: run.id })}
              onReplay={() => void startRun(run.id)}
            />
          ))}
        </Section>
      )}

      <Section title="Demo-Aufnahmen">
        {recordings.error !== null && <Note tone="error">{recordings.error}</Note>}
        {recordings.error === null && recordings.rows !== null && recordings.rows.length === 0 && (
          <Note>Noch keine Aufnahmen exportiert.</Note>
        )}
        {(recordings.rows ?? []).map((recording, index) => (
          <ReplayRow
            key={recording.slug}
            index={index}
            testId="recording-row"
            title={recording.goal === "" ? recording.slug : recording.goal}
            driver={recording.driver}
            meta={[`${recording.events} Ereignisse`, fmtDuration(recording.duration_s)]}
            extra={<span className="font-mono text-[12px]">{recording.slug}</span>}
            busy={busy === recording.slug}
            selected={chosen?.kind === "recording" && chosen.id === recording.slug}
            onSelect={() => setPick({ kind: "recording", id: recording.slug })}
            onReplay={() => void startRecording(recording.slug, recording.tokens_lower_bound)}
          />
        ))}
      </Section>
    </div>
    <div className="hidden min-h-0 overflow-y-auto border-l border-text/20 min-[1000px]:block">
      {chosenRun !== undefined && (
        <RunPreview
          sourceKey={`run:${chosenRun.id}`}
          goal={chosenRun.goal}
          driver={chosenRun.driver}
          load={() => getRunEvents(chosenRun.id, 0)}
          busy={busy === chosenRun.id}
          onReplay={() => void startRun(chosenRun.id)}
        />
      )}
      {chosenRecording !== undefined && (
        <RunPreview
          sourceKey={`recording:${chosenRecording.slug}`}
          goal={chosenRecording.goal === "" ? chosenRecording.slug : chosenRecording.goal}
          driver={chosenRecording.driver}
          load={() => getRecordingEvents(chosenRecording.slug)}
          busy={busy === chosenRecording.slug}
          onReplay={() => void startRecording(chosenRecording.slug, chosenRecording.tokens_lower_bound)}
        />
      )}
    </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display border-b border-border bg-base/60 px-5 py-2 text-[16px] font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p className={`px-5 py-4 text-[13px] ${tone === "error" ? "text-red" : "text-muted"}`}>
      {children}
    </p>
  );
}
