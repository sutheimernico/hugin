import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Proc, Run } from "../../state/types";
import { OccupancyChart } from "./OccupancyChart";

const run = { id: "r", createdAt: 100, doneAt: null } as Run;
const proc = (pid: number, state: Proc["state"], startedAt: number | null): Proc =>
  ({ pid, program: "scout", runId: "r", state, startedAt, exitedAt: null }) as Proc;

describe("OccupancyChart", () => {
  it("draws one bar per started process, coloured by its state", () => {
    render(<OccupancyChart run={run} procs={[proc(1, "running", 100), proc(2, "killed", 110)]} now={130} />);
    const bars = screen.getAllByTestId("occupancy-bar");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveClass("bg-green");
    expect(bars[1]).toHaveClass("bg-red");
  });

  it("labels rows with the German role and the pid", () => {
    render(<OccupancyChart run={run} procs={[proc(7, "running", 100)]} now={130} />);
    expect(screen.getByText(/Späher/)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("draws nothing before any process has started", () => {
    render(<OccupancyChart run={run} procs={[proc(1, "queued", null)]} now={101} />);
    expect(screen.queryByRole("region", { name: "Belegungsplan" })).not.toBeInTheDocument();
  });
});
