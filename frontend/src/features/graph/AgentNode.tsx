/**
 * One agent as a card on the graph: who it is, what it is doing and how full its context is.
 *
 * The card blooms in when the process is spawned — that mount animation is the whole point of
 * the view (spec §1: "the graph blooms"), so it must run exactly once per pid. React keeps a
 * node component mounted as long as its id stays in the graph, which is what makes that true.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { StateRing } from "../../components/StateRing";
import { ROLE_LABEL } from "../../lib/i18n";
import { CONTEXT_WINDOW, FALLBACK_ICON, PROGRAM_ICON, programAccent } from "../../lib/programs";
import type { Proc, ProcState } from "../../state/types";
import { HANDLE_IN, HANDLE_MEM, HANDLE_OUT, NODE_H, NODE_W } from "./layout";
import { BLOOM } from "./motion";

/** Glow is reserved for live elements (spec §2.9): a waiting or finished agent does not shine. */
const GLOWING: ProcState[] = ["running", "waiting_tool"];

export type AgentNodeType = Node<{ proc: Proc }, "proc">;

export function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const { proc } = data;
  const Icon = PROGRAM_ICON[proc.program] ?? FALLBACK_ICON;
  const accent = programAccent(proc.program);
  const glowing = GLOWING.includes(proc.state);
  const context = Math.min(1, proc.usage.input_tokens / CONTEXT_WINDOW);

  return (
    // The card morphs into the agent window (they share `layoutId`), and a shared layout
    // animation hides the card it animates away from — which would leave a hole between the
    // edges. This outline holds the slot open and reads as "this agent is open in the window".
    <div className="relative" style={{ width: NODE_W, height: NODE_H }}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-panel border border-dashed"
        style={{ borderColor: `${accent}55` }}
      />
      <motion.div
        data-testid="agent-node"
        // Shared with the agent window's header (Task 22): selecting the node morphs *this*
        // card into the sheet instead of opening an unrelated panel beside it.
        layoutId={`proc-${proc.pid}`}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={BLOOM}
        // Both fall back to an explicit value rather than to `undefined`: `motion` writes the
        // style imperatively and never removes a property it has already set, so a node that
        // finished would keep the glow of the moment it was last alive.
        style={{
          width: NODE_W,
          height: NODE_H,
          borderColor: selected ? accent : "var(--color-border)",
          boxShadow: glowing ? `0 0 24px ${accent}40` : "none",
        }}
        className="relative flex cursor-pointer flex-col justify-center overflow-hidden rounded-panel border border-border bg-surface-2 px-3 transition-colors duration-150"
      >
        <Handle type="target" position={Position.Top} id={HANDLE_IN} className="!opacity-0" />

        <div className="flex items-center gap-2">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-md"
            style={{ background: `${accent}1F`, color: accent }}
          >
            <Icon size={14} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[12px] leading-4 text-text">
              {proc.program}
            </span>
            {/* `ROLE_LABEL` is keyed by program name; the kernel's own `role` is English prose
                ("Orchestrator") and only stands in for a program the shell does not know. */}
            <span className="block truncate text-[10px] leading-3 text-muted">
              {ROLE_LABEL[proc.program] ?? proc.role}
            </span>
          </span>
          <StateRing state={proc.state} size={10} />
          <span className="font-mono text-[10px] text-muted tabular-nums">{proc.pid}</span>
        </div>

        {/* Context fill: how much of the window this agent has read, not a budget. */}
        <span
          className="absolute inset-x-0 bottom-0 h-[3px] bg-border/60"
          title="Kontext gefüllt"
          aria-hidden
        >
          <span
            className="ease-out-expo block h-full transition-[width] duration-400"
            style={{ width: `${context * 100}%`, background: accent }}
          />
        </span>

        <Handle type="source" position={Position.Bottom} id={HANDLE_OUT} className="!opacity-0" />
        <Handle type="source" position={Position.Right} id={HANDLE_MEM} className="!opacity-0" />
      </motion.div>
    </div>
  );
}
