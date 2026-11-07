import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fragment, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MODE_LABEL } from "../../lib/i18n";
import type { View } from "../../state/store";
import type { LogLine, Meters, Mode, Proc, Run } from "../../state/types";
import { Timetable } from "../log/Timetable";
import { Layout } from "./Layout";
import { MissionLedger } from "./MissionLedger";
import { ModeChip } from "./ModeChip";
import { TopBar } from "./TopBar";

// The log is virtualised in the browser; in jsdom nothing has a height, so a plain list stands
// in for `Virtuoso` and every line is actually rendered.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data = [],
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: never) => ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data.map((item, index) => (
        <Fragment key={index}>{itemContent(index, item as never)}</Fragment>
      ))}
    </div>
  ),
}));

const METERS: Meters = {
  activeProcs: 2,
  tokensPerMin: 1234,
  budgetPct: 0.25,
  totalTokens: 8000,
};

function renderTopBar(over: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    mode: "idle" as Mode,
    meters: METERS,
    view: "control" as View,
    onViewChange: vi.fn(),
    onKillAll: vi.fn(),
    onOpenPalette: vi.fn(),
    ...over,
  };
  render(<TopBar {...props} />);
  return props;
}

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    goal: "Vergleiche drei Ansätze",
    driver: "scripted",
    state: "running",
    createdAt: 1_000,
    doneAt: null,
    artifacts: [],
    usage: {
      turns: 3,
      input_tokens: 100,
      output_tokens: 50,
      cost_usd_equiv: null,
    },
    ...over,
  };
}

describe("ModeChip", () => {
  const cases: [Mode, string][] = [
    ["idle", "muted"],
    ["claude", "blue"],
    ["ollama", "amber"],
    ["scripted", "teal"],
    ["replay", "plum"],
  ];

  it.each(cases)("renders %s with its label and tone", (mode, tone) => {
    render(<ModeChip mode={mode} />);
    const chip = screen.getByText(MODE_LABEL[mode]);
    expect(chip).toHaveAttribute("data-tone", tone);
  });

  it("glows only while a mode is live, never when idle", () => {
    render(<ModeChip mode="scripted" />);
    render(<ModeChip mode="idle" />);
    expect(screen.getByText(MODE_LABEL.scripted)).toHaveAttribute("data-pulse", "true");
    expect(screen.getByText(MODE_LABEL.idle)).not.toHaveAttribute("data-pulse");
  });
});

describe("TopBar", () => {
  it("shows the wordmark, the tagline, the mode chip, three meters and the palette hint", () => {
    renderTopBar();
    expect(screen.getByText("hugin")).toBeInTheDocument();
    expect(screen.getByText("Gedanken ausschicken. Wissen zurückholen.")).toBeInTheDocument();
    expect(screen.getByText(MODE_LABEL.idle)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Prozesse" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Tokens/min" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Budget" })).toBeInTheDocument();
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
  });

  it("leaves out the controls of a kernel the Pages build does not have", () => {
    renderTopBar({ replayOnly: true });
    expect(screen.queryByRole("button", { name: "Panik" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Befehle öffnen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Munin" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Läufe" })).toBeInTheDocument();
  });

  it("offers the three views and marks the active one", () => {
    renderTopBar({ view: "munin" });
    expect(screen.getByRole("button", { name: "Stellwerk" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("button", { name: "Munin" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Läufe" })).toBeInTheDocument();
  });

  it("switches the view when a tab is clicked", async () => {
    const setView = vi.fn();
    renderTopBar({ onViewChange: setView });
    await userEvent.click(screen.getByRole("button", { name: "Munin" }));
    expect(setView).toHaveBeenCalledWith("munin");
  });

  it("opens the palette from the ⌘K hint", async () => {
    const onOpenPalette = vi.fn();
    renderTopBar({ onOpenPalette });
    await userEvent.click(screen.getByRole("button", { name: "Befehle öffnen" }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("asks before killing and only then reports the confirmation", async () => {
    const onKillAll = vi.fn();
    renderTopBar({ mode: "scripted", onKillAll });

    await userEvent.click(screen.getByRole("button", { name: "Panik" }));
    expect(screen.getByText("Alle Prozesse beenden?")).toBeInTheDocument();
    expect(onKillAll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Beenden" }));
    expect(onKillAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Alle Prozesse beenden?")).not.toBeInTheDocument();
  });

  it("closes the confirmation without killing anything", async () => {
    const onKillAll = vi.fn();
    renderTopBar({ mode: "scripted", onKillAll });

    await userEvent.click(screen.getByRole("button", { name: "Panik" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByText("Alle Prozesse beenden?")).not.toBeInTheDocument();
    expect(onKillAll).not.toHaveBeenCalled();
  });
});

describe("MissionLedger", () => {
  const procs = [
    { runId: "r1", state: "running", budgetPct: 0.4, usage: { turns: 3, output_tokens: 1_200 } },
    { runId: "r1", state: "done", budgetPct: 1, usage: { turns: 2, output_tokens: 300 } },
  ] as unknown as Proc[];

  it("shows the goal as the headline with running time, turns, tokens and agents", () => {
    render(<MissionLedger run={makeRun()} procs={procs} now={1_063} replaying={false} />);
    expect(screen.getByRole("heading", { name: "Vergleiche drei Ansätze" })).toBeInTheDocument();
    expect(screen.getByText("1:03")).toBeInTheDocument();
    expect(screen.getByText("Läuft")).toBeInTheDocument();
    expect(screen.getByText("1,5k")).toBeInTheDocument();
    expect(screen.getByText("/2")).toBeInTheDocument();
    expect(screen.getByText("40 %")).toBeInTheDocument();
  });

  it("says that a simulated mission plays a fixed script", () => {
    render(<MissionLedger run={makeRun({ driver: "scripted" })} procs={[]} now={1_063} replaying={false} />);
    expect(screen.getByText(/Simulation: feste Beispiel-Mission/)).toBeInTheDocument();
  });

  it("does not claim a script for a live driver or for a replay", () => {
    const { rerender } = render(
      <MissionLedger run={makeRun({ driver: "claude" })} procs={[]} now={1_063} replaying={false} />,
    );
    expect(screen.queryByText(/Simulation: feste/)).not.toBeInTheDocument();
    rerender(<MissionLedger run={makeRun({ driver: "scripted" })} procs={[]} now={1_063} replaying />);
    expect(screen.queryByText(/Simulation: feste/)).not.toBeInTheDocument();
    expect(screen.getByText(/Aufgezeichnet/)).toBeInTheDocument();
  });

  it("freezes the running time of a finished mission at its end", () => {
    render(
      <MissionLedger run={makeRun({ state: "done", doneAt: 1_030 })} procs={[]} now={9_999} replaying={false} />,
    );
    expect(screen.getByText("0:30")).toBeInTheDocument();
    expect(screen.getByText("Fertig")).toBeInTheDocument();
  });

  it("names the program instead of the kernel's goal prefix", () => {
    render(
      <MissionLedger run={makeRun({ goal: "program:scout Finde etwas" })} procs={[]} now={1_063} replaying={false} />,
    );
    expect(screen.getByRole("heading", { name: "Späher: Finde etwas" })).toBeInTheDocument();
  });
});

describe("Timetable", () => {
  const lines: LogLine[] = [
    { seq: 1, ts: 1_757_000_000, kind: "run.created", pid: null, text: "Mission gestartet: »Ziel«" },
    { seq: 2, ts: 1_757_000_042, kind: "proc.spawned", pid: 7, text: "Prozess 7 (scout) gestartet" },
    { seq: 3, ts: 1_757_000_043, kind: "munin.write", pid: 7, text: "Speicher: »Fund«" },
  ];

  it("renders every line with its pid, its departure time and its text", () => {
    render(<Timetable lines={lines} origin={1_757_000_000} />);
    expect(screen.getAllByTestId("log-line")).toHaveLength(3);
    expect(screen.getByText("Prozess 7 (scout) gestartet")).toBeInTheDocument();
    expect(screen.getAllByText("7")).toHaveLength(2);
    // Counted from the start of the mission, not from the wall clock.
    expect(screen.getByText("0:42")).toBeInTheDocument();
  });

  it("drops what happened before the mission began", () => {
    render(<Timetable lines={lines} origin={1_757_000_042} />);
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);
  });

  it("tags a line with its event kind", () => {
    render(<Timetable lines={lines} origin={null} />);
    expect(screen.getAllByTestId("log-line").map((row) => row.dataset.kind)).toEqual([
      "run.created",
      "proc.spawned",
      "munin.write",
    ]);
  });

  it("says that the kernel is waiting when nothing happened yet", () => {
    render(<Timetable lines={[]} origin={null} />);
    expect(screen.getByText("Kernel bereit — warte auf Ereignisse")).toBeInTheDocument();
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
  });
});

describe("Layout", () => {
  it("renders the frame's rows: bar, working area, timeline and navigation", () => {
    render(
      <Layout topBar={<span>oben</span>} bottom={<span>unten</span>} nav={<span>nav</span>}>
        <span>mitte</span>
      </Layout>,
    );
    for (const slot of ["oben", "mitte", "unten", "nav"]) {
      expect(screen.getByText(slot)).toBeInTheDocument();
    }
  });
});

describe("ModeChip in the replay-only build", () => {
  it("does not claim a ready kernel when there is none", () => {
    render(<ModeChip mode="idle" replayOnly />);
    expect(screen.getByText("AUFZEICHNUNGEN")).toBeInTheDocument();
    expect(screen.queryByText("BEREIT")).not.toBeInTheDocument();
  });
});
