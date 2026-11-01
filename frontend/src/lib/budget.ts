import type { Tone } from "../components/Chip";

/** Red is reserved for real danger: a gauge only turns amber and red as the budget runs out. */
export function budgetTone(pct: number): Tone {
  if (pct >= 0.85) return "red";
  if (pct >= 0.6) return "amber";
  return "green";
}

/** The fill colour of a gauge segment row, per tone. */
export const FILL_CLASS: Record<Tone, string> = {
  blue: "bg-blue",
  teal: "bg-teal",
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
  plum: "bg-plum",
  muted: "bg-muted",
};
