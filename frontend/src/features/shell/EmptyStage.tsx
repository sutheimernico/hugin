import { Command } from "lucide-react";
import type { CSSProperties } from "react";
import { Kbd } from "../../components/Kbd";
import { Track } from "../../components/Track";
import { useLoaded } from "../../hooks/useLoaded";
import { getRecordings } from "../../lib/api";
import { fmtDuration } from "../../lib/format";
import { ReplayRow } from "../replay/ReplayRow";
import { useReplayLauncher } from "../replay/useReplayLauncher";

type EmptyStageProps = {
  /** Opens the command palette; absent in the replay-only build, which has no kernel to command. */
  onOpenPalette?: () => void;
};

/**
 * What an idle kernel shows: the empty track and the way to put something on it. The schema is
 * an outline of a typical mission (one planner, scouts, the memory) with every lamp dark and no
 * figures — it says what the diagram will look like, not that anything is running.
 */
export function EmptyStage({ onOpenPalette }: EmptyStageProps) {
  const recordings = useLoaded(getRecordings);
  const { busy, problem, startRecording } = useReplayLauncher();

  return (
    <div className="flex h-full flex-col overflow-y-auto border-text/20 bg-surface-2 min-[720px]:border-x">
      <div className="grid flex-1 content-center items-center gap-x-10 gap-y-6 px-5 py-8 min-[720px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] min-[1200px]:px-14 min-[1200px]:py-10">
        <div>
          <h1 className="font-display text-[clamp(44px,7vw,76px)] leading-[0.95] font-bold text-text">
            Gleis frei.
          </h1>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-text">
            Noch läuft keine Mission. hugin schickt Agenten als überwachte Prozesse los; hier siehst
            du, wer wen gestartet hat, was gerade passiert und was es kostet.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[14px] text-muted">
            {onOpenPalette !== undefined && (
              <button
                type="button"
                onClick={onOpenPalette}
                className="ease-out-expo inline-flex h-10 items-center gap-2 rounded-part border border-text bg-text px-4 font-medium text-surface-2 transition-colors duration-150 hover:bg-text/85"
              >
                <Command size={15} aria-hidden />
                Mission starten
                <span className="font-mono text-[12px] opacity-70">⌘K</span>
              </button>
            )}
            <span>
              {onOpenPalette !== undefined ? "oder eine Aufzeichnung abspielen" : "Eine Aufzeichnung abspielen"}
            </span>
          </div>
          {onOpenPalette === undefined && (
            <p className="mt-3 text-[12px] text-muted">
              Diese Seite läuft ohne Kernel. Alles hier ist aufgezeichnet, nichts davon läuft live.
            </p>
          )}
        </div>
        <Schema />
      </div>

      <section aria-label="Aufzeichnungen" className="shrink-0 border-t border-text/20 bg-surface">
        {problem !== null && <p className="px-5 py-3 text-[13px] text-red">{problem}</p>}
        {recordings.error !== null && <p className="px-5 py-4 text-[13px] text-red">{recordings.error}</p>}
        {recordings.rows !== null && recordings.rows.length === 0 && recordings.error === null && (
          <p className="px-5 py-4 text-[13px] text-muted">
            Noch keine Aufzeichnungen. Starte eine Mission mit <Kbd>⌘K</Kbd>.
          </p>
        )}
        {(recordings.rows ?? []).map((recording, index) => (
          <ReplayRow
            key={recording.slug}
            index={index}
            testId="recording-row"
            title={recording.goal === "" ? recording.slug : recording.goal}
            driver={recording.driver}
            meta={[`${recording.events} Ereignisse`, fmtDuration(recording.duration_s)]}
            busy={busy === recording.slug}
            onReplay={() => void startRecording(recording.slug, recording.tokens_lower_bound)}
          />
        ))}
      </section>
    </div>
  );
}

/** Rounded orthogonal path from (x1, y1) to (x2, y2) with the bend in the middle. */
function elbow(x1: number, y1: number, x2: number, y2: number, r = 12): string {
  const mid = (x1 + x2) / 2;
  if (y1 === y2) return `M${x1} ${y1} H${x2}`;
  const dir = y2 > y1 ? 1 : -1;
  return [
    `M${x1} ${y1}`,
    `H${mid - r}`,
    `Q${mid} ${y1} ${mid} ${y1 + dir * r}`,
    `V${y2 - dir * r}`,
    `Q${mid} ${y2} ${mid + r} ${y2}`,
    `H${x2}`,
  ].join(" ");
}

const BOX_W = 150;
const BOX_H = 64;
const SCOUT_Y = [8, 108, 208];

function Schema() {
  const rank = (delay: number) => ({ "--i": delay } as CSSProperties);
  return (
    <svg
      viewBox="0 0 640 280"
      role="img"
      aria-label="Schema eines Stellwerks: ein Planer startet drei Späher, alle schreiben in den Speicher. Alle Signale sind dunkel."
      className="w-full max-w-[640px] min-[720px]:justify-self-end"
    >
      {SCOUT_Y.map((y, i) => (
        <g key={y} className="hugin-rise" style={rank(1 + i)}>
          <Track d={elbow(168, 140, 250, y + BOX_H / 2)} faint />
          <Track d={elbow(250 + BOX_W, y + BOX_H / 2, 462, 140)} faint />
        </g>
      ))}
      <Ghost x={10} y={108} label="Planer" delay={0} />
      {SCOUT_Y.map((y, i) => (
        <Ghost key={y} x={250} y={y} label="Späher" delay={1 + i} />
      ))}
      <Ghost x={462} y={108} label="Speicher" delay={4} />
    </svg>
  );
}

function Ghost({ x, y, label, delay }: { x: number; y: number; label: string; delay: number }) {
  return (
    <g className="hugin-rise" style={{ "--i": delay } as CSSProperties}>
      <rect
        x={x}
        y={y}
        width={BOX_W}
        height={BOX_H}
        rx={4}
        fill="var(--color-surface)"
        stroke="var(--color-text)"
        strokeOpacity={0.4}
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
      <circle cx={x + 22} cy={y + BOX_H / 2} r={7} fill="none" stroke="var(--color-muted)" strokeWidth={1.5} />
      <text
        x={x + 42}
        y={y + BOX_H / 2 + 6}
        fontFamily="var(--font-display)"
        fontSize={20}
        fontWeight={600}
        fill="var(--color-muted)"
      >
        {label}
      </text>
    </g>
  );
}
