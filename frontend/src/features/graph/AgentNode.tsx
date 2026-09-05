/**
 * One agent as a card on the graph: who it is, what it is doing and how full its context is.
 *
 * The card blooms in when the process is spawned — that mount animation is the whole point of
 * the view (spec §1: "the graph blooms"), so it must run exactly once per pid. React keeps a
 * node component mounted as long as its id stays in the graph, which is what makes that true.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Bot, Compass, Hammer, PenLine, Scale, Telescope, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { StateRing } from "../../components/StateRing";
import { ROLE_LABEL } from "../../lib/i18n";
import type { Proc, ProcState } from "../../state/types";
import { HANDLE_IN, HANDLE_MEM, HANDLE_OUT, NODE_H, NODE_W } from "./layout";

/** Icons and accents mirror `src/hugin/programs/*.yaml`; an unknown program stays neutral. */
const ICON: Record<string, LucideIcon> = {
  planner: Compass,
  scout: Telescope,
  smith: Hammer,
  judge: Scale,
  scribe: PenLine,
};

/**
 * Hex, not `var(--color-…)`, because the glow needs the accent with an alpha suffix. Kept in
 * sync with `styles/tokens.css` by hand — the palette is closed and does not move.
 */
const ACCENT: Record<string, string> = {
  planner: "#6E5BFF",
  scout: "#22D3C7",
  smith: "#F5A623",
  judge: "#F472B6",
  scribe: "#3ECF8E",
};
const NEUTRAL_ACCENT = "#8B92A5";

/** Claude's context window — the reference the fill bar is honest about being measured against. */
const CONTEXT_WINDOW = 200_000;

/** Glow is reserved for live elements (spec §2.9): a waiting or finished agent does not shine. */
const GLOWING: ProcState[] = ["running", "waiting_tool"];

export type AgentNodeType = Node<{ proc: Proc }, "proc">;

export function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const { proc } = data;
  const Icon = ICON[proc.program] ?? Bot;
  const accent = ACCENT[proc.program] ?? NEUTRAL_ACCENT;
  const glowing = GLOWING.includes(proc.state);
  const context = Math.min(1, proc.usage.input_tokens / CONTEXT_WINDOW);

  return (
    <motion.div
      data-testid="agent-node"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        width: NODE_W,
        height: NODE_H,
        borderColor: selected ? accent : undefined,
        boxShadow: glowing ? `0 0 24px ${accent}40` : undefined,
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
  );
}
