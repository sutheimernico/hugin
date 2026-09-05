import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

export type ToastTone = "info" | "error";

export interface ToastMessage {
  /** A fresh id per message, so the same text twice still re-animates and re-arms the timer. */
  id: number;
  text: string;
  tone: ToastTone;
}

const TONE_CLASS: Record<ToastTone, string> = {
  info: "border-violet/40 text-text",
  error: "border-red/50 text-red",
};

const DISMISS_MS = 4_000;

/**
 * One transient message at a time, bottom centre. `role="status"` (polite) rather than an
 * alert: a started mission is news, not an interruption of whatever the reader is doing.
 */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(onDone, DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <AnimatePresence>
      {toast !== null && (
        <motion.div
          key={toast.id}
          role="status"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, transition: { duration: 0.2 } }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className={`fixed bottom-14 left-1/2 z-[60] -translate-x-1/2 rounded-panel border bg-surface-2 px-4 py-2 text-[13px] shadow-[0_18px_40px_-20px_#000] ${TONE_CLASS[toast.tone]}`}
        >
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
