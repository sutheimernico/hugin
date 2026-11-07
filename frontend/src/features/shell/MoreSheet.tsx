import { ESC_PRIORITY, useEscapeLayer } from "../../lib/escape";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Command, History, X, type LucideIcon } from "lucide-react";
import type { View } from "../../state/store";
import { PanicButton } from "./TopBar";

type MoreSheetProps = {
  open: boolean;
  replayOnly: boolean;
  onClose: () => void;
  onView: (view: View) => void;
  onOpenPalette: () => void;
  onKillAll: () => void;
};

const EASE = [0.16, 1, 0.3, 1] as const;

/** The narrow layout's overflow: the views that have no tab, and the two controls that never hide. */
export function MoreSheet({ open, replayOnly, onClose, onView, onOpenPalette, onKillAll }: MoreSheetProps) {
  useEscapeLayer(open, ESC_PRIORITY.sheet, () => onClose());
  const go = (view: View) => {
    onView(view);
    onClose();
  };
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            aria-hidden
            className="fixed inset-0 z-50 bg-text/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.section
            key="sheet"
            role="dialog"
            aria-label="Mehr"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-panel border-t border-text/25 bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_28px_-14px_rgba(27,33,38,0.45)]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-display text-[20px] font-semibold text-text">Mehr</h2>
              <button type="button" aria-label="Schließen" onClick={onClose} className="p-1 text-muted">
                <X size={20} aria-hidden />
              </button>
            </header>
            <ul>
              {!replayOnly && (
                <Item icon={Brain} label="Munin" hint="Das Gedächtnis der Agenten" onClick={() => go("munin")} />
              )}
              <Item
                icon={History}
                label="Läufe & Replay"
                hint="Vergangene Missionen noch einmal abspielen"
                onClick={() => go("runs")}
              />
              {!replayOnly && (
                <Item
                  icon={Command}
                  label="Befehle"
                  hint="Mission starten, Treiber wählen"
                  onClick={() => {
                    onClose();
                    onOpenPalette();
                  }}
                />
              )}
            </ul>
            {!replayOnly && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-[13px] text-muted">Alle laufenden Agenten stoppen</span>
                <PanicButton up onKillAll={onKillAll} />
              </div>
            )}
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}

function Item({ icon: Icon, label, hint, onClick }: { icon: LucideIcon; label: string; hint: string; onClick: () => void }) {
  return (
    <li className="border-b border-border/70">
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <Icon size={20} className="shrink-0 text-text" aria-hidden />
        <span className="min-w-0">
          <span className="block font-display text-[18px] leading-5 font-semibold text-text">{label}</span>
          <span className="block text-[13px] text-muted">{hint}</span>
        </span>
      </button>
    </li>
  );
}
