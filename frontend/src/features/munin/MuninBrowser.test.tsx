import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiMemory } from "../../lib/api";
import { useHuginStore } from "../../state/store";
import { MuninBrowser } from "./MuninBrowser";

const api = vi.hoisted(() => ({ searchMunin: vi.fn(), recentMunin: vi.fn() }));

vi.mock("../../lib/api", () => api);

/** Ages are measured against the wall clock, so the fixtures are anchored to it. */
const NOW = Date.now() / 1_000;

function memory(over: Partial<ApiMemory> = {}): ApiMemory {
  return {
    id: 1,
    title: "VRAM reicht für 7B-Modelle",
    body: "Zeile eins\nZeile zwei",
    tags: ["hardware", "ollama"],
    run_id: "run-1",
    pid: 3,
    program: "scout",
    created_at: NOW - 180,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useHuginStore.setState({ muninQuery: "" });
  api.recentMunin.mockResolvedValue([memory()]);
  api.searchMunin.mockResolvedValue([memory()]);
});

describe("MuninBrowser", () => {
  it("lists the newest memories while nothing is typed", async () => {
    render(<MuninBrowser />);

    expect(await screen.findByText("VRAM reicht für 7B-Modelle")).toBeInTheDocument();
    expect(api.recentMunin).toHaveBeenCalledTimes(1);
    expect(api.searchMunin).not.toHaveBeenCalled();
    expect(screen.getByText("hardware")).toBeInTheDocument();
    expect(screen.getByText(/scout/)).toBeInTheDocument();
    expect(screen.getByText(/PID 3/)).toBeInTheDocument();
    expect(screen.getByText(/vor 3 Min\./)).toBeInTheDocument();
  });

  it("says that munin is empty when it has nothing and nothing was asked", async () => {
    api.recentMunin.mockResolvedValue([]);
    render(<MuninBrowser />);
    expect(
      await screen.findByText("Munin ist noch leer — starte eine Mission."),
    ).toBeInTheDocument();
  });

  it("names the query that found nothing", async () => {
    api.searchMunin.mockResolvedValue([]);
    render(<MuninBrowser />);
    await userEvent.type(screen.getByRole("searchbox"), "quark");
    expect(await screen.findByText("Keine Treffer für »quark«.")).toBeInTheDocument();
  });

  it("searches once for a burst of keystrokes, not once per key", async () => {
    render(<MuninBrowser />);
    await screen.findByText("VRAM reicht für 7B-Modelle");

    await userEvent.type(screen.getByRole("searchbox"), "VRAM");
    await waitFor(() => expect(api.searchMunin).toHaveBeenCalledTimes(1));
    expect(api.searchMunin).toHaveBeenCalledWith("VRAM");
  });

  it("shows body and provenance of the memory that was clicked", async () => {
    render(<MuninBrowser />);
    await userEvent.click(await screen.findByRole("button", { name: /VRAM reicht/ }));

    expect(screen.getByText(/Zeile eins/)).toBeInTheDocument();
    expect(screen.getByTestId("munin-provenance")).toHaveTextContent(
      /^Geschrieben von scout · PID 3 · Run run-1 · \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/,
    );
  });

  it("opens with the palette's query prefilled and consumes it", async () => {
    useHuginStore.setState({ muninQuery: "VRAM" });
    render(<MuninBrowser />);

    await waitFor(() => expect(api.searchMunin).toHaveBeenCalledWith("VRAM"));
    expect(screen.getByRole("searchbox")).toHaveValue("VRAM");
    expect(api.recentMunin).not.toHaveBeenCalled();
    // Consumed: switching back to the view later must not re-run a stale query.
    expect(useHuginStore.getState().muninQuery).toBe("");
  });

  it("reloads when an agent writes a new memory during a run", async () => {
    render(<MuninBrowser />);
    await waitFor(() => expect(api.recentMunin).toHaveBeenCalledTimes(1));

    const state = useHuginStore.getState().state;
    useHuginStore.setState({ state: { ...state, munin: { writes: 1, reads: 0, lastAt: NOW } } });
    await waitFor(() => expect(api.recentMunin).toHaveBeenCalledTimes(2));
  });
});
