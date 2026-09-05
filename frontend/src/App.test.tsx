import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import App from "./App";

// jsdom has no EventSource; the shell opens one on mount, so it gets an inert stand-in.
class FakeEventSource {
  addEventListener(): void {}
  close(): void {}
}

beforeAll(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

describe("App", () => {
  it("shows the wordmark and the idle mode chip", () => {
    render(<App />);
    expect(screen.getByText("hugin")).toBeInTheDocument();
    expect(screen.getByText("BEREIT")).toBeInTheDocument();
  });

  it("shows the designed empty states of an idle shell", () => {
    render(<App />);
    expect(screen.getByText("Noch keine Prozesse")).toBeInTheDocument();
    expect(screen.getByText("Kernel bereit — warte auf Ereignisse")).toBeInTheDocument();
    expect(screen.getByText(/Keine aktive Mission/)).toBeInTheDocument();
  });
});
