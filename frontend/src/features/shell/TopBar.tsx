import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import type { Tone } from "../../components/Chip";
import { Kbd } from "../../components/Kbd";
import { Meter } from "../../components/Meter";
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

/** The three views of the shell, in the order they are offered (spec §2.9). */
const TABS: { view: View; label: string }[] = [
  { view: "control", label: "Mission Control" },
  { view: "munin", label: "Munin" },
  { view: "runs", label: "Runs" },
];

type TopBarProps = {
  mode: Mode;
  meters: Meters;
  view: View;
  onViewChange: (view: View) => void;
  onKillAll: () => void;
  onOpenPalette: () => void;
};

export function TopBar({
  mode,
  meters,
  view,
  onViewChange,
  onKillAll,
  onOpenPalette,
}: TopBarProps) {
  return (
    <header className="flex h-12 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="font-display shrink-0 text-[17px] leading-none font-bold tracking-[0.16em] text-text">
          hugin
        </span>
        {/* Decoration, so it is the first thing to go when the window gets narrow. */}
        <span className="hidden truncate text-[11px] text-muted xl:inline">
          Gedanken ausschicken. Wissen zurückholen.
        </span>
      </div>

      <div className="shrink-0">
        <ModeChip mode={mode} />
      </div>

      <ViewTabs view={view} onViewChange={onViewChange} />

      <div className="ml-auto flex shrink-0 items-center gap-5">
        {/* One fixed width per meter, so a longer label or readout can never push into its
            neighbour — the bars are a HUD row and must stay on one line. */}
        <div className="hidden items-center gap-6 lg:flex">
          <div className="w-40 shrink-0">
            <Meter label="Prozesse" value={meters.activeProcs} max={PROC_SCALE} tone="violet" />
          </div>
          <div className="w-40 shrink-0">
            <Meter
              label="Tokens/min"
              value={meters.tokensPerMin}
              max={TOKENS_PER_MIN_SCALE}
              tone="cyan"
              format={fmtTokens}
            />
          </div>
          <div className="w-40 shrink-0">
            <Meter
              label="Budget"
              value={Math.round(meters.budgetPct * 100)}
              max={100}
              tone={budgetTone(meters.budgetPct)}
              format={(value) => `${value} %`}
            />
          </div>
        </div>

        {/* The hint is the button: the shortcut and the way to find it without one. */}
        <button
          type="button"
          aria-label="Befehle öffnen"
          onClick={onOpenPalette}
          className="ease-out-expo hidden h-7 items-center gap-2 rounded-panel border border-border px-2 text-[11px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text sm:inline-flex"
        >
          <Kbd>⌘K</Kbd>
          <span className="hidden md:inline">Befehle</span>
        </button>
        <PanicButton onKillAll={onKillAll} />
      </div>
    </header>
  );
}

/**
 * Segmented view switcher. Plain buttons rather than an ARIA tablist: a `role="tab"` promises
 * arrow-key navigation between the tabs, and three links that also work with Tab are the
 * smaller promise the shell can actually keep.
 */
function ViewTabs({ view, onViewChange }: { view: View; onViewChange: (view: View) => void }) {
  return (
    <nav aria-label="Ansicht" className="flex shrink-0 items-center gap-1">
      {TABS.map((tab) => {
        const active = tab.view === view;
        return (
          <button
            key={tab.view}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onViewChange(tab.view)}
            className={`ease-out-expo h-7 rounded-panel border px-2.5 text-[11px] whitespace-nowrap transition-colors duration-150 ${
              active
                ? "border-violet/60 bg-violet/10 text-text"
                : "border-transparent text-muted hover:bg-surface-2 hover:text-text"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Red is reserved for real danger: the bar only turns amber and red as the budget runs out. */
function budgetTone(pct: number): Tone {
  if (pct >= 0.85) return "red";
  if (pct >= 0.6) return "amber";
  return "green";
}

function PanicButton({ onKillAll }: { onKillAll: () => void }) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAsking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={asking}
        className="border-red/40 text-red hover:bg-red/10"
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
            className="absolute top-9 right-0 z-20 w-60 rounded-panel border border-border bg-surface-2 p-3 shadow-[0_18px_40px_-20px_#000]"
          >
            <p className="text-[13px] text-text">Alle Prozesse beenden?</p>
            <p className="mt-1 text-[11px] text-muted">
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
