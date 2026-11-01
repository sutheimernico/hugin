/**
 * A stretch of track, drawn the way a signal-box diagram draws it: sleepers, two rails, and —
 * while the section is occupied — a green line in the bed between the rails. The rails are one
 * wide stroke with a narrower paper-coloured one cut out of it, so the same path serves any
 * shape. It must sit on a `surface-2` ground, which is what the cut-out is painted with.
 */
export function Track({ d, occupied = false, faint = false }: { d: string; occupied?: boolean; faint?: boolean }) {
  return (
    <g aria-hidden>
      <path d={d} fill="none" stroke="var(--color-border)" strokeWidth={11} strokeDasharray="2 6" />
      <path
        d={d}
        fill="none"
        stroke="var(--color-text)"
        strokeOpacity={faint ? 0.25 : occupied ? 0.75 : 0.4}
        strokeWidth={6}
      />
      <path d={d} fill="none" stroke="var(--color-surface-2)" strokeWidth={3.4} />
      {occupied && <path d={d} fill="none" stroke="var(--color-green)" strokeWidth={1.8} />}
    </g>
  );
}
