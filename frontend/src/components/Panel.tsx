import type { ReactNode } from "react";

type PanelProps = {
  title?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Body classes; override the default padding for a panel that fills its own space. */
  bodyClassName?: string;
};

/** Surface container with an optional header row: HUD title left, free slot right. */
export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "p-3",
}: PanelProps) {
  const hasHeader = title !== undefined || right !== undefined;
  return (
    <section className={`flex flex-col rounded-panel border border-border bg-surface ${className}`}>
      {hasHeader && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
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
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
