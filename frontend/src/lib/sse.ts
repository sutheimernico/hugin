/**
 * The live event feed.
 *
 * Streaming text arrives at well over 100 events/s, so the client coalesces everything that
 * lands in one animation frame into a single `onBatch` call — one store write and one React
 * render per frame instead of per event (spec §2.9).
 *
 * Reconnect is ours, not the browser's: on error the source is closed and reopened a second
 * later with `since=<last seq seen>`, which is what makes the reducer's idempotency the whole
 * recovery story (spec §5).
 */

import { EVENT_KINDS, type HEvent } from "../state/types";

export type SseStatus = "open" | "closed" | "error";

/** The slice of `EventSource` this client uses — narrow so a test can hand in a fake class. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export type EventSourceCtor = new (url: string) => EventSourceLike;

/**
 * Where the backfill starts. `"boot"` asks the kernel for everything since its own boot —
 * what a freshly loaded shell wants, so it sees this kernel's life and not every run the
 * database ever stored. A reconnect always uses the numeric last seq instead.
 */
export type Since = number | "boot";

export interface ConnectOptions {
  runId?: string;
  since: Since;
  onBatch: (events: HEvent[]) => void;
  onStatus: (status: SseStatus) => void;
  EventSourceImpl?: EventSourceCtor;
}

const RECONNECT_MS = 1_000;
const FRAME_FALLBACK_MS = 16;

export function connectEvents(options: ConnectOptions): () => void {
  const { runId, onBatch, onStatus } = options;
  const Impl = options.EventSourceImpl ?? (globalThis.EventSource as unknown as EventSourceCtor);

  let lastSeq = typeof options.since === "number" ? options.since : 0;
  // Only the first connection may ask for `"boot"`; a reconnect must resume at `lastSeq`,
  // or the reducer would replay the whole kernel life on every dropped connection.
  let firstConnect = true;
  let pending: HEvent[] = [];
  let frameScheduled = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let source: EventSourceLike | undefined;
  let stopped = false;

  function flush(): void {
    frameScheduled = false;
    if (stopped || pending.length === 0) return;
    const batch = pending;
    pending = [];
    onBatch(batch);
  }

  function scheduleFlush(): void {
    if (frameScheduled) return;
    frameScheduled = true;
    // jsdom and headless environments may not have animation frames at all.
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => flush());
    } else {
      setTimeout(flush, FRAME_FALLBACK_MS);
    }
  }

  function receive(event: Event): void {
    const raw = (event as MessageEvent).data;
    if (typeof raw !== "string") return;
    let parsed: HEvent;
    try {
      parsed = JSON.parse(raw) as HEvent;
    } catch {
      return; // a malformed frame is not worth tearing the stream down for
    }
    if (typeof parsed.seq !== "number") return;
    lastSeq = Math.max(lastSeq, parsed.seq);
    pending.push(parsed);
    scheduleFlush();
  }

  function open(): void {
    if (stopped) return;
    const params = new URLSearchParams({ since: String(firstConnect ? options.since : lastSeq) });
    firstConnect = false;
    if (runId !== undefined) params.set("run_id", runId);
    source = new Impl(`/api/events/stream?${params.toString()}`);
    source.addEventListener("open", () => onStatus("open"));
    source.addEventListener("error", () => {
      onStatus("error");
      source?.close();
      source = undefined;
      reconnectTimer = setTimeout(open, RECONNECT_MS);
    });
    // The stream names every frame after its kind, and `EventSource` only delivers a named
    // event to a listener registered under that exact name — `onmessage` would stay silent.
    for (const kind of EVENT_KINDS) source.addEventListener(kind, receive);
  }

  open();

  return function disconnect(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(reconnectTimer);
    source?.close();
    source = undefined;
    onStatus("closed");
  };
}
