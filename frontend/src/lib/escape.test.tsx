import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ESC_PRIORITY, useEscapeLayer } from "./escape";

function Layer({ priority, onEsc, active = true }: { priority: number; onEsc: () => boolean | void; active?: boolean }) {
  useEscapeLayer(active, priority, onEsc);
  return null;
}

describe("Esc stack", () => {
  it("lets only the topmost layer handle one Esc", async () => {
    const replay = vi.fn();
    const agent = vi.fn();
    render(
      <>
        <Layer priority={ESC_PRIORITY.replay} onEsc={replay} />
        <Layer priority={ESC_PRIORITY.agentWindow} onEsc={agent} />
      </>,
    );

    await userEvent.keyboard("{Escape}");
    expect(agent).toHaveBeenCalledTimes(1);
    expect(replay).not.toHaveBeenCalled();
  });

  it("falls back to the layer below once the top one is gone", async () => {
    const replay = vi.fn();
    const agent = vi.fn();
    const view = render(
      <>
        <Layer priority={ESC_PRIORITY.replay} onEsc={replay} />
        <Layer priority={ESC_PRIORITY.agentWindow} onEsc={agent} />
      </>,
    );
    view.rerender(
      <>
        <Layer priority={ESC_PRIORITY.replay} onEsc={replay} />
        <Layer priority={ESC_PRIORITY.agentWindow} onEsc={agent} active={false} />
      </>,
    );

    await userEvent.keyboard("{Escape}");
    expect(replay).toHaveBeenCalledTimes(1);
    expect(agent).not.toHaveBeenCalled();
  });

  it("does not hand a declined Esc to the layer below", async () => {
    const replay = vi.fn();
    render(
      <>
        <Layer priority={ESC_PRIORITY.replay} onEsc={replay} />
        <Layer priority={ESC_PRIORITY.agentWindow} onEsc={() => false} />
      </>,
    );

    await userEvent.keyboard("{Escape}");
    expect(replay).not.toHaveBeenCalled();
  });
});
