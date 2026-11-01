import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MoreSheet } from "./MoreSheet";

function renderSheet(over: Partial<Parameters<typeof MoreSheet>[0]> = {}) {
  const props = {
    open: true,
    replayOnly: false,
    onClose: vi.fn(),
    onView: vi.fn(),
    onOpenPalette: vi.fn(),
    onKillAll: vi.fn(),
    ...over,
  };
  render(<MoreSheet {...props} />);
  return props;
}

describe("MoreSheet", () => {
  it("renders nothing while closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByRole("dialog", { name: "Mehr" })).not.toBeInTheDocument();
  });

  it("opens a view and closes itself", async () => {
    const { onView, onClose } = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /Munin/ }));
    expect(onView).toHaveBeenCalledWith("munin");
    expect(onClose).toHaveBeenCalled();
  });

  it("hands over to the palette", async () => {
    const { onOpenPalette } = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /Befehle/ }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("keeps the kill switch and the palette out of the replay-only build", () => {
    renderSheet({ replayOnly: true });
    expect(screen.queryByRole("button", { name: "Panik" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Befehle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Munin/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Läufe/ })).toBeInTheDocument();
  });
});
