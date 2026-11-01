import type { ReactNode } from "react";

/** Keycap for shortcut hints such as ⌘K or Esc. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-part border border-b-2 border-border bg-surface-2 px-1 py-px font-mono text-[12px] leading-4 text-muted">
      {children}
    </kbd>
  );
}
