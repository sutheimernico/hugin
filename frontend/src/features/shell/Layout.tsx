import type { ReactNode } from "react";

type LayoutProps = {
  topBar: ReactNode;
  children: ReactNode;
  /** The replay timeline, docked above the navigation while a replay runs. */
  bottom?: ReactNode;
  /** Bottom navigation of the narrow layout. */
  nav?: ReactNode;
};

/**
 * The shell frame: top bar, the working area and, when present, the timeline and the bottom
 * navigation. Every row is a grid row, never a fixed overlay, so nothing can sit on top of
 * content. `dvh` keeps the frame inside the visible viewport on a phone with a collapsing
 * address bar.
 */
export function Layout({ topBar, children, bottom, nav }: LayoutProps) {
  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-base text-text">
      {topBar}
      <main className="min-h-0 overflow-hidden">{children}</main>
      {bottom}
      {nav}
    </div>
  );
}
