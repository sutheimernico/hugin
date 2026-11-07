/**
 * A link between two agents — and the trains that travel along it.
 *
 * A spawn link is drawn as track: sleepers, two rails, and a green line in the bed while one of
 * its ends is occupied. Every live pulse the graph hands this edge becomes a train that runs
 * the edge's own path, so a message visibly moves from the sender to the receiver instead of
 * just being logged. The link to the memory is a cable, not track: one dashed green line.
 */

import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { useReducedMotion } from "motion/react";
import { useCallback } from "react";
import type { Pulse } from "../../state/types";
import { Track } from "../../components/Track";
import { PARTICLE_S } from "./motion";

/** One pulse as this edge sees it: `reverse` when it travels target → source (a child's report). */
export interface EdgePulse {
  id: string;
  kind: Pulse["kind"];
  reverse: boolean;
}

const TRAIN_COLOR: Record<Pulse["kind"], string> = {
  msg: "var(--color-blue)",
  munin: "var(--color-green)",
  spawn: "var(--color-text)",
};

export type PulseEdgeType = Edge<
  { kind: "tree" | "munin"; alive: boolean; pulses: EdgePulse[] },
  "pulse"
>;

export function PulseEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: EdgeProps<PulseEdgeType>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });
  const kind = data?.kind ?? "tree";
  const alive = data?.alive ?? false;
  // Travelling dots are the one effect a reader who asked for less motion cannot opt out of
  // through CSS — SMIL ignores `prefers-reduced-motion` — so they are not rendered at all.
  const still = useReducedMotion();
  const pulses = still === true ? [] : (data?.pulses ?? []);

  return (
    // The track fades in just after the card it leads to has started to appear, so a spawn
    // never draws a stub to a node that is not there yet.
    <g className="hugin-edge-in">
      {kind === "munin" ? (
        <BaseEdge
          path={path}
          style={{
            stroke: "var(--color-green)",
            strokeWidth: 1.5,
            strokeDasharray: "5 4",
            strokeOpacity: alive ? 0.9 : 0.45,
          }}
        />
      ) : (
        <Track d={path} occupied={alive} />
      )}
      {pulses.map((pulse) => (
        <Train key={pulse.id} pulse={pulse} path={path} />
      ))}
    </g>
  );
}

/**
 * SMIL, not CSS: `<animateMotion rotate="auto">` follows the edge's own path, including its
 * rounded corners, and turns the train along it.
 *
 * It starts on `beginElement()` rather than on the document timeline, because an animation
 * inserted into a page that has been running for minutes would otherwise count as long over.
 */
function Train({ pulse, path }: { pulse: EdgePulse; path: string }) {
  const start = useCallback((element: SVGElement | null) => {
    (element as SVGAnimateMotionElement | null)?.beginElement?.();
  }, []);

  const motionId = `pulse-${pulse.id}`;
  const dur = `${PARTICLE_S}s`;

  return (
    // Hidden until the animation starts: before `beginElement()` a SMIL element sits at the
    // origin of the edge's coordinate system, which would show a stray train in the corner.
    <rect
      x={-9}
      y={-4}
      width={18}
      height={8}
      rx={2.5}
      opacity={0}
      style={{ fill: TRAIN_COLOR[pulse.kind] }}
    >
      <animateMotion
        id={motionId}
        ref={start}
        dur={dur}
        begin="indefinite"
        // Freeze at the end: the dot comes to rest under the node it reached and disappears
        // with the pulse when the reducer prunes it.
        fill="freeze"
        path={path}
        rotate="auto"
        // A report travels back up the same edge it was spawned along — same path, run backwards.
        calcMode="linear"
        keyPoints={pulse.reverse ? "1;0" : "0;1"}
        keyTimes="0;1"
      />
      {/* Arrival is a fade, not a disappearance: the dot dims over the last quarter of its
          journey, so the frame in which the reducer prunes it is already empty. `begin` is
          chained to the motion above, which is what keeps the two in step. */}
      <animate
        attributeName="opacity"
        begin={`${motionId}.begin`}
        dur={dur}
        values="1;1;0"
        keyTimes="0;0.75;1"
        fill="freeze"
      />
    </rect>
  );
}
