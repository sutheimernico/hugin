/**
 * How a program looks wherever it appears — the graph node and the agent window must not drift
 * apart, so the icon and the accent live here rather than in either view.
 *
 * Icons and accents mirror `src/hugin/programs/*.yaml`; an unknown program stays neutral.
 */

import { Bot, Compass, Hammer, PenLine, Scale, Telescope, type LucideIcon } from "lucide-react";

/** Every unknown program is drawn the same way; kept separate so a view can `?? FALLBACK_ICON`
 *  — the eslint rule `react-hooks/static-components` rejects a component from a function call. */
export const FALLBACK_ICON: LucideIcon = Bot;

export const PROGRAM_ICON: Record<string, LucideIcon> = {
  planner: Compass,
  scout: Telescope,
  smith: Hammer,
  judge: Scale,
  scribe: PenLine,
};

/**
 * Hex, not `var(--color-…)`, because the glow needs the accent with an alpha suffix. Kept in
 * sync with `styles/tokens.css` by hand — the palette is closed and does not move.
 */
export const PROGRAM_ACCENT: Record<string, string> = {
  planner: "#6E5BFF",
  scout: "#22D3C7",
  smith: "#F5A623",
  judge: "#F472B6",
  scribe: "#3ECF8E",
};

export const NEUTRAL_ACCENT = "#8B92A5";

/** Claude's context window — the reference the fill bars are honest about being measured against. */
export const CONTEXT_WINDOW = 200_000;

export function programAccent(program: string): string {
  return PROGRAM_ACCENT[program] ?? NEUTRAL_ACCENT;
}
