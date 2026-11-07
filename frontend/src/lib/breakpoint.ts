/**
 * The three layouts of the shell. The thresholds are the ones the design note names; they are
 * duplicated in CSS (Tailwind's `min-[720px]` / `min-[900px]`) only where a class is enough.
 */

export type Breakpoint = "mobile" | "tablet" | "desktop";

export const TABLET_MIN = 720;
export const DESKTOP_MIN = 900;

export function breakpointOf(width: number): Breakpoint {
  if (width >= DESKTOP_MIN) return "desktop";
  if (width >= TABLET_MIN) return "tablet";
  return "mobile";
}
