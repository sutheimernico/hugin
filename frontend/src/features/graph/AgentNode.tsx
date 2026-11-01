/**
 * One agent as a block section of the signal-box diagram: a signal mast on the left whose lamp
 * is the process state, the role and what it is doing in the middle, and a fuel gauge for its
 * budget along the bottom.
 *
 * The card grows out of its parent's position when the process is spawned — that mount
 * animation is the point of the view, so it must run exactly once per pid. React keeps a node
 * component mounted as long as its id stays in the graph, which is what makes that true.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { useState } from "react";
import { StateRing } from "../../components/StateRing";
import { activityOf } from "../../lib/activity";
import { budgetTone, FILL_CLASS } from "../../lib/budget";
import { fmtTokens } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/i18n";
import { FALLBACK_ICON, PROGRAM_ICON, programAccent } from "../../lib/programs";
import { isAlive } from "../../state/selectors";
import type { Proc } from "../../state/types";
import { HANDLE_IN, HANDLE_MEM, HANDLE_OUT, NODE_H, NODE_W } from "./layout";
import { BLOOM } from "./motion";
import { finalStamp, startsTermBeat } from "./stamp";

export type AgentNodeType = Node<
  { proc: Proc; from: { dx: number; dy: number } | null },
  "proc"
>;

export function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const { proc } = data;
  const Icon = PROGRAM_ICON[proc.program] ?? FALLBACK_ICON;
  const accent = programAccent(proc.program);
  const stopped = proc.state === "killed" || proc.state === "failed";
  // The amber beat belongs to a kill this card watched happen, not to one it mounted after.
  const [sawAlive] = useState(() => isAlive(proc));
  const beat = startsTermBeat(sawAlive ? "running" : null, proc.state);
  const stamp = finalStamp(proc.state);

  return (
    <div className="relative" style={{ width: NODE_W, height: NODE_H }}>
      {/* The card morphs into the agent window (they share `layoutId`), and a shared layout
          animation hides the card it animates away from — which would leave a hole in the
          track. This outline holds the slot and reads as "open in the window". */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-part border-[1.5px] border-dashed border-text/30"
      />
      <motion.div
        data-testid="agent-node"
        // Shared with the agent window's header: selecting the node morphs *this* card into the
        // sheet instead of opening an unrelated panel beside it.
        layoutId={`proc-${proc.pid}`}
        data-state={proc.state}
        initial={{
          x: data.from?.dx ?? 0,
          y: data.from?.dy ?? 0,
          scale: 0.55,
          opacity: 0,
        }}
        animate={{ x: 0, y: 0, scale: 1, opacity: stopped ? 0.78 : 1 }}
        transition={BLOOM}
        style={{ width: NODE_W, height: NODE_H }}
        className={`relative flex cursor-pointer overflow-hidden rounded-part border-[1.5px] bg-surface transition-colors duration-150 ${
          selected ? "border-text" : "border-text/35 hover:border-text/70"
        }`}
      >
        <Handle type="target" position={Position.Left} id={HANDLE_IN} className="!opacity-0" />

        {/* The mast: lamp on top, pole, foot. Its colour is the only colour on the card. */}
        <span
          aria-hidden
          className="relative flex w-10 shrink-0 flex-col items-center border-r border-border bg-surface-2 pt-3"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-text">
            <StateRing state={proc.state} size={14} />
          </span>
          <span className="mt-0.5 w-[3px] flex-1 bg-text" />
          <span className="h-[4px] w-6 bg-text" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
          <span className="flex items-center gap-1.5">
            <Icon size={16} strokeWidth={2} style={{ color: accent }} className="shrink-0" />
            <span className="font-display truncate text-[20px] leading-6 font-semibold text-text">
              {ROLE_LABEL[proc.program] ?? proc.role}
            </span>
          </span>
          {/* `ROLE_LABEL` is keyed by program name; the kernel's own `role` is English prose
              and only stands in for a program the shell does not know. */}
          <span className="font-mono text-[11px] leading-4 text-muted">
            {proc.program} · PID {proc.pid}
          </span>
          <span className="mt-0.5 truncate text-[13px] leading-[18px] text-text">
            {activityOf(proc)}
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <span
              className="hugin-gauge min-w-0 flex-1"
              role="presentation"
              title="Budget"
              aria-hidden
            >
              <span
                className={FILL_CLASS[budgetTone(proc.budgetPct)]}
                style={{ transform: `scaleX(${Math.min(1, proc.budgetPct)})` }}
              />
            </span>
            <span className="font-display text-[14px] leading-none font-semibold text-text tabular-nums">
              {fmtTokens(proc.usage.output_tokens)}
            </span>
          </span>
        </span>

        {beat && (
          <span aria-hidden className="hugin-stamp-term pointer-events-none absolute top-2 right-2 border-2 border-amber px-1.5 font-display text-[15px] font-bold text-amber">
            TERM
          </span>
        )}
        {stamp !== null && (
          <span
            aria-hidden
            className={`hugin-stamp pointer-events-none absolute top-2 right-2 border-2 bg-surface px-1.5 font-display text-[15px] font-bold ${
              stamp.tone === "red" ? "border-red text-red" : "border-amber text-amber"
            }`}
            style={beat ? { animationDelay: "600ms" } : undefined}
          >
            {stamp.word}
          </span>
        )}

        <Handle type="source" position={Position.Right} id={HANDLE_OUT} className="!opacity-0" />
        <Handle
          type="source"
          position={Position.Right}
          id={HANDLE_MEM}
          style={{ top: "78%" }}
          className="!opacity-0"
        />
      </motion.div>
    </div>
  );
}
