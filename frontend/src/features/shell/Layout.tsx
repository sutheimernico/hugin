import type { ReactNode } from "react";

type LayoutProps = {
  topBar: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  bottom: ReactNode;
};

/**
 * The mission control frame: a fixed-height top bar, the three working columns and the mission
 * bar. Below 1100 px the columns stack and the middle band scrolls — the graph needs width, and
 * squeezing three columns into a laptop half-screen would make all three unreadable.
 */
export function Layout({ topBar, left, center, right, bottom }: LayoutProps) {
  return (
    <div className="grid h-screen grid-rows-[48px_1fr_40px] bg-base text-text">
      {topBar}
      <main className="grid min-h-0 auto-rows-[minmax(260px,auto)] grid-cols-1 gap-3 overflow-y-auto p-3 min-[1100px]:auto-rows-[minmax(0,1fr)] min-[1100px]:grid-cols-[320px_1fr_360px] min-[1100px]:overflow-hidden">
        <div className="min-h-0">{left}</div>
        <div className="min-h-0">{center}</div>
        <div className="min-h-0">{right}</div>
      </main>
      {bottom}
    </div>
  );
}
