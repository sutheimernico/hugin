import type { ReactNode } from "react";

export type Tone = "violet" | "cyan" | "green" | "amber" | "red" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  violet: "border-violet/40 bg-violet/10 text-violet",
  cyan: "border-cyan/40 bg-cyan/10 text-cyan",
  green: "border-green/40 bg-green/10 text-green",
  amber: "border-amber/40 bg-amber/10 text-amber",
  red: "border-red/40 bg-red/10 text-red",
  muted: "border-border bg-surface-2 text-muted",
};

type ChipProps = {
  tone: Tone;
  /** Live elements only — drives the 2.4 s glow loop in globals.css. */
  pulse?: boolean;
  children: ReactNode;
};

export function Chip({ tone, pulse, children }: ChipProps) {
  return (
    <span
      data-pulse={pulse ? "true" : undefined}
      className={`hugin-chip inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
