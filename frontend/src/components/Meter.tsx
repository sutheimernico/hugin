import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { FILL_CLASS } from "../lib/budget";
import type { Tone } from "./Chip";

/** House easing and the UI transition length. */
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

  const fraction = percent(value, max) / 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        {/* Neither half may wrap: two meters side by side would then overlap (see TopBar). */}
        <span className="truncate text-[12px] whitespace-nowrap text-muted">{label}</span>
        <motion.span className="font-display text-[17px] leading-none font-semibold whitespace-nowrap text-text tabular-nums">
          {readout}
        </motion.span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="hugin-gauge w-full"
      >
        <span className={FILL_CLASS[tone]} style={{ transform: `scaleX(${fraction})` }} />
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
