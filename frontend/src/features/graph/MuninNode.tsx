/**
 * The shared memory as a station at the end of the line. It is not an agent, so it has no mast
 * and no gauge; it only reacts — every write makes the count tick and the card breathe once.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Database } from "lucide-react";
import { motion, useAnimationControls } from "motion/react";
import { useEffect } from "react";
import { CountUp } from "../../components/CountUp";
import { HANDLE_IN, HUB_H, HUB_W } from "./layout";
import { EASE_OUT_EXPO, HUB_BLOOM } from "./motion";

export type MuninNodeType = Node<{ writes: number }, "munin">;

export function MuninNode({ data }: NodeProps<MuninNodeType>) {
  const { writes } = data;
  const controls = useAnimationControls();

  useEffect(() => {
    // One run per counter value: the bloom when the hub appears, a flash on every write after.
    void controls.start(
      writes === 0
        ? { opacity: 1, scale: 1, transition: HUB_BLOOM }
        : { opacity: 1, scale: [1, 1.06, 1], transition: { duration: 0.5, ease: EASE_OUT_EXPO } },
    );
  }, [writes, controls]);

  return (
    <motion.div
      data-testid="munin-node"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={controls}
      style={{ width: HUB_W, height: HUB_H }}
      className="flex flex-col items-start justify-center rounded-part border-[1.5px] border-green bg-surface px-3"
    >
      <Handle type="target" position={Position.Left} id={HANDLE_IN} className="!opacity-0" />
      <span className="flex items-center gap-1.5 text-green">
        <Database size={16} strokeWidth={2} aria-hidden />
        <span className="font-display text-[20px] leading-6 font-semibold text-text">Speicher</span>
      </span>
      <span className="font-mono text-[11px] leading-4 text-muted">munin</span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <CountUp
          value={writes}
          className="font-display text-[26px] leading-none font-semibold text-text tabular-nums"
        />
        <span className="text-[12px] text-muted">{writes === 1 ? "Eintrag" : "Einträge"}</span>
      </span>
    </motion.div>
  );
}
