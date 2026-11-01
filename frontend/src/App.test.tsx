import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { BOOTED_KEY } from "./features/palette/commands";
import type { SystemStatus } from "./state/types";

// jsdom has no EventSource; the shell opens one on mount, so it gets an inert stand-in.
class FakeEventSource {
  addEventListener(): void {}
  close(): void {}
}

const SYSTEM: SystemStatus = {
  claude: { ok: true, version: "2.1.261", detail: "Abo-Login erkannt" },
  ollama: { ok: true, models: ["a"], detail: "1 Modell" },
  munin: { count: 3 },
  programs: ["planner", "scout"],
  kernel: { uptime_s: 1, procs: 0, version: "0.1.0" },
};

/** The shell asks `/api/system` on every start; no test is allowed near the network. */
function fakeFetch(url: string): Response {
  const body = url.startsWith("/api/recordings") ? [] : SYSTEM;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Lets the status request settle, so nothing lands in the store after the test. */
async function settle(): Promise<void> {
  await act(async () => {});
}

beforeAll(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => fakeFetch(url)));
});

beforeEach(() => {
  // The default for these tests is a session that has already booted — the boot sequence has
  // its own file, and an overlay in front of the shell would hide everything asserted here.
  window.sessionStorage.setItem(BOOTED_KEY, "1");
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("App", () => {
  it("shows the wordmark and the idle mode chip", async () => {
    render(<App />);
    expect(screen.getByText("hugin")).toBeInTheDocument();
    expect(screen.getByText("BEREIT")).toBeInTheDocument();
    await settle();
  });

  it("shows the designed empty states of an idle shell", async () => {
    render(<App />);
    // An idle shell has no mission: one stage with the way to start one, not three empty panels.
    expect(screen.getByRole("heading", { name: "Gleis frei." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mission starten/ })).toBeInTheDocument();
    expect(await screen.findByText(/Noch keine Aufzeichnungen/)).toBeInTheDocument();
    await settle();
  });

  it("skips the boot sequence once this browser session has seen it", async () => {
    render(<App />);
    expect(screen.queryByRole("status", { name: "Startsequenz" })).not.toBeInTheDocument();
    await settle();
  });

  it("gives the keyboard back to whatever had it when the palette closes", async () => {
    render(<App />);
    await settle();

    const trigger = screen.getByRole("button", { name: /Befehle/ });
    trigger.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(await screen.findByPlaceholderText("Was soll hugin tun?")).toHaveFocus();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(trigger).toHaveFocus();
  });

  it("plays the boot sequence on the first load of a session", async () => {
    window.sessionStorage.removeItem(BOOTED_KEY);
    render(<App />);
    await settle();

    expect(await screen.findByRole("status", { name: "Startsequenz" })).toBeInTheDocument();
  });
});
