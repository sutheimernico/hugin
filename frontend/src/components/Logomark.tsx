/**
 * The mark: a signal mast with one lamp. The lamp is lit while the kernel supervises something,
 * so the logo in the corner is also the smallest status display in the shell.
 */
export function Logomark({ lit, size = 26 }: { lit: boolean; size?: number }) {
  return (
    <svg
      width={size * 0.62}
      height={size}
      viewBox="0 0 16 26"
      aria-hidden
      className="shrink-0 text-text"
    >
      <rect x="7" y="9" width="2" height="17" fill="currentColor" />
      <rect x="2" y="23" width="12" height="3" rx="1" fill="currentColor" />
      <rect x="1" y="1" width="14" height="10" rx="2" fill="currentColor" />
      <circle
        cx="8"
        cy="6"
        r="3"
        className="transition-colors duration-300"
        fill={lit ? "var(--color-green)" : "var(--color-muted)"}
      />
    </svg>
  );
}
