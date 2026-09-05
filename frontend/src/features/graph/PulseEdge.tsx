/**
 * A link between two agents — and the particles that travel along it.
 *
 * The line itself is quiet; what carries meaning is the traffic on it. Every live pulse the
 * graph hands this edge becomes one dot that runs the edge's own path, so a message visibly
 * moves from the sender to the receiver instead of just being logged.
 */

import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { useCallback } from "react";
import type { Pulse } from "../../state/types";

/** One pulse as this edge sees it: `reverse` when it travels target → source (a child's report). */
export interface EdgePulse {
  id: string;
  kind: Pulse["kind"];
  reverse: boolean;
}

const PARTICLE_COLOR: Record<Pulse["kind"], string> = {
  msg: "var(--color-violet)",
  munin: "var(--color-green)",
  spawn: "var(--color-cyan)",
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
  const pulses = data?.pulses ?? [];

  return (
    <>
      <BaseEdge
        path={path}
        style={
          kind === "munin"
            ? {
                stroke: "var(--color-green)",
                strokeWidth: 1,
                strokeDasharray: "4 4",
                strokeOpacity: alive ? 0.5 : 0.25,
              }
            : {
                // A hairline that only brightens while one of its ends is still alive.
                stroke: alive ? "var(--color-muted)" : "var(--color-border)",
                strokeWidth: 1,
              }
        }
      />
      {pulses.map((pulse) => (
        <Particle key={pulse.id} pulse={pulse} path={path} />
      ))}
    </>
  );
}

/**
 * SMIL, not CSS: `<animateMotion>` follows the edge's own path, including its rounded corners.
 *
 * It starts on `beginElement()` rather than on the document timeline, because an animation
 * inserted into a page that has been running for minutes would otherwise count as long over.
 */
function Particle({ pulse, path }: { pulse: EdgePulse; path: string }) {
  const start = useCallback((element: SVGElement | null) => {
    (element as SVGAnimateMotionElement | null)?.beginElement?.();
  }, []);

  return (
    <circle r={3} style={{ fill: PARTICLE_COLOR[pulse.kind] }}>
      <animateMotion
        ref={start}
        dur="0.8s"
        begin="indefinite"
        // Freeze at the end: the dot comes to rest under the node it reached and disappears
        // with the pulse when the reducer prunes it.
        fill="freeze"
        path={path}
        // A report travels back up the same edge it was spawned along — same path, run backwards.
        calcMode="linear"
        keyPoints={pulse.reverse ? "1;0" : "0;1"}
        keyTimes="0;1"
      />
    </circle>
  );
}
