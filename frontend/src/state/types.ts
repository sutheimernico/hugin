/**
 * The shell's projection types — the shape every view reads from.
 *
 * The block below is BINDING (plan Task 13): names and fields are the contract later frontend
 * tasks build on. Three additions are deliberate and documented where they appear:
 * `Proc.muninWrites`, `State.tokenSamples` and `SystemStatus`.
 *
 * Time unit: every timestamp here is the backend's wall-clock time in **seconds** (float),
 * exactly as it arrives in `HEvent.ts` — `Pulse.at`, `Run.createdAt`, `Proc.startedAt` and
 * `LogLine.ts` included. Nothing in the state layer is in milliseconds.
 */

export type ProcState =
  | "queued"
  | "spawning"
  | "running"
  | "waiting_tool"
  | "done"
  | "failed"
  | "killed";
export type Driver = "claude" | "ollama" | "scripted";
export type Mode = "idle" | Driver | "replay";

export interface Usage {
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_equiv: number | null;
}

export interface Budget {
  max_turns: number;
  max_seconds: number;
  max_output_tokens: number;
}

export interface HEvent {
  seq: number;
  ts: number;
  run_id: string | null;
  pid: number | null;
  kind: string;
  data: Record<string, unknown>;
}

export type TranscriptItem =
  | { t: "text"; text: string }
  | { t: "thinking"; on: boolean }
  | {
      t: "tool";
      callId: string;
      tool: string;
      input: string;
      output?: string;
      ok?: boolean;
      ms?: number;
      sys: boolean;
    };

export interface Proc {
  pid: number;
  runId: string;
  ppid: number | null;
  program: string;
  role: string;
  driver: Driver;
  model: string;
  task: string;
  state: ProcState;
  budget: Budget;
  usage: Usage;
  startedAt: number | null;
  exitedAt: number | null;
  exitReason: string | null;
  thinking: boolean;
  /** Budget fill as a fraction 0…1 — the same scale the kernel's `budget.tick` reports. */
  budgetPct: number;
  transcript: TranscriptItem[];
  /** Addition to the BINDING block: the graph (Task 15) sizes a node's munin link by this. */
  muninWrites: number;
}

export interface Run {
  id: string;
  goal: string;
  driver: Driver;
  state: "running" | "done" | "failed";
  createdAt: number;
  doneAt: number | null;
  artifacts: string[];
  usage: Usage;
}

export interface Pulse {
  id: string;
  from: number;
  to: number | "munin";
  kind: "msg" | "munin" | "spawn";
  at: number;
}

export interface LogLine {
  seq: number;
  ts: number;
  kind: string;
  pid: number | null;
  text: string;
}

export interface Meters {
  activeProcs: number;
  tokensPerMin: number;
  budgetPct: number;
  totalTokens: number;
}

/**
 * Addition to the BINDING block: `Meters.tokensPerMin` is a rate over a 60 s window of event
 * time, which cannot be derived from the other fields — the samples that feed it live here.
 * Each sample is the *delta* of a process's cumulative output tokens, so nothing is counted twice.
 */
export interface TokenSample {
  ts: number;
  tokens: number;
}

export interface State {
  lastSeq: number;
  runs: Record<string, Run>;
  procs: Record<number, Proc>;
  log: LogLine[];
  pulses: Pulse[];
  meters: Meters;
  munin: { writes: number; reads: number; lastAt: number | null };
  activeRunId: string | null;
  tokenSamples: TokenSample[];
}

/**
 * Addition to the BINDING block, defined here so Task 16 (palette gating) and Task 21
 * (`GET /api/system`) share one shape. Field names mirror the backend JSON verbatim.
 */
export interface SystemStatus {
  claude: { ok: boolean; version: string | null; detail: string };
  ollama: { ok: boolean; models: string[]; detail: string };
  munin: { count: number };
  programs: string[];
  kernel: { uptime_s: number; procs: number; version: string };
}

/**
 * The kernel's closed kind list, mirrored from `src/hugin/kernel/events.py`. The SSE stream
 * names every frame (`event: proc.text`), and a browser `EventSource` only dispatches named
 * events to a listener registered for that exact name — so the client needs the list.
 */
export const EVENT_KINDS = [
  "kernel.boot",
  "kernel.subsystem",
  "run.created",
  "run.done",
  "run.failed",
  "sched.queued",
  "sched.started",
  "sched.blocked",
  "proc.spawned",
  "proc.state",
  "proc.text",
  "proc.thinking",
  "proc.exit",
  "tool.call",
  "tool.result",
  "sys.call",
  "sys.result",
  "msg.sent",
  "munin.write",
  "munin.read",
  "artifact.written",
  "budget.tick",
  "budget.exceeded",
  "kill",
] as const;
