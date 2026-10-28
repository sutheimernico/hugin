import type { ReactNode } from "react";

export type Tone = "blue" | "teal" | "green" | "amber" | "red" | "plum" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  blue: "border-blue/50 bg-blue/10 text-blue",
  teal: "border-teal/50 bg-teal/10 text-teal",
  green: "border-green/50 bg-green/10 text-green",
  amber: "border-amber/50 bg-amber/10 text-amber",
  red: "border-red/50 bg-red/10 text-red",
  plum: "border-plum/50 bg-plum/10 text-plum",
  muted: "border-border bg-surface-2 text-muted",
};

type ChipProps = {
  tone: Tone;
  /** Live elements only — adds a lamp dot that breathes. */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
};

/** A label plate: squared like a sign, with a lamp dot when what it names is live. */
export function Chip({ tone, pulse, className = "", children }: ChipProps) {
  return (
    <span
      data-tone={tone}
      data-pulse={pulse ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-part border px-1.5 py-0.5 text-[11px] leading-4 font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {pulse === true && (
        <span
          aria-hidden
          className="hugin-lamp size-1.5"
          data-state="running"
          style={{ background: "currentColor" }}
        />
      )}
      {children}
    </span>
  );
}
