import { Ellipsis, ListTree, Rows3, ScrollText, type LucideIcon } from "lucide-react";
import type { Pane } from "../state/store";

export type NavItem = "mission" | "log" | "procs" | "more";

const ITEMS: { id: NavItem; label: string; icon: LucideIcon }[] = [
  { id: "mission", label: "Mission", icon: ListTree },
  { id: "log", label: "Verlauf", icon: ScrollText },
  { id: "procs", label: "Prozesse", icon: Rows3 },
  { id: "more", label: "Mehr", icon: Ellipsis },
];

type BottomNavProps = {
  active: NavItem;
  onPane: (pane: Pane) => void;
  onMore: () => void;
};

/**
 * The narrow layout's navigation. It is a row of the page grid, not a fixed overlay, so it can
 * never sit on top of content; the page's own bottom padding for the home indicator lives here.
 */
export function BottomNav({ active, onPane, onMore }: BottomNavProps) {
  return (
    <nav
      aria-label="Bereiche"
      className="grid grid-cols-4 border-t border-text/25 bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => (id === "more" ? onMore() : onPane(id))}
            className={`ease-out-expo relative flex h-14 flex-col items-center justify-center gap-0.5 font-display text-[13px] font-semibold transition-colors duration-150 ${
              on ? "text-text" : "text-muted"
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-0 h-[3px] w-10 origin-center bg-text transition-transform duration-200 ${
                on ? "scale-x-100" : "scale-x-0"
              }`}
            />
            <Icon size={20} strokeWidth={on ? 2.25 : 1.75} aria-hidden />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
