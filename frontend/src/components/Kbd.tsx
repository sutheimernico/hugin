import type { ReactNode } from "react";

/** Keycap for shortcut hints such as ⌘K or Esc. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[11px] leading-4 text-muted">
      {children}
    </kbd>
  );
}
