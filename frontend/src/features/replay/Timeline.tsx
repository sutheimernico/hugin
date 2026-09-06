/**
 * The replay timeline (spec §2.9, view 5): docked at the bottom in place of the mission bar
 * for as long as the shell is replaying.
 *
 * The player lives in an effect, not in the store: one `setTimeout` per event, re-scheduled by
 * the cursor it just moved. React then owns its lifetime — pausing, seeking, changing speed and
 * unmounting all cancel the pending tick through the same cleanup, so no timer can outlive the
 * thing it was driving.
 */

import { Pause, Play } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../components/Button";
import { Kbd } from "../../components/Kbd";
import { fmtDuration } from "../../lib/format";
import { SPEEDS, useHuginStore, type ReplaySlice, type Speed } from "../../state/store";
import type { HEvent } from "../../state/types";
import { coalesce, fractionOfSeq, nextTick, seqAtFraction, tsAtSeq } from "./replayMath";

/** The range input is integer-valued, so the track is a thousand steps of the run's time. */
const TRACK_STEPS = 1_000;

/** The two moments worth finding again by eye: a process appearing and a result being written. */
const MARKER_CLASS: Record<string, string> = {
  "proc.spawned": "bg-cyan",
  "artifact.written": "bg-green",
};

export function Timeline() {
  const replay = useHuginStore((store) => store.replay);
  const seek = useHuginStore((store) => store.seek);
  const play = useHuginStore((store) => store.play);
  const pause = useHuginStore((store) => store.pause);
  const setSpeed = useHuginStore((store) => store.setSpeed);
  const step = useHuginStore((store) => store.step);
  const exitReplay = useHuginStore((store) => store.exitReplay);

  const { events, cursorSeq, playing, speed } = replay;
  usePlayer(replay, seek, pause);
  useShortcuts({ playing, play, pause, step, exitReplay });

  const start = events[0]?.ts ?? 0;
  const elapsed = tsAtSeq(events, cursorSeq) - start;
  const total = (events.at(-1)?.ts ?? 0) - start;
  const fraction = fractionOfSeq(events, cursorSeq);

  return (
    <footer className="flex h-14 items-center gap-3 border-t border-border bg-surface/60 px-4">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Abspielen"}
        onClick={playing ? pause : play}
        className="ease-out-expo flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet/50 text-violet transition-colors duration-150 hover:bg-violet/15"
      >
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>

      <div className="flex shrink-0 items-center rounded-panel border border-border p-0.5">
        {SPEEDS.map((option) => (
          <SpeedButton key={option} speed={option} active={option === speed} onPick={setSpeed} />
        ))}
      </div>

      <Track events={events} fraction={fraction} onSeek={seek} />

      <span
        data-testid="replay-time"
        className="shrink-0 font-mono text-[11px] text-muted tabular-nums"
      >
        {fmtDuration(elapsed)} / {fmtDuration(total)}
      </span>

      <span className="hidden min-w-0 max-w-56 truncate text-[12px] text-muted lg:inline" title={goalOf(events)}>
        {goalOf(events)}
      </span>

      <Button variant="ghost" size="sm" className="shrink-0" onClick={exitReplay}>
        Beenden <Kbd>Esc</Kbd>
      </Button>
    </footer>
  );
}

function SpeedButton({
  speed,
  active,
  onPick,
}: {
  speed: Speed;
  active: boolean;
  onPick: (speed: Speed) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onPick(speed)}
      className={`ease-out-expo h-6 rounded px-1.5 font-mono text-[11px] transition-colors duration-150 ${
        active ? "bg-violet/20 text-violet" : "text-muted hover:text-text"
      }`}
    >
      {speed}×
    </button>
  );
}

/** Hairline track, violet fill up to the cursor, event markers, and the range input on top. */
function Track({
  events,
  fraction,
  onSeek,
}: {
  events: HEvent[];
  fraction: number;
  onSeek: (seq: number) => void;
}) {
  return (
    <div className="relative h-6 min-w-0 flex-1">
      <div className="pointer-events-none absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-border" />
      <div
        className="pointer-events-none absolute top-1/2 left-0 h-px -translate-y-1/2 bg-violet"
        style={{ width: `${fraction * 100}%` }}
      />
      {events
        .filter((event) => MARKER_CLASS[event.kind] !== undefined)
        .map((event) => (
          <span
            key={event.seq}
            data-testid="replay-marker"
            className={`pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 opacity-70 ${MARKER_CLASS[event.kind]}`}
            style={{ left: `${fractionOfSeq(events, event.seq) * 100}%` }}
          />
        ))}
      <input
        type="range"
        aria-label="Zeitleiste"
        min={0}
        max={TRACK_STEPS}
        step={1}
        value={Math.round(fraction * TRACK_STEPS)}
        onChange={(event) => onSeek(seqAtFraction(events, Number(event.target.value) / TRACK_STEPS))}
        className="hugin-scrubber absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
      />
    </div>
  );
}

/** One pending tick at a time; the cursor it sets re-runs this effect and schedules the next. */
function usePlayer(
  replay: ReplaySlice,
  seek: (seq: number) => void,
  pause: () => void,
): void {
  const { events, cursorSeq, playing, speed } = replay;

  useEffect(() => {
    if (!playing) return;
    const tick = nextTick(events, cursorSeq, speed);
    // The end of the run is a stop, not a loop: ▶ is what starts it over.
    if (tick === null) {
      pause();
      return;
    }
    // Everything due within the same frame moves the cursor once, so a dense burst of events
    // costs one render instead of fifty and the player keeps the speed it advertises.
    const timer = window.setTimeout(() => seek(coalesce(events, tick.seq, speed)), tick.delayMs);
    return () => window.clearTimeout(timer);
  }, [events, cursorSeq, playing, speed, seek, pause]);
}

function useShortcuts(actions: {
  playing: boolean;
  play: () => void;
  pause: () => void;
  step: (delta: 1 | -1) => void;
  exitReplay: () => void;
}): void {
  const { playing, play, pause, step, exitReplay } = actions;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The palette and every search field win: a shortcut must never eat a keystroke meant
      // for text. The scrubber is exempt — it is an input nobody types into.
      if (isTyping(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        if (playing) pause();
        else play();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "Escape") {
        exitReplay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, play, pause, step, exitReplay]);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target instanceof HTMLInputElement && target.type !== "range";
}

/** The goal of the replayed run, read straight out of the event that created it. */
function goalOf(events: HEvent[]): string {
  const created = events.find((event) => event.kind === "run.created");
  return typeof created?.data.goal === "string" ? created.data.goal : "";
}
