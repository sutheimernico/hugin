/**
 * The shared memory as a hub beside the tree. It is not an agent, so it is drawn as a circle,
 * not a card — and it only reacts: every write makes it flash once.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion, useAnimationControls } from "motion/react";
import { useEffect } from "react";
import { HANDLE_IN, HUB_SIZE } from "./layout";

/** The house easing (spec §2.9 motion rules). */
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

export type MuninNodeType = Node<{ writes: number }, "munin">;

export function MuninNode({ data }: NodeProps<MuninNodeType>) {
  const { writes } = data;
  const controls = useAnimationControls();

  useEffect(() => {
    // One run per counter value: the bloom when the hub appears, a flash on every write after.
    void controls.start(
      writes === 0
        ? { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 380, damping: 26 } }
        : { opacity: 1, scale: [1, 1.15, 1], transition: { duration: 0.6, ease: EASE_OUT_EXPO } },
    );
  }, [writes, controls]);

  return (
    <motion.div
      data-testid="munin-node"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={controls}
      style={{ width: HUB_SIZE, height: HUB_SIZE }}
      className="flex flex-col items-center justify-center rounded-full border border-green/40 bg-green/10 text-green"
    >
      <Handle type="target" position={Position.Left} id={HANDLE_IN} className="!opacity-0" />
      <span className="font-mono text-[11px] leading-4">munin</span>
      <span className="font-mono text-[10px] leading-3 text-green/70 tabular-nums">{writes}</span>
    </motion.div>
  );
}
