import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import type { Tone } from "./Chip";

const FILL_CLASS: Record<Tone, string> = {
  violet: "bg-violet",
  cyan: "bg-cyan",
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
  rose: "bg-rose",
  muted: "bg-muted",
};

/** House easing and the UI transition length (spec §2.9 motion rules). */
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
const TICK_S = 0.4;

type MeterProps = {
  label: string;
  value: number;
  max: number;
  tone: Tone;
  format?: (value: number) => string;
};

/** Labelled bar with a mono readout: the bar animates its width, the readout counts up to it. */
export function Meter({ label, value, max, tone, format }: MeterProps) {
  const ticked = useTicker(value);
  const readout = useTransform(ticked, (current) => {
    const rounded = Math.round(current);
    return format ? format(rounded) : String(rounded);
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        {/* Neither half may wrap: two meters side by side would then overlap (see TopBar). */}
        <span className="truncate text-[11px] tracking-[0.12em] whitespace-nowrap text-muted uppercase">
          {label}
        </span>
        <motion.span className="font-mono text-[11px] whitespace-nowrap text-text">
          {readout}
        </motion.span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-1 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className={`ease-out-expo h-full rounded-full transition-[width] duration-400 ${FILL_CLASS[tone]}`}
          style={{ width: `${percent(value, max)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Counts the readout from where it stood to where it is now, over 400 ms.
 *
 * The animation hangs off the effect's dependency on `value`, so it starts on a real change
 * and on nothing else — a re-render with the same number never re-triggers it.
 */
function useTicker(value: number) {
  const current = useMotionValue(value);

  useEffect(() => {
    const controls = animate(current, value, { duration: TICK_S, ease: EASE_OUT_EXPO });
    return () => controls.stop();
  }, [value, current]);

  return current;
}

function percent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, value / max));
  return Math.round(ratio * 10_000) / 100;
}
