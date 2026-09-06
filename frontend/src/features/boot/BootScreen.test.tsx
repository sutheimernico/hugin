import { act, fireEvent, render, screen } from "@testing-library/react";
import { hasReducedMotionListener, prefersReducedMotion } from "motion-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHuginStore } from "../../state/store";
import type { SystemStatus } from "../../state/types";
import { BootScreen } from "./BootScreen";
import { LINE_MS, SEQUENCE_TAIL_MS } from "./sequence";

const api = vi.hoisted(() => ({ getSystem: vi.fn() }));

vi.mock("../../lib/api", () => api);

/**
 * `motion` caches the reduced-motion answer in a module singleton the first time any component
 * asks, so stubbing `matchMedia` between tests would come too late. Writing the singleton is
 * the only order-independent way to test both paths in one file.
 */
function setReducedMotion(value: boolean): void {
  hasReducedMotionListener.current = true;
  prefersReducedMotion.current = value;
}

function status(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    claude: { ok: true, version: "2.1.261", detail: "Abo-Login erkannt" },
    ollama: { ok: true, models: ["a", "b", "c", "d"], detail: "4 Modelle" },
    munin: { count: 128 },
    programs: ["planner", "scout", "smith", "judge", "scribe"],
    kernel: { uptime_s: 12, procs: 0, version: "0.1.0" },
    ...over,
  };
}

/** The whole sequence: one line every `LINE_MS`, then wordmark, hold and lift. */
function sequenceMs(lines: number): number {
  return lines * LINE_MS + SEQUENCE_TAIL_MS;
}

/** Renders and lets the `/api/system` promise settle, so the log has its content. */
async function boot(onDone = vi.fn()) {
  render(<BootScreen onDone={onDone} />);
  await act(async () => {});
  return onDone;
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The `<li>` a subsystem label sits in — label, detail and marker are separate spans. */
function line(label: string): HTMLElement {
  const element = screen.getByText(label).closest("li");
  if (element === null) throw new Error(`no boot line for ${label}`);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setReducedMotion(false);
  useHuginStore.setState({ system: null });
  api.getSystem.mockResolvedValue(status());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BootScreen", () => {
  it("types the log out of the real system status", async () => {
    await boot();
    advance(6 * LINE_MS);

    expect(line("hugin kernel")).toHaveTextContent("0.1.0");
    expect(line("claude")).toHaveTextContent("2.1.261 · Abo-Login ✓");
    expect(line("claude")).toHaveAttribute("data-tone", "ok");
    expect(line("ollama")).toHaveTextContent("4 Modelle ✓");
    expect(line("munin")).toHaveTextContent("128 Einträge");
    expect(line("programs")).toHaveTextContent("planner scout smith judge scribe");
    expect(line("shell")).toHaveTextContent("bereit");
    expect(screen.getByRole("img", { name: "hugin" })).toBeInTheDocument();
  });

  it("reveals one line at a time", async () => {
    await boot();
    advance(LINE_MS);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    advance(LINE_MS);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("stores the status so the palette can gate its drivers", async () => {
    await boot();
    expect(useHuginStore.getState().system).toEqual(status());
  });

  it("marks an unavailable driver amber and keeps the kernel's German wording", async () => {
    api.getSystem.mockResolvedValue(
      status({
        claude: { ok: false, version: null, detail: "Nicht angemeldet" },
        ollama: { ok: false, models: [], detail: "Nicht erreichbar" },
      }),
    );
    await boot();
    advance(6 * LINE_MS);

    expect(line("claude")).toHaveTextContent("Nicht angemeldet ⚠");
    expect(line("claude")).toHaveAttribute("data-tone", "warn");
    expect(line("ollama")).toHaveTextContent("Nicht erreichbar ⚠");
    expect(line("ollama")).toHaveAttribute("data-tone", "warn");
  });

  it("calls onDone once the sequence has run, not before", async () => {
    const onDone = await boot();
    advance(sequenceMs(6) - 50);
    expect(onDone).not.toHaveBeenCalled();

    advance(50);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stays inside the 2.5 s budget", () => {
    expect(sequenceMs(6)).toBeLessThanOrEqual(2_500);
  });

  it("skips on Escape", async () => {
    const onDone = await boot();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("skips on a click anywhere", async () => {
    const onDone = await boot();
    fireEvent.click(screen.getByRole("status"));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onDone only once when a skip races the end of the sequence", async () => {
    const onDone = await boot();
    fireEvent.keyDown(window, { key: "Escape" });
    advance(sequenceMs(6));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("says so in red when the API cannot be reached, and still completes", async () => {
    api.getSystem.mockRejectedValue(new Error("offline"));
    const onDone = await boot();
    advance(2 * LINE_MS);

    expect(line("api")).toHaveTextContent("nicht erreichbar ✗");
    expect(line("api")).toHaveAttribute("data-tone", "error");
    expect(useHuginStore.getState().system).toBeNull();

    advance(sequenceMs(2));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows the finished sequence briefly and lifts without animating under reduced motion", async () => {
    setReducedMotion(true);
    const onDone = await boot();

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("img", { name: "hugin" })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    advance(300);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
