// Display formatters for the HUD. German locale: decimal comma, "–" for unknown.

/** Token counts: `987` → `"987"`, `1234` → `"1,2k"`, `1_500_000` → `"1,5M"`. */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 1_000_000) return `${comma((n / 1_000_000).toFixed(1))}M`;
  if (Math.abs(n) >= 1_000) return `${comma((n / 1_000).toFixed(1))}k`;
  return String(Math.round(n));
}

/** Elapsed time: `65` → `"1:05"`, `3700` → `"1:01:40"`. */
export function fmtDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Cost estimates are always approximations: `null` → `"–"`, `0.0432` → `"≈ $0,04"`. */
export function fmtUsd(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return "–";
  return `≈ $${comma(x.toFixed(2))}`;
}

/** A whole number with the German thousands dot: `7528` → `"7.528"`. */
export function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("de-DE") : "–";
}

/** A call's duration: `15` → `"15 ms"`, `6028` → `"6,0 s"`. */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  if (Math.abs(Math.round(ms)) < 1000) return `${Math.round(ms)} ms`;
  return `${comma((ms / 1000).toFixed(1))} s`;
}

function comma(fixed: string): string {
  return fixed.replace(".", ",");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
