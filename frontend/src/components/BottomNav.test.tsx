import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

describe("BottomNav", () => {
  it("offers the three panes and the overflow, and marks the active one", () => {
    render(<BottomNav active="log" onPane={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Verlauf" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Mission" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Prozesse" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mehr" })).toBeInTheDocument();
  });

  it("switches panes and opens the overflow", async () => {
    const onPane = vi.fn();
    const onMore = vi.fn();
    render(<BottomNav active="mission" onPane={onPane} onMore={onMore} />);
    await userEvent.click(screen.getByRole("button", { name: "Prozesse" }));
    expect(onPane).toHaveBeenCalledWith("procs");
    await userEvent.click(screen.getByRole("button", { name: "Mehr" }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});
