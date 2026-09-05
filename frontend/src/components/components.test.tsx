import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fmtTokens } from "../lib/format";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Kbd } from "./Kbd";
import { Meter } from "./Meter";
import { Panel } from "./Panel";
import { StateRing, type AgentStateName } from "./StateRing";

describe("Panel", () => {
  it("renders title, right slot and children", () => {
    render(
      <Panel title="Prozesse" right={<span>3 aktiv</span>}>
        <p>Inhalt</p>
      </Panel>,
    );
    expect(screen.getByText("Prozesse")).toBeInTheDocument();
    expect(screen.getByText("3 aktiv")).toBeInTheDocument();
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
  });

  it("omits the header row when neither title nor right slot is given", () => {
    const { container } = render(<Panel>Inhalt</Panel>);
    expect(container.querySelector("header")).toBeNull();
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
  });
});

describe("Chip", () => {
  it("renders its children", () => {
    render(<Chip tone="cyan">Werkzeug</Chip>);
    expect(screen.getByText("Werkzeug")).toBeInTheDocument();
  });

  it("marks only a pulsing chip as live so the glow stays on live elements", () => {
    render(
      <Chip tone="violet" pulse>
        Läuft
      </Chip>,
    );
    render(<Chip tone="muted">Wartet</Chip>);
    expect(screen.getByText("Läuft")).toHaveAttribute("data-pulse", "true");
    expect(screen.getByText("Wartet")).not.toHaveAttribute("data-pulse");
  });
});

describe("Meter", () => {
  it("shows the label, the formatted value and the progress", () => {
    render(<Meter label="Tokens" value={1234} max={10_000} tone="cyan" format={fmtTokens} />);
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("1,2k")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Tokens" });
    expect(bar).toHaveAttribute("aria-valuenow", "1234");
    expect(bar).toHaveAttribute("aria-valuemax", "10000");
    expect(bar.firstElementChild).toHaveStyle({ width: "12.34%" });
  });

  it("falls back to the plain number without a formatter", () => {
    render(<Meter label="Prozesse" value={3} max={8} tone="violet" />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("clamps the bar between empty and full", () => {
    render(<Meter label="Budget" value={150} max={100} tone="red" />);
    render(<Meter label="Leer" value={5} max={0} tone="muted" />);
    expect(screen.getByRole("progressbar", { name: "Budget" }).firstElementChild).toHaveStyle({
      width: "100%",
    });
    expect(screen.getByRole("progressbar", { name: "Leer" }).firstElementChild).toHaveStyle({
      width: "0%",
    });
  });
});

describe("Button", () => {
  it("renders its children and reports clicks", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Mission starten
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Mission starten" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="danger" size="sm" disabled onClick={onClick}>
        Alle beenden
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Alle beenden" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Kbd", () => {
  it("renders the key inside a kbd element", () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
  });
});

describe("StateRing", () => {
  const states: AgentStateName[] = [
    "queued",
    "spawning",
    "running",
    "waiting_tool",
    "done",
    "failed",
    "killed",
  ];

  it.each(states)("exposes %s as data-state with a German label", (state) => {
    render(<StateRing state={state} size={10} />);
    const ring = screen.getByRole("img");
    expect(ring).toHaveAttribute("data-state", state);
    expect(ring).toHaveAccessibleName();
  });

  it("takes its size from the size prop", () => {
    render(<StateRing state="running" size={16} />);
    expect(screen.getByRole("img")).toHaveStyle({ width: "16px", height: "16px" });
  });
});
