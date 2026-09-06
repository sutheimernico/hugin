import type { ReactNode } from "react";

type LayoutProps = {
  topBar: ReactNode;
  /** Full-width middle row (Munin, Runs). When given it replaces the three columns. */
  main?: ReactNode;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  bottom: ReactNode;
};

/**
 * The shell frame: a fixed-height top bar, the working area and the mission bar. Mission
 * control fills the middle with three columns; below 1100 px they stack and the middle band
 * scrolls — the graph needs width, and squeezing three columns into a laptop half-screen would
 * make all three unreadable. The other views get the whole row instead.
 */
export function Layout({ topBar, main, left, center, right, bottom }: LayoutProps) {
  return (
    <div className="grid h-screen grid-rows-[48px_1fr_40px] bg-base text-text">
      {topBar}
      {main === undefined ? (
        <main className="grid min-h-0 auto-rows-[minmax(260px,auto)] grid-cols-1 gap-3 overflow-y-auto p-3 min-[1100px]:auto-rows-[minmax(0,1fr)] min-[1100px]:grid-cols-[320px_1fr_360px] min-[1100px]:overflow-hidden">
          <div className="min-h-0">{left}</div>
          <div className="min-h-0">{center}</div>
          <div className="min-h-0">{right}</div>
        </main>
      ) : (
        <main className="min-h-0 overflow-hidden p-3">{main}</main>
      )}
      {bottom}
    </div>
  );
}
