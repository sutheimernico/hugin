import { ESC_PRIORITY, useEscapeLayer } from "../../lib/escape";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Kbd } from "../../components/Kbd";
import { Logomark } from "../../components/Logomark";
import { Meter } from "../../components/Meter";
import type { Breakpoint } from "../../lib/breakpoint";
import { budgetTone } from "../../lib/budget";
import { fmtTokens } from "../../lib/format";
import type { View } from "../../state/store";
import type { Meters, Mode } from "../../state/types";
import { ModeChip } from "./ModeChip";

/**
 * Meter scales. The readouts are the kernel's real numbers; these two only decide how full the
 * bar looks, because neither quantity has a hard ceiling to normalise against.
 */
const PROC_SCALE = 8;
const TOKENS_PER_MIN_SCALE = 2_000;

/** The three views of the shell, in the order they are offered. */
const TABS: { view: View; label: string }[] = [
  { view: "control", label: "Stellwerk" },
  { view: "munin", label: "Munin" },
  { view: "runs", label: "Läufe" },
];

/** The Pages build has no memory store to browse. */
const PAGES_TABS = TABS.filter((tab) => tab.view !== "munin");

type TopBarProps = {
  mode: Mode;
  meters: Meters;
  view: View;
  layout?: Breakpoint;
  /** The Pages build has no kernel: nothing to stop, no command to run. */
  replayOnly?: boolean;
  onViewChange: (view: View) => void;
  onKillAll: () => void;
  onOpenPalette: () => void;
};

export function TopBar({
  mode,
  meters,
  view,
  layout = "desktop",
  replayOnly = false,
  onViewChange,
  onKillAll,
  onOpenPalette,
}: TopBarProps) {
  const narrow = layout === "mobile";
  // `relative z-40`: the Panik dialog hangs off this bar and must paint over the working area.
  return (
    <header className="relative z-40 flex h-14 min-w-0 items-stretch gap-3 border-b border-text/20 bg-surface pr-3 pl-3 sm:gap-5 sm:pr-4 sm:pl-5">
      <div className="flex shrink-0 items-center gap-2.5">
        <Logomark lit={mode !== "idle"} />
        <span className="font-display text-[24px] leading-none font-bold tracking-[0.01em] text-text">
          hugin
        </span>
        <span className="hidden text-[12px] text-muted min-[1500px]:inline">
          Gedanken ausschicken. Wissen zurückholen.
        </span>
      </div>

      <div className="flex shrink-0 items-center">
        <ModeChip mode={mode} />
      </div>

      {!narrow && (
        <ViewTabs view={view} onViewChange={onViewChange} tabs={replayOnly ? PAGES_TABS : TABS} />
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-5">
        {/* One fixed width per meter, so a longer readout can never push into its neighbour.
            They give up a quarter of their width below 1500 px so the buttons never leave. */}
        <div className="hidden items-center gap-6 min-[1280px]:flex">
          <div className="w-32 shrink-0 min-[1500px]:w-36">
            <Meter label="Prozesse" value={meters.activeProcs} max={PROC_SCALE} tone="blue" />
          </div>
          <div className="w-32 shrink-0 min-[1500px]:w-36">
            <Meter
              label="Tokens/min"
              value={meters.tokensPerMin}
              max={TOKENS_PER_MIN_SCALE}
              tone="teal"
              format={fmtTokens}
            />
          </div>
          <div className="w-32 shrink-0 min-[1500px]:w-36">
            <Meter
              label="Budget"
              value={Math.round(meters.budgetPct * 100)}
              max={100}
              tone={budgetTone(meters.budgetPct)}
              format={(value) => `${value} %`}
            />
          </div>
        </div>

        {!replayOnly && (
          <button
            type="button"
            aria-label="Befehle öffnen"
            onClick={onOpenPalette}
            className="ease-out-expo my-2.5 inline-flex shrink-0 items-center gap-2 rounded-part border border-text/25 px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text"
          >
            {narrow ? <Search size={16} aria-hidden /> : <Kbd>⌘K</Kbd>}
            <span className="hidden md:inline">Befehle</span>
          </button>
        )}
        {!replayOnly && !narrow && <PanicButton onKillAll={onKillAll} />}
      </div>
    </header>
  );
}

/**
 * Plain buttons rather than an ARIA tablist: a `role="tab"` promises arrow-key navigation
 * between the tabs, and three links that also work with Tab are the smaller promise the shell
 * can actually keep. The active tab is the one with ink under it, like a marked track.
 */
function ViewTabs({
  view,
  onViewChange,
  tabs,
}: {
  view: View;
  onViewChange: (view: View) => void;
  tabs: typeof TABS;
}) {
  return (
    <nav aria-label="Ansicht" className="flex min-w-0 items-stretch gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.view === view;
        return (
          <button
            key={tab.view}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onViewChange(tab.view)}
            className={`ease-out-expo relative px-3 font-display text-[16px] font-semibold whitespace-nowrap transition-colors duration-150 ${
              active ? "text-text" : "text-muted hover:text-text"
            }`}
          >
            {tab.label}
            {active && (
              <motion.span
                layoutId="tab-underline"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-x-3 bottom-0 h-[3px] bg-text"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function PanicButton({ onKillAll, up = false }: { onKillAll: () => void; up?: boolean }) {
  const [asking, setAsking] = useState(false);

  useEscapeLayer(asking, ESC_PRIORITY.panic, () => setAsking(false));

  return (
    <div className="relative flex items-center">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={asking}
        className="border-red/50 text-red hover:bg-red/10"
        onClick={() => setAsking((open) => !open)}
      >
        Panik
      </Button>

      {asking && (
        <>
          {/* Clicking anywhere else is an answer too — it means "no". */}
          <div className="fixed inset-0 z-10" onClick={() => setAsking(false)} />
          <motion.div
            role="dialog"
            aria-label="Alle Prozesse beenden?"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute right-0 z-20 w-64 ${up ? "bottom-11" : "top-11"} rounded-panel border border-text/25 bg-surface-2 p-3.5 shadow-[0_12px_28px_-14px_rgba(27,33,38,0.45)]`}
          >
            <p className="font-display text-[17px] font-semibold text-text">
              Alle Prozesse beenden?
            </p>
            <p className="mt-1 text-[12px] text-muted">
              Laufende Agenten werden sofort gestoppt. Das lässt sich nicht rückgängig machen.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
                Abbrechen
              </Button>
              <Button
                variant="danger"
                size="sm"
                autoFocus
                onClick={() => {
                  setAsking(false);
                  onKillAll();
                }}
              >
                Beenden
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
