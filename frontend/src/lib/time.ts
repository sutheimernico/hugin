/**
 * Timestamps for German readers. The kernel measures time in seconds since the epoch (floats);
 * everything a reader sees is derived here, so a memory, a run and a log line all age alike.
 *
 * Deliberately local time and deliberately no `Intl`: the shell must read the same on a laptop
 * with a trimmed ICU build as on a full one, and the two shapes below are all it needs.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago something happened: "gerade eben" · "vor 7 Min." · "vor 3 Std." · "vor 2 Tagen". */
export function relativeTimeDe(tsSeconds: number, nowSeconds: number): string {
  if (!Number.isFinite(tsSeconds) || !Number.isFinite(nowSeconds)) return "–";
  // Two clocks (browser and kernel) never agree to the second — a future stamp is "just now",
  // not a negative age.
  const age = Math.max(0, nowSeconds - tsSeconds);
  if (age <= MINUTE) return "gerade eben";
  if (age < HOUR) return `vor ${Math.floor(age / MINUTE)} Min.`;
  if (age < DAY) return `vor ${Math.floor(age / HOUR)} Std.`;
  const days = Math.floor(age / DAY);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/** The exact moment, for a provenance line: `05.09.2026 07:04`. */
export function fmtDateTimeDe(tsSeconds: number): string {
  if (!Number.isFinite(tsSeconds)) return "–";
  const at = new Date(tsSeconds * 1_000);
  if (Number.isNaN(at.getTime())) return "–";
  const date = [at.getDate(), at.getMonth() + 1].map(pad).join(".");
  return `${date}.${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
