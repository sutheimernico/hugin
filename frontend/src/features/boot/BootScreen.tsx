/**
 * The first thing anyone sees: a full-screen log that types out what this machine can actually
 * do, then the wordmark, then it lifts (spec §2.9, view 1).
 *
 * Every line comes from `/api/system` — the same snapshot the palette gates its drivers with —
 * so this is a status report, not a splash animation. A subsystem that is missing says so in
 * amber; a kernel that cannot be reached at all says so in red and the sequence still ends,
 * because the shell behind it renders its honest empty state either way.
 *
 * Timing is timer-driven, never animation-driven: six lines × 140 ms plus wordmark, hold and
 * lift is 2.14 s, and skipping (Esc or a click) ends it at once.
 */

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSystem } from "../../lib/api";
import { useHuginStore } from "../../state/store";
import {
  type BootLine,
  bootLines,
  HOLD_MS,
  LIFT_MS,
  LINE_MS,
  REDUCED_MS,
  SEQUENCE_TAIL_MS,
  TAGLINE,
  type Tone,
  WORDMARK,
  WORDMARK_MS,
} from "./sequence";

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-text",
  warn: "text-amber",
  error: "text-red",
};

type Phase = "log" | "wordmark" | "lifting";

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * Shown once per browser session. `onDone` owns the session flag — the screen only reports that
 * it is finished, whether that came from the timeline or from a skip.
 */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const setSystem = useHuginStore((store) => store.setSystem);
  const [lines, setLines] = useState<BootLine[] | null>(null);
  const [typed, setTyped] = useState(0);
  const [step, setStep] = useState<Phase>("log");
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  // The status is fetched here rather than waited for elsewhere: the shell's SSE stream is
  // already open behind this overlay, and a failed request is a line in the log, not an error
  // state. The kernel caches the snapshot, so the shell's own poll costs nothing extra.
  useEffect(() => {
    let live = true;
    void getSystem()
      .then((system) => {
        if (!live) return;
        setSystem(system);
        setLines(bootLines(system));
      })
      .catch(() => {
        if (live) setLines(bootLines(null));
      });
    return () => {
      live = false;
    };
  }, [setSystem]);

  useEffect(() => {
    if (lines === null) return;
    // Reduced motion has no timeline to run: the finished report is already on screen (see
    // `shown`/`phase` below) and only the exit is scheduled.
    if (reduced) {
      const timer = window.setTimeout(finish, REDUCED_MS);
      return () => window.clearTimeout(timer);
    }
    const logMs = lines.length * LINE_MS;
    const timers = lines.map((_, index) =>
      window.setTimeout(() => setTyped(index + 1), index * LINE_MS),
    );
    timers.push(
      window.setTimeout(() => setStep("wordmark"), logMs),
      window.setTimeout(() => setStep("lifting"), logMs + WORDMARK_MS + HOLD_MS),
      window.setTimeout(finish, logMs + SEQUENCE_TAIL_MS),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [lines, reduced, finish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  // Under reduced motion the sequence is not run but skipped to its end, so both are derived
  // rather than set — the effect above never has to write state synchronously.
  const shown = reduced && lines !== null ? lines.length : typed;
  const phase: Phase = reduced && lines !== null ? "wordmark" : step;
  const totalMs = lines === null ? 0 : lines.length * LINE_MS + SEQUENCE_TAIL_MS;
  const assembling = phase !== "log";
  // Reduced motion gets the same end state, just without the staggered walk towards it.
  const letterIn = (index: number) =>
    reduced ? { duration: 0 } : { delay: index * 0.04, duration: 0.3, ease: EASE_OUT_EXPO };
  const taglineIn = reduced
    ? { duration: 0 }
    : { delay: 0.24, duration: 0.3, ease: EASE_OUT_EXPO };

  return (
    <motion.div
      role="status"
      aria-label="Startsequenz"
      onClick={finish}
      className="fixed inset-0 z-50 flex flex-col justify-center gap-10 bg-base px-8 py-10 sm:px-16"
      initial={false}
      animate={phase === "lifting" ? { opacity: 0, scale: 1.02 } : { opacity: 1, scale: 1 }}
      transition={{ duration: LIFT_MS / 1_000, ease: EASE_OUT_EXPO }}
    >
      <ul className="mono flex flex-col gap-1 text-[13px] leading-relaxed">
        {/* Every line holds its place from the start and only becomes visible when it is
            typed: slicing the list would let the whole block drift upwards line by line. */}
        {(lines ?? []).map((line, index) => (
          <li
            key={line.key}
            data-tone={line.tone}
            className={`flex gap-3 ${TONE_CLASS[line.tone]}`}
            style={{ visibility: index < shown ? "visible" : "hidden" }}
          >
            {/* The spaces keep the line one readable string when it is selected or copied;
                a flex container drops whitespace-only children, so nothing moves. */}
            <span className="w-28 shrink-0 text-muted">{line.label}</span>{" "}
            <span className="min-w-0 break-all">{line.detail}</span>
            {line.mark !== "" && (
              <>
                {" "}
                <span aria-hidden="true">{line.mark}</span>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Kept in the layout from the first frame: mounting it later would shove the log up
          mid-sequence. `visibility` also keeps it out of the accessibility tree until the
          wordmark is really there. */}
      <div
        className="flex flex-col gap-3"
        style={{ visibility: phase === "log" ? "hidden" : "visible" }}
      >
        <div
          role="img"
          aria-label={WORDMARK}
          className="font-display flex text-[clamp(3rem,12vw,7rem)] leading-none font-bold tracking-[0.12em] text-text"
          // The one glow in the shell that is not on live data: the hero of this view.
          style={{ textShadow: "0 0 56px rgba(110, 91, 255, 0.30)" }}
        >
          {[...WORDMARK].map((letter, index) => (
            <motion.span
              key={`${letter}-${index}`}
              aria-hidden="true"
              initial={false}
              animate={assembling ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
              transition={letterIn(index)}
            >
              {letter}
            </motion.span>
          ))}
        </div>
        <motion.p
          className="text-[13px] text-muted"
          initial={false}
          animate={{ opacity: assembling ? 1 : 0 }}
          transition={taglineIn}
        >
          {TAGLINE}
        </motion.p>
      </div>

      {lines !== null && (
        <motion.div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-px origin-left bg-violet"
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: totalMs / 1_000, ease: "linear" }}
        />
      )}
    </motion.div>
  );
}
