import { useSyncExternalStore } from "react";
import { breakpointOf, DESKTOP_MIN, TABLET_MIN, type Breakpoint } from "../lib/breakpoint";

const QUERIES = [`(min-width: ${TABLET_MIN}px)`, `(min-width: ${DESKTOP_MIN}px)`];

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const lists = QUERIES.map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", onChange));
  return () => lists.forEach((list) => list.removeEventListener("change", onChange));
}

const snapshot = (): Breakpoint => breakpointOf(window.innerWidth);
// Rendered on a server or without a window, the wide layout is the safe assumption.
const serverSnapshot = (): Breakpoint => "desktop";

/** Which of the three layouts is on screen; re-renders only when the layout actually changes. */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
