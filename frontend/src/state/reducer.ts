/**
 * The projection: kernel events in, shell state out.
 *
 * This module is pure and free of React and zustand on purpose — live SSE and replay feed the
 * *same* reducer, and replay re-folds a whole run from `initialState`.
 *
 * Two consequences of that:
 * - `applyEvent` never mutates the state it is handed. It clones the top level and then
 *   copy-on-writes each nested container it touches.
 * - Every clock decision uses `event.ts` (wall-clock **seconds**), never `Date.now()`, so a
 *   replay at 8× prunes exactly what the live run pruned.
 */

import { goalText, plain, syscallLabel, toolErrorText, toolLabel } from "../lib/describe";
import { fmtDec, fmtInt, fmtMs } from "../lib/format";
import { DRIVER_LABEL, exitReasonShort, STATE_LABEL } from "../lib/i18n";
import { isActive, isAlive } from "./selectors";
import type {
  Budget,
  Driver,
  HEvent,
  LogLine,
  Meters,
  Proc,
  ProcState,
  Pulse,
  Run,
  State,
  TranscriptItem,
  Usage,
} from "./types";

const LOG_RING = 5_000;
/** A pulse is one travelling particle; it lives 1.2 s of event time. */
const PULSE_TTL_S = 1.2;
/**
 * Ceiling on particles in flight. Event time is not wall time: a replay at 8× or a burst of
 * backfill can put a whole minute of traffic inside one 1.2 s window, and every particle is an
 * SVG element the browser animates. The newest are the ones worth showing, so the oldest go.
 */
const MAX_PULSES = 60;
const TOKEN_WINDOW_S = 60;
/** High-frequency noise: the log would be nothing else if these two were in it. */
const UNLOGGED = new Set(["proc.text", "budget.tick"]);

const PROC_STATES: ProcState[] = [
  "queued",
  "spawning",
  "running",
  "waiting_tool",
  "done",
  "failed",
  "killed",
];
const DRIVERS: Driver[] = ["claude", "ollama", "scripted"];

const BUDGET_DIMENSION: Record<string, string> = {
  turns: "Runden",
  seconds: "Zeit",
  output_tokens: "Tokens",
};

export const initialState: State = {
  lastSeq: 0,
  runs: {},
  procs: {},
  log: [],
  pulses: [],
  meters: { activeProcs: 0, tokensPerMin: 0, budgetPct: 0, totalTokens: 0 },
  munin: { writes: 0, reads: 0, lastAt: null },
  activeRunId: null,
  tokenSamples: [],
};

export function applyEvent(state: State, e: HEvent, opts?: { logRing?: number }): State {
  // Idempotent on duplicate seq: an SSE reconnect replays everything after the last seq the
  // client acknowledged, and the backfill and the live queue overlap by design.
  if (e.seq <= state.lastSeq) return state;

  const next: State = {
    ...state,
    lastSeq: e.seq,
    pulses: state.pulses.filter((pulse) => e.ts - pulse.at <= PULSE_TTL_S),
    tokenSamples: state.tokenSamples.filter((sample) => e.ts - sample.ts <= TOKEN_WINDOW_S),
  };

  reduce(next, e);

  if (!UNLOGGED.has(e.kind)) {
    const line: LogLine = { seq: e.seq, ts: e.ts, kind: e.kind, pid: e.pid, text: logText(e) };
    if (e.kind === "tool.call" && str(e.data.tool).startsWith("mcp__hugin__")) line.kernelTool = true;
    const ring = opts?.logRing ?? LOG_RING;
    next.log = [...next.log, line].slice(-ring);
  }
  next.meters = meters(next);
  return next;
}

export function applyEvents(state: State, events: HEvent[]): State {
  return events.reduce((acc, event) => applyEvent(acc, event), state);
}

/** A German one-liner for the kernel log. Reads `e` only — no cross-event lookups. */
export function logText(e: HEvent): string {
  const d = e.data;
  const pid = e.pid ?? "?";
  switch (e.kind) {
    case "kernel.boot":
      return `hugin-Kernel ${str(d.version, "?")} gestartet`;
    case "kernel.subsystem":
      return `Subsystem ${str(d.name)}: ${str(d.detail)}`;
    case "run.created":
      return `Mission gestartet: »${goalText(str(d.goal))}«`;
    case "run.done":
      return `Mission abgeschlossen in ${fmtDec(num(d.duration_s))} s`;
    case "run.failed":
      return `Mission fehlgeschlagen: ${str(d.reason)}`;
    case "sched.queued":
      return `Prozess ${pid} eingereiht`;
    case "sched.started":
      return `Prozess ${pid} läuft an`;
    case "sched.blocked":
      return blockedText(pid, str(d.reason), num(d.limit));
    case "proc.spawned":
      return `Prozess ${pid} (${str(d.program)}) gestartet`;
    case "proc.state":
      return `Prozess ${pid}: ${label(d.prev)} → ${label(d.state)}`;
    case "proc.text":
      return `Prozess ${pid} schreibt`;
    case "proc.thinking":
      return d.on === true ? `Prozess ${pid} denkt nach` : `Prozess ${pid} denkt nicht mehr nach`;
    case "proc.exit":
      return `Prozess ${pid} beendet: ${exitReasonShort(str(d.reason))}`;
    case "tool.call":
      return `Prozess ${pid}: ${toolLabel(str(d.tool))}`;
    case "tool.result":
      return d.ok === true
        ? `Werkzeug fertig in ${fmtMs(num(d.ms))}`
        : `Werkzeug fehlgeschlagen: ${toolErrorText(str(d.output_summary))}`;
    case "sys.call":
      return `Prozess ${pid}: ${syscallLabel(str(d.syscall))}`;
    case "sys.result":
      return d.ok === true
        ? `Kernel-Aufruf erledigt in ${fmtMs(num(d.ms))}`
        : `Kernel-Aufruf abgelehnt: ${clip(str(d.result_summary))}`;
    case "msg.sent":
      return `Nachricht ${num(d.from_pid)} → ${num(d.to_pid)}: »${plain(str(d.preview))}«`;
    case "munin.write":
      return `Speicher: »${plain(str(d.title))}«`;
    case "munin.read":
      return `Speicher durchsucht: »${plain(str(d.query))}« (${num(d.hits)} Treffer)`;
    case "artifact.written":
      return `Artefakt geschrieben: ${str(d.name)} (${fmtInt(num(d.bytes))} Bytes)`;
    case "budget.tick":
      return `Budget ${Math.round(num(d.pct) * 100)} % (Prozess ${pid})`;
    case "budget.exceeded":
      return `Budget überschritten: ${BUDGET_DIMENSION[str(d.which)] ?? str(d.which)}`;
    case "kill":
      return d.target === "all"
        ? `Alle Prozesse beendet (${killer(d.by)})`
        : `Prozess ${num(d.target)} beendet (${killer(d.by)})`;
    default:
      return e.kind;
  }
}

/** A tool's error text can be a whole stack of JSON; the timetable keeps its first words. */
function clip(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The scheduler's reason is an English phrase; the one it really sends is the driver limit. */
function blockedText(pid: number | string, reason: string, limit: number): string {
  const match = /^driver (\w+) at concurrency limit$/.exec(reason);
  if (match === null) return `Prozess ${pid} wartet: ${reason}`;
  const driver = DRIVER_LABEL[match[1]] ?? match[1];
  return `Prozess ${pid} wartet auf einen freien Platz (${driver}: höchstens ${limit} gleichzeitig)`;
}

/** Who pulled the switch: the person at the keyboard is `user`, anything else is a named part. */
function killer(by: unknown): string {
  return by === "user" ? "von dir" : `durch ${str(by)}`;
}

// --- per-kind reduction -------------------------------------------------------------------
// Every branch writes through `patchProc` / `patchRun`, which copy the container they touch,
// so `next` never shares a mutated object with the state the caller handed in.

function reduce(next: State, e: HEvent): void {
  const d = e.data;
  switch (e.kind) {
    case "run.created":
      return createRun(next, e);
    case "run.done":
      return patchRun(next, e.run_id, (run) => ({
        ...run,
        state: "done",
        doneAt: e.ts,
        usage: usageOf(d.usage),
        artifacts: strings(d.artifacts),
      }));
    case "run.failed":
      return patchRun(next, e.run_id, (run) => ({ ...run, state: "failed", doneAt: e.ts }));
    case "sched.started":
      return patchProc(next, e.pid, (proc) => ({ ...proc, startedAt: e.ts }));
    case "proc.spawned":
      return spawnProc(next, e);
    case "proc.state":
      return patchProc(next, e.pid, (proc) => ({ ...proc, state: procStateOf(d.state) }));
    case "proc.text":
      return patchProc(next, e.pid, (proc) => ({
        ...proc,
        transcript: appendText(proc.transcript, str(d.delta)),
      }));
    case "proc.thinking":
      return patchProc(next, e.pid, (proc) => ({
        ...proc,
        thinking: d.on === true,
        transcript: [...proc.transcript, { t: "thinking", on: d.on === true }],
      }));
    case "proc.exit":
      return exitProc(next, e);
    case "tool.call":
      return patchProc(next, e.pid, (proc) => ({
        ...proc,
        transcript: [
          ...proc.transcript,
          {
            t: "tool",
            callId: str(d.call_id),
            tool: str(d.tool),
            input: str(d.input_summary),
            sys: false,
          },
        ],
      }));
    case "sys.call":
      return patchProc(next, e.pid, (proc) => {
        // The Claude driver reaches a syscall through its MCP tool, so the same call is already
        // in the transcript as that tool; a second row would show it twice.
        const last = proc.transcript.at(-1);
        if (last?.t === "tool" && last.ok === undefined && last.tool === `mcp__hugin__${str(d.syscall)}`) {
          return proc;
        }
        return {
          ...proc,
          transcript: [
            ...proc.transcript,
            {
              t: "tool",
              callId: str(d.call_id),
              tool: str(d.syscall),
              input: str(d.args_summary),
              sys: true,
            },
          ],
        };
      });
    case "tool.result":
      return patchProc(next, e.pid, (proc) => ({
        ...proc,
        transcript: fillCall(proc.transcript, str(d.call_id), str(d.output_summary), d.ok === true, num(d.ms)),
      }));
    case "sys.result":
      return patchProc(next, e.pid, (proc) => ({
        ...proc,
        transcript: fillCall(proc.transcript, str(d.call_id), str(d.result_summary), d.ok === true, num(d.ms)),
      }));
    case "msg.sent":
      return addPulse(next, {
        id: pulseId(e),
        from: num(d.from_pid),
        to: num(d.to_pid),
        kind: "msg",
        at: e.ts,
      });
    case "munin.write":
      return muninWrite(next, e);
    case "munin.read":
      next.munin = { ...next.munin, reads: next.munin.reads + 1, lastAt: e.ts };
      return;
    case "artifact.written":
      return patchRun(next, e.run_id, (run) =>
        run.artifacts.includes(str(d.name))
          ? run
          : { ...run, artifacts: [...run.artifacts, str(d.name)] },
      );
    case "budget.tick":
      return budgetTick(next, e);
    default:
      return;
  }
}

function createRun(next: State, e: HEvent): void {
  const id = e.run_id;
  if (id === null) return;
  const active = next.activeRunId === null ? undefined : next.runs[next.activeRunId];
  next.runs = {
    ...next.runs,
    [id]: {
      id,
      goal: str(e.data.goal),
      driver: driverOf(e.data.driver),
      state: "running",
      createdAt: e.ts,
      doneAt: null,
      artifacts: [],
      usage: emptyUsage(),
    },
  };
  if (active === undefined || active.state !== "running") next.activeRunId = id;
}

function spawnProc(next: State, e: HEvent): void {
  const pid = e.pid;
  if (pid === null) return;
  const d = e.data;
  const ppid = typeof d.ppid === "number" ? d.ppid : null;
  next.procs = {
    ...next.procs,
    [pid]: {
      pid,
      runId: e.run_id ?? "",
      ppid,
      program: str(d.program),
      role: str(d.role),
      driver: driverOf(d.driver),
      model: str(d.model),
      task: str(d.task),
      state: "queued",
      budget: budgetOf(d.budget),
      usage: emptyUsage(),
      startedAt: null,
      exitedAt: null,
      exitReason: null,
      stderrTail: null,
      thinking: false,
      budgetPct: 0,
      transcript: [],
      muninWrites: 0,
    },
  };
  if (ppid !== null) {
    addPulse(next, { id: pulseId(e), from: ppid, to: pid, kind: "spawn", at: e.ts });
  }
}

function exitProc(next: State, e: HEvent): void {
  const reported = usageOf(e.data.usage);
  // The exit report is a lump sum over the whole run: it settles the counters but is not
  // throughput, so it stays out of the tokens-per-minute window.
  patchProc(next, e.pid, (proc) => ({
    ...proc,
    usage: mergeExitUsage(proc.usage, reported),
    exitedAt: e.ts,
    exitReason: str(e.data.reason),
    stderrTail: text(e.data.stderr_tail),
    thinking: false,
  }));
}

function budgetTick(next: State, e: HEvent): void {
  const d = e.data;
  sampleTokens(next, e, num(d.output_tokens));
  patchProc(next, e.pid, (proc) => ({
    ...proc,
    budgetPct: num(d.pct),
    usage: {
      ...proc.usage,
      turns: Math.max(proc.usage.turns, num(d.turns)),
      // The kernel added `input_tokens` to the tick later; a recording written before that
      // has none, and then the last known context size is the truthful one.
      input_tokens: Math.max(proc.usage.input_tokens, num(d.input_tokens)),
      output_tokens: Math.max(proc.usage.output_tokens, num(d.output_tokens)),
    },
  }));
}

function muninWrite(next: State, e: HEvent): void {
  next.munin = { ...next.munin, writes: next.munin.writes + 1, lastAt: e.ts };
  if (e.pid === null) return;
  addPulse(next, { id: pulseId(e), from: e.pid, to: "munin", kind: "munin", at: e.ts });
  patchProc(next, e.pid, (proc) => ({ ...proc, muninWrites: proc.muninWrites + 1 }));
}

/**
 * Both `budget.tick` and `proc.exit` report a process's *cumulative* output tokens, so only the
 * growth since the last report may enter the rate window — otherwise every tick counts the run.
 */
function sampleTokens(next: State, e: HEvent, cumulative: number): void {
  const proc = e.pid === null ? undefined : next.procs[e.pid];
  const delta = cumulative - (proc?.usage.output_tokens ?? 0);
  if (delta <= 0) return;
  next.tokenSamples = [...next.tokenSamples, { ts: e.ts, tokens: delta }];
}

// --- helpers ------------------------------------------------------------------------------

function meters(state: State): Meters {
  let activeProcs = 0;
  let budgetPct = 0;
  let totalTokens = 0;
  for (const proc of Object.values(state.procs)) {
    totalTokens += proc.usage.input_tokens + proc.usage.output_tokens;
    if (!isAlive(proc)) continue;
    if (isActive(proc)) activeProcs += 1;
    budgetPct = Math.max(budgetPct, proc.budgetPct);
  }
  // The window is exactly one minute wide, so its sum *is* the tokens-per-minute rate.
  const tokensPerMin =
    activeProcs === 0 ? 0 : state.tokenSamples.reduce((sum, sample) => sum + sample.tokens, 0);
  return { activeProcs, tokensPerMin, budgetPct, totalTokens };
}

function patchProc(next: State, pid: number | null, patch: (proc: Proc) => Proc): void {
  if (pid === null) return;
  const proc = next.procs[pid];
  if (proc === undefined) return; // a backfill can start mid-life; an unknown pid is not an error
  next.procs = { ...next.procs, [pid]: patch(proc) };
}

function patchRun(next: State, runId: string | null, patch: (run: Run) => Run): void {
  if (runId === null) return;
  const run = next.runs[runId];
  if (run === undefined) return;
  next.runs = { ...next.runs, [runId]: patch(run) };
}

function addPulse(next: State, pulse: Pulse): void {
  next.pulses = [...next.pulses, pulse].slice(-MAX_PULSES);
}

/** One event creates at most one pulse, so its seq is a stable, replay-safe key. */
function pulseId(e: HEvent): string {
  return `p${e.seq}`;
}

function appendText(transcript: TranscriptItem[], delta: string): TranscriptItem[] {
  const last = transcript.at(-1);
  if (last?.t === "text") {
    return [...transcript.slice(0, -1), { t: "text", text: last.text + delta }];
  }
  return [...transcript, { t: "text", text: delta }];
}

function fillCall(
  transcript: TranscriptItem[],
  callId: string,
  output: string,
  ok: boolean,
  ms: number,
): TranscriptItem[] {
  return transcript.map((item) =>
    item.t === "tool" && item.callId === callId ? { ...item, output, ok, ms } : item,
  );
}

/**
 * Turns and output tokens are cumulative counters, so the larger one is the truthful one.
 * `input_tokens` is different: live ticks carry the *context size*, while the exit report of the
 * Claude driver sums the input of every turn. Merging the two would push the context gauge past
 * 100 %, so the last live value wins and the exit value only fills in when no tick carried one.
 */
function mergeExitUsage(current: Usage, reported: Usage): Usage {
  return {
    turns: Math.max(current.turns, reported.turns),
    input_tokens: current.input_tokens > 0 ? current.input_tokens : reported.input_tokens,
    output_tokens: Math.max(current.output_tokens, reported.output_tokens),
    cost_usd_equiv: reported.cost_usd_equiv ?? current.cost_usd_equiv,
  };
}

function emptyUsage(): Usage {
  return { turns: 0, input_tokens: 0, output_tokens: 0, cost_usd_equiv: null };
}

function usageOf(value: unknown): Usage {
  const raw = record(value);
  return {
    turns: num(raw.turns),
    input_tokens: num(raw.input_tokens),
    output_tokens: num(raw.output_tokens),
    cost_usd_equiv: typeof raw.cost_usd_equiv === "number" ? raw.cost_usd_equiv : null,
  };
}

function budgetOf(value: unknown): Budget {
  const raw = record(value);
  return {
    max_turns: num(raw.max_turns),
    max_seconds: num(raw.max_seconds),
    max_output_tokens: num(raw.max_output_tokens),
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** An optional string field: absent, null and empty all mean "nothing to show". */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function label(value: unknown): string {
  return STATE_LABEL[str(value)] ?? str(value);
}

// The backend validates both unions before an event is ever published; these only narrow the
// `unknown` payload back to the type the shell works with.
function driverOf(value: unknown): Driver {
  return DRIVERS.includes(value as Driver) ? (value as Driver) : "scripted";
}

function procStateOf(value: unknown): ProcState {
  return PROC_STATES.includes(value as ProcState) ? (value as ProcState) : "queued";
}
