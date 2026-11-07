/**
 * Läufe & Replay: everything that has already happened, and the way back into it.
 *
 * Like the munin browser this view is not a projection — a finished run is gone from the live
 * event stream, so its list comes from the API. Pressing "Replay" loads that run's events once
 * and hands them to the store; from there on the shell is a projection again, of a cursor
 * instead of a stream.
 */

import type { ReactNode } from "react";
import { useLoaded } from "../../hooks/useLoaded";
import { getRecordings, getRuns } from "../../lib/api";
import { Chip, type Tone } from "../../components/Chip";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { STATE_LABEL } from "../../lib/i18n";
import type { Run } from "../../state/types";
import { fmtDateTimeDe } from "../../lib/time";
import { ReplayRow } from "./ReplayRow";
import { useReplayLauncher } from "./useReplayLauncher";

const RUN_TONE: Record<Run["state"], Tone> = { running: "blue", done: "green", failed: "red" };

export function RunsView() {
  const runs = useLoaded(getRuns);
  const recordings = useLoaded(getRecordings);
  const { busy, problem, startRun, startRecording } = useReplayLauncher();

  const ordered = [...(runs.rows ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const showRuns = !__REPLAY_ONLY__;

  return (
    <div className="h-full overflow-y-auto bg-surface">
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
            onReplay={() => void startRecording(recording.slug)}
          />
        ))}
      </Section>
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
