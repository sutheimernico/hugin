import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState } from "../../state/reducer";
import { useHuginStore } from "../../state/store";
import type { SystemStatus } from "../../state/types";
import { CommandPalette } from "./CommandPalette";

const api = vi.hoisted(() => ({
  getTemplates: vi.fn(),
  getRuns: vi.fn(),
  postMission: vi.fn(),
  killAll: vi.fn(),
}));

vi.mock("../../lib/api", () => api);

const TEMPLATE = {
  id: "research_brief",
  title: "Recherche-Briefing",
  goal: "Erstelle ein Recherche-Briefing zu: {Thema}",
};

const RUN = {
  id: "r1",
  goal: "Vergleiche drei Ansätze",
  driver: "scripted" as const,
  state: "done" as const,
  createdAt: 1_000,
  doneAt: 1_010,
  artifacts: [],
  usage: { turns: 2, input_tokens: 0, output_tokens: 0, cost_usd_equiv: null },
};

const onToast = vi.fn();

/** The palette is controlled by the shell; this mirrors the wiring in `App.tsx`. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <CommandPalette
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onToast={onToast}
    />
  );
}

async function openPalette(key: { metaKey?: boolean; ctrlKey?: boolean } = { metaKey: true }) {
  render(<Harness />);
  await userEvent.keyboard(key.ctrlKey ? "{Control>}k{/Control}" : "{Meta>}k{/Meta}");
  return screen.findByPlaceholderText("Was soll hugin tun?");
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTemplates.mockResolvedValue([TEMPLATE]);
  api.getRuns.mockResolvedValue([RUN]);
  api.postMission.mockResolvedValue({ run_id: "r2" });
  api.killAll.mockResolvedValue({ killed: [] });
  useHuginStore.setState({
    state: initialState,
    system: null,
    view: "control",
    muninQuery: "",
    selectedPid: null,
  });
});

describe("CommandPalette", () => {
  it("opens on ⌘K and lists the templates in their group", async () => {
    await openPalette();
    expect(await screen.findByText("Mission starten: Recherche-Briefing")).toBeInTheDocument();
    expect(screen.getByText("Mission")).toBeInTheDocument();
    expect(screen.getByText("Alle Prozesse beenden")).toBeInTheDocument();
    expect(await screen.findByText("Run öffnen: Vergleiche drei Ansätze")).toBeInTheDocument();
    expect(screen.getByText("Munin durchsuchen…")).toBeInTheDocument();
  });

  it("highlights a mission first, never the command that kills every agent", async () => {
    await openPalette();
    const first = await screen.findByText("Mission starten: Recherche-Briefing");
    await waitFor(() =>
      expect(first.closest("[cmdk-item]")).toHaveAttribute("data-selected", "true"),
    );
  });

  it("opens on Ctrl+K as well", async () => {
    expect(await openPalette({ ctrlKey: true })).toBeInTheDocument();
  });

  it("starts a template mission with the simulation driver and reports it", async () => {
    await openPalette();
    await userEvent.click(await screen.findByText("Mission starten: Recherche-Briefing"));

    await waitFor(() => expect(api.postMission).toHaveBeenCalledWith(TEMPLATE.goal, "scripted"));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Mission gestartet", "info"));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Was soll hugin tun?")).not.toBeInTheDocument(),
    );
  });

  it("shows the backend's German reason when a mission is rejected", async () => {
    api.postMission.mockRejectedValue(new Error("Pfade müssen unter ~/private liegen."));
    await openPalette();
    await userEvent.click(await screen.findByText("Mission starten: Recherche-Briefing"));
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith("Pfade müssen unter ~/private liegen.", "error"),
    );
  });

  it("turns free text into a mission command", async () => {
    const input = await openPalette();
    await userEvent.type(input, "Finde drei Optionen");
    expect(await screen.findByText("Mission starten: »Finde drei Optionen«")).toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(api.postMission).toHaveBeenCalledWith("Finde drei Optionen", "scripted"),
    );
  });

  it("starts with the simulation driver and hands the picked one to the mission", async () => {
    const input = await openPalette();
    expect(screen.getByRole("button", { name: "Simulation" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "Claude (Abo)" }));
    await userEvent.type(input, "Ziel");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(api.postMission).toHaveBeenCalledWith("Ziel", "claude"));
  });

  it("disables an unavailable driver with its German reason", async () => {
    const system: SystemStatus = {
      claude: { ok: false, version: null, detail: "kein Abo-Login gefunden" },
      ollama: { ok: true, models: [], detail: "" },
      munin: { count: 0 },
      programs: [],
      kernel: { uptime_s: 1, procs: 0, version: "0.1.0" },
    };
    useHuginStore.setState({ system });
    await openPalette();

    const claude = screen.getByRole("button", { name: "Claude (Abo)" });
    expect(claude).toBeDisabled();
    expect(claude).toHaveAttribute("title", expect.stringContaining("Claude nicht angemeldet"));
  });

  it("opens the munin view with the browser's own query", async () => {
    await openPalette();
    await userEvent.click(screen.getByText("Munin durchsuchen…"));
    await waitFor(() => expect(useHuginStore.getState().view).toBe("munin"));
  });

  it("shows a run in mission control", async () => {
    await openPalette();
    await userEvent.click(await screen.findByText("Run öffnen: Vergleiche drei Ansätze"));
    await waitFor(() => expect(useHuginStore.getState().state.activeRunId).toBe("r1"));
  });

  it("closes on Escape", async () => {
    await openPalette();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Was soll hugin tun?")).not.toBeInTheDocument(),
    );
  });

  it("loads templates and runs once per opening, not on every keystroke", async () => {
    const input = await openPalette();
    await userEvent.type(input, "abc");
    expect(api.getTemplates).toHaveBeenCalledTimes(1);
    expect(api.getRuns).toHaveBeenCalledTimes(1);
  });
});
