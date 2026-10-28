import { Check, X } from "lucide-react";
import { STATE_LABEL } from "../lib/i18n";

export type AgentStateName =
  | "queued"
  | "spawning"
  | "running"
  | "waiting_tool"
  | "done"
  | "failed"
  | "killed";

/**
 * Process state as a signal lamp (the look lives in `globals.css`, keyed on `data-state`).
 * Large lamps carry a glyph so that done, failed and killed are not told apart by colour alone.
 */
export function StateRing({ state, size }: { state: AgentStateName; size: number }) {
  const glyph = Math.round(size * 0.62);
  return (
    <span
      role="img"
      aria-label={STATE_LABEL[state]}
      data-state={state}
      className="hugin-lamp"
      style={{ width: size, height: size }}
    >
      {size >= 12 && state === "done" && <Check size={glyph} strokeWidth={3} />}
      {size >= 12 && state === "failed" && <X size={glyph} strokeWidth={3} />}
      {size >= 12 && state === "killed" && <X size={glyph} strokeWidth={2.5} />}
    </span>
  );
}
