import type { ReactNode } from "react";

type PanelProps = {
  title?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Surface container with an optional header row: HUD title left, free slot right. */
export function Panel({ title, right, children, className = "" }: PanelProps) {
  const hasHeader = title !== undefined || right !== undefined;
  return (
    <section className={`rounded-panel border border-border bg-surface ${className}`}>
      {hasHeader && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          {title !== undefined ? (
            <h2 className="font-display text-[12px] font-medium tracking-[0.14em] text-muted uppercase">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {right}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}
