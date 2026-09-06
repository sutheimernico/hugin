/**
 * Typed wrappers around the kernel's HTTP API — one function per route, no caching and no
 * state. Callers own the freshness question; the shell's truth is the event stream, not this.
 *
 * The API speaks the backend's snake_case. Only `Run` is mapped into the shell's camelCase
 * projection type (the palette and the runs view render `Run` objects); everything else is
 * returned in the shape the route actually sends, so a field name here can be checked against
 * `src/hugin/api/` without a translation step.
 */

import type {
  Budget,
  Driver,
  HEvent,
  ProcState,
  Run,
  SystemStatus,
  Usage,
} from "../state/types";

export interface ApiProc {
  pid: number;
  run_id: string;
  ppid: number | null;
  program: string;
  role: string;
  driver: Driver;
  model: string;
  state: ProcState;
  task: string;
  budget: Budget;
  usage: Usage;
  started_at: number | null;
  exited_at: number | null;
  exit_reason: string | null;
}

export interface ApiProgram {
  name: string;
  role: string;
  icon: string;
  accent: "violet" | "cyan" | "amber" | "green" | "rose";
  driver: Driver;
  model: string;
  tools: string[];
  capabilities: string[];
  budget: Budget;
}

export interface ApiTemplate {
  id: string;
  title: string;
  goal: string;
}

export interface ApiMemory {
  id: number;
  title: string;
  body: string;
  tags: string[];
  run_id: string | null;
  pid: number | null;
  program: string | null;
  created_at: number;
}

export interface ApiArtifact {
  name: string;
  bytes: number;
}

/** A recording's manifest, exactly as `replay/recorder.py` writes it. */
export interface ApiRecording {
  slug: string;
  run_id: string;
  goal: string;
  /** The manifest copies the driver out of `run.created`; an empty string means it had none. */
  driver: string;
  events: number;
  duration_s: number;
  exported_at: number;
}

interface ApiRun {
  id: string;
  goal: string;
  driver: Driver;
  template: string | null;
  state: "running" | "done" | "failed";
  created_at: number;
  done_at: number | null;
  root_pid: number | null;
  usage: Usage;
  artifacts: string[];
}

/** A failed request carries the backend's German `detail` so a view can show it unchanged. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** What this machine can actually run — the boot screen, the palette and the gate share it. */
export async function getSystem(): Promise<SystemStatus> {
  return request<SystemStatus>("/api/system");
}

export async function getRuns(): Promise<Run[]> {
  const runs = await request<ApiRun[]>("/api/runs");
  return runs.map(toRun);
}

export async function getRun(runId: string): Promise<Run> {
  return toRun(await request<ApiRun>(`/api/runs/${encodeURIComponent(runId)}`));
}

export async function getRunEvents(runId: string, since = 0): Promise<HEvent[]> {
  return request<HEvent[]>(`/api/runs/${encodeURIComponent(runId)}/events?since=${since}`);
}

export async function getRecordings(): Promise<ApiRecording[]> {
  return request<ApiRecording[]>("/api/recordings");
}

/**
 * A recording's events, renumbered from 1 by the recorder — which is why replaying one needs
 * no run id: the file *is* the run.
 */
export async function getRecordingEvents(slug: string): Promise<HEvent[]> {
  return request<HEvent[]>(`/api/recordings/${encodeURIComponent(slug)}/events`);
}

export async function getArtifacts(runId: string): Promise<ApiArtifact[]> {
  return request<ApiArtifact[]>(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
}

export async function getProcs(): Promise<ApiProc[]> {
  return request<ApiProc[]>("/api/procs");
}

export async function getPrograms(): Promise<ApiProgram[]> {
  return request<ApiProgram[]>("/api/programs");
}

export async function getTemplates(): Promise<ApiTemplate[]> {
  return request<ApiTemplate[]>("/api/templates");
}

export async function postMission(
  goal: string,
  driver: Driver,
  template?: string,
): Promise<{ run_id: string }> {
  return request<{ run_id: string }>("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, driver, template: template ?? null }),
  });
}

export async function killProc(pid: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/procs/${pid}/kill`, { method: "POST" });
}

export async function killAll(): Promise<{ killed: number[] }> {
  return request<{ killed: number[] }>("/api/kill-all", { method: "POST" });
}

export async function searchMunin(q: string, limit = 10): Promise<ApiMemory[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return request<ApiMemory[]>(`/api/munin/search?${params.toString()}`);
}

export async function recentMunin(limit = 20): Promise<ApiMemory[]> {
  return request<ApiMemory[]>(`/api/munin/recent?limit=${limit}`);
}

function toRun(run: ApiRun): Run {
  return {
    id: run.id,
    goal: run.goal,
    driver: run.driver,
    state: run.state,
    createdAt: run.created_at,
    doneAt: run.done_at,
    artifacts: run.artifacts,
    usage: run.usage,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new ApiError(response.status, await detail(response));
  return (await response.json()) as T;
}

async function detail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // an error page that is not JSON — fall through to the generic message
  }
  return `Die Anfrage ist fehlgeschlagen (HTTP ${response.status}).`;
}
