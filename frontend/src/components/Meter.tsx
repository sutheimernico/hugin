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

type MeterProps = {
  label: string;
  value: number;
  max: number;
  tone: Tone;
  format?: (value: number) => string;
};

/** Labelled 4 px bar with a mono readout; the bar animates its width, never its value. */
export function Meter({ label, value, max, tone, format }: MeterProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        {/* Neither half may wrap: two meters side by side would then overlap (see TopBar). */}
        <span className="truncate text-[11px] tracking-[0.12em] whitespace-nowrap text-muted uppercase">
          {label}
        </span>
        <span className="font-mono text-[11px] whitespace-nowrap text-text">
          {format ? format(value) : String(value)}
        </span>
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

function percent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, value / max));
  return Math.round(ratio * 10_000) / 100;
}
