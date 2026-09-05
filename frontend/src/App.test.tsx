import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("shows the wordmark and the idle mode chip", () => {
    render(<App />);
    expect(screen.getByText("hugin")).toBeInTheDocument();
    expect(screen.getByText("BEREIT")).toBeInTheDocument();
  });
});
