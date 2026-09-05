import { STATE_LABEL } from "../lib/i18n";

export type AgentStateName =
  | "queued"
  | "spawning"
  | "running"
  | "waiting_tool"
  | "done"
  | "failed"
  | "killed";

const RING_COLOR: Record<AgentStateName, string> = {
  queued: "var(--color-muted)",
  spawning: "var(--color-muted)",
  running: "var(--color-violet)",
  waiting_tool: "var(--color-cyan)",
  done: "var(--color-green)",
  failed: "var(--color-red)",
  killed: "var(--color-muted)",
};

const DIM: AgentStateName[] = ["queued", "spawning", "killed"];

/** Process state as a ring; `running` spins slowly (CSS, see globals.css), `killed` is struck. */
export function StateRing({ state, size }: { state: AgentStateName; size: number }) {
  const color = RING_COLOR[state];
  const stroke = Math.max(2, Math.round(size / 5));
  // Donut: keep only the outer `stroke` px of the disc.
  const mask = `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`;
  return (
    <span
      role="img"
      aria-label={STATE_LABEL[state]}
      data-state={state}
      className="hugin-ring relative inline-block shrink-0 align-middle"
      style={{ width: size, height: size }}
    >
      <span
        className="hugin-ring-track absolute inset-0 rounded-full"
        style={{
          background:
            state === "running" ? `conic-gradient(from 0deg, transparent, ${color})` : color,
          opacity: DIM.includes(state) ? 0.6 : 1,
          WebkitMaskImage: mask,
          maskImage: mask,
        }}
      />
      {state === "killed" && (
        <span
          className="absolute top-1/2 left-0 w-full -translate-y-1/2 rotate-45"
          style={{ height: 1, background: color }}
        />
      )}
    </span>
  );
}
