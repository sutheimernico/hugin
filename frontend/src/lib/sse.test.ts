import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents, type EventSourceLike } from "./sse";
import type { HEvent } from "../state/types";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close(): void {
    this.closed = true;
  }

  /** Deliver an SSE frame the way the browser would: named event, JSON payload. */
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: data === undefined ? undefined : JSON.stringify(data) } as unknown as Event);
    }
  }

  static last(): FakeEventSource {
    const instance = FakeEventSource.instances.at(-1);
    if (!instance) throw new Error("no EventSource was created");
    return instance;
  }
}

function event(seq: number, kind = "proc.text"): HEvent {
  return { seq, ts: 1000 + seq, run_id: "r1", pid: 1, kind, data: { delta: "x" } };
}

let frames: (() => void)[] = [];

function flushFrame(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback();
}

beforeEach(() => {
  FakeEventSource.instances = [];
  frames = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connectEvents", () => {
  it("coalesces every message of one frame into a single batch", () => {
    const onBatch = vi.fn();
    connectEvents({ since: 0, onBatch, onStatus: vi.fn(), EventSourceImpl: FakeEventSource });

    const source = FakeEventSource.last();
    source.emit("proc.text", event(1));
    source.emit("proc.text", event(2));
    source.emit("tool.call", event(3, "tool.call"));

    expect(onBatch).not.toHaveBeenCalled();
    flushFrame();

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch.mock.calls[0][0].map((e: HEvent) => e.seq)).toEqual([1, 2, 3]);
  });

  it("falls back to a 16 ms timer when the browser has no animation frames", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const onBatch = vi.fn();
    connectEvents({ since: 0, onBatch, onStatus: vi.fn(), EventSourceImpl: FakeEventSource });

    FakeEventSource.last().emit("proc.text", event(1));
    expect(onBatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(onBatch).toHaveBeenCalledTimes(1);
  });

  it("asks for everything after `since` and scopes to a run when asked", () => {
    connectEvents({
      since: 12,
      runId: "r1",
      onBatch: vi.fn(),
      onStatus: vi.fn(),
      EventSourceImpl: FakeEventSource,
    });

    expect(FakeEventSource.last().url).toContain("since=12");
    expect(FakeEventSource.last().url).toContain("run_id=r1");
  });

  it("reports open and error status", () => {
    const onStatus = vi.fn();
    connectEvents({ since: 0, onBatch: vi.fn(), onStatus, EventSourceImpl: FakeEventSource });

    FakeEventSource.last().emit("open");
    expect(onStatus).toHaveBeenCalledWith("open");

    FakeEventSource.last().emit("error");
    expect(onStatus).toHaveBeenCalledWith("error");
  });

  it("reconnects a second later with the last seq it saw", () => {
    connectEvents({ since: 0, onBatch: vi.fn(), onStatus: vi.fn(), EventSourceImpl: FakeEventSource });

    const first = FakeEventSource.last();
    first.emit("proc.text", event(42));
    flushFrame();
    first.emit("error");

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.last().url).toContain("since=42");
  });

  it("stops for good once disconnected", () => {
    const onStatus = vi.fn();
    const disconnect = connectEvents({
      since: 0,
      onBatch: vi.fn(),
      onStatus,
      EventSourceImpl: FakeEventSource,
    });

    const source = FakeEventSource.last();
    source.emit("error");
    disconnect();

    expect(source.closed).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith("closed");

    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("drops a frame that has nothing in it", () => {
    const onBatch = vi.fn();
    connectEvents({ since: 0, onBatch, onStatus: vi.fn(), EventSourceImpl: FakeEventSource });

    flushFrame();
    expect(onBatch).not.toHaveBeenCalled();
  });
});
