import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fragment, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MODE_LABEL } from "../../lib/i18n";
import type { LogLine, Meters, Mode, Run } from "../../state/types";
import { KernelLog } from "../log/KernelLog";
import { Layout } from "./Layout";
import { MissionBar } from "./MissionBar";
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

const METERS: Meters = { activeProcs: 2, tokensPerMin: 1234, budgetPct: 0.25, totalTokens: 8000 };

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    goal: "Vergleiche drei Ansätze",
    driver: "scripted",
    state: "running",
    createdAt: 1_000,
    doneAt: null,
    artifacts: [],
    usage: { turns: 3, input_tokens: 100, output_tokens: 50, cost_usd_equiv: null },
    ...over,
  };
}

describe("ModeChip", () => {
  const cases: [Mode, string][] = [
    ["idle", "muted"],
    ["claude", "violet"],
    ["ollama", "amber"],
    ["scripted", "cyan"],
    ["replay", "rose"],
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
    render(<TopBar mode="idle" meters={METERS} onKillAll={vi.fn()} />);
    expect(screen.getByText("hugin")).toBeInTheDocument();
    expect(screen.getByText("Gedanken ausschicken. Wissen zurückholen.")).toBeInTheDocument();
    expect(screen.getByText(MODE_LABEL.idle)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Aktive Prozesse" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Tokens/min" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Budget" })).toBeInTheDocument();
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
  });

  it("asks before killing and only then reports the confirmation", async () => {
    const onKillAll = vi.fn();
    render(<TopBar mode="scripted" meters={METERS} onKillAll={onKillAll} />);

    await userEvent.click(screen.getByRole("button", { name: "Panik" }));
    expect(screen.getByText("Alle Prozesse beenden?")).toBeInTheDocument();
    expect(onKillAll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Beenden" }));
    expect(onKillAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Alle Prozesse beenden?")).not.toBeInTheDocument();
  });

  it("closes the confirmation without killing anything", async () => {
    const onKillAll = vi.fn();
    render(<TopBar mode="scripted" meters={METERS} onKillAll={onKillAll} />);

    await userEvent.click(screen.getByRole("button", { name: "Panik" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByText("Alle Prozesse beenden?")).not.toBeInTheDocument();
    expect(onKillAll).not.toHaveBeenCalled();
  });
});

describe("MissionBar", () => {
  it("points at the palette while no mission exists", () => {
    render(<MissionBar run={undefined} now={1_000} />);
    expect(screen.getByText(/Keine aktive Mission/)).toBeInTheDocument();
  });

  it("shows goal, running time and state of the mission", () => {
    render(<MissionBar run={makeRun()} now={1_063} />);
    expect(screen.getByText("Vergleiche drei Ansätze")).toBeInTheDocument();
    expect(screen.getByText("1:03")).toBeInTheDocument();
    expect(screen.getByText("Läuft")).toBeInTheDocument();
  });

  it("freezes the running time of a finished mission at its end", () => {
    render(<MissionBar run={makeRun({ state: "done", doneAt: 1_030 })} now={9_999} />);
    expect(screen.getByText("0:30")).toBeInTheDocument();
    expect(screen.getByText("Fertig")).toBeInTheDocument();
  });
});

describe("KernelLog", () => {
  const lines: LogLine[] = [
    { seq: 1, ts: 1_757_000_000, kind: "run.created", pid: null, text: "Mission gestartet: »Ziel«" },
    { seq: 2, ts: 1_757_000_001, kind: "proc.spawned", pid: 7, text: "Prozess 7 (scout) gestartet" },
    { seq: 3, ts: 1_757_000_002, kind: "munin.write", pid: 7, text: "Speicher: »Fund«" },
  ];

  it("renders every line with its pid and text", () => {
    render(<KernelLog lines={lines} />);
    expect(screen.getAllByTestId("log-line")).toHaveLength(3);
    expect(screen.getByText("Prozess 7 (scout) gestartet")).toBeInTheDocument();
    expect(screen.getAllByText("[7]")).toHaveLength(2);
  });

  it("colours a line by its event family", () => {
    render(<KernelLog lines={lines} />);
    const [runLine, procLine, muninLine] = screen.getAllByTestId("log-line");
    expect(runLine).toHaveClass("text-text");
    expect(procLine).toHaveClass("text-violet");
    expect(muninLine).toHaveClass("text-green");
  });

  it("says that the kernel is waiting when nothing happened yet", () => {
    render(<KernelLog lines={[]} />);
    expect(screen.getByText("Kernel bereit — warte auf Ereignisse")).toBeInTheDocument();
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
  });
});

describe("Layout", () => {
  it("renders every slot of the mission control frame", () => {
    render(
      <Layout
        topBar={<span>oben</span>}
        left={<span>links</span>}
        center={<span>mitte</span>}
        right={<span>rechts</span>}
        bottom={<span>unten</span>}
      />,
    );
    for (const slot of ["oben", "links", "mitte", "rechts", "unten"]) {
      expect(screen.getByText(slot)).toBeInTheDocument();
    }
  });
});
