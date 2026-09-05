import { describe, expect, it, vi } from "vitest";
import type { Run, SystemStatus } from "../../state/types";
import { buildCommands, driverReason, freeTextCommand, type CommandContext } from "./commands";

const TEMPLATES = [
  { id: "research_brief", title: "Recherche-Briefing", goal: "Erstelle ein Recherche-Briefing zu: {Thema}" },
  { id: "compare_options", title: "Optionen vergleichen", goal: "Vergleiche {A} und {B}" },
];

function makeRun(id: string, createdAt: number): Run {
  return {
    id,
    goal: `Ziel ${id}`,
    driver: "scripted",
    state: "done",
    createdAt,
    doneAt: createdAt + 10,
    artifacts: [],
    usage: { turns: 1, input_tokens: 0, output_tokens: 0, cost_usd_equiv: null },
  };
}

function makeSystem(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    claude: { ok: true, version: "2.1.261", detail: "Abo-Login" },
    ollama: { ok: true, models: ["qwen2.5"], detail: "" },
    munin: { count: 3 },
    programs: ["planner"],
    kernel: { uptime_s: 12, procs: 0, version: "0.1.0" },
    ...over,
  };
}

function makeActions() {
  return {
    startMission: vi.fn(async () => {}),
    killAll: vi.fn(async () => {}),
    openRun: vi.fn(),
    openMunin: vi.fn(),
  };
}

function makeCtx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    templates: TEMPLATES,
    runs: [],
    system: null,
    driver: "scripted",
    actions: makeActions(),
    ...over,
  };
}

describe("buildCommands", () => {
  it("offers one mission command per template, labelled with its title", () => {
    const commands = buildCommands(makeCtx());
    const missions = commands.filter((command) => command.group === "Mission");
    expect(missions.map((command) => command.label)).toEqual([
      "Mission starten: Recherche-Briefing",
      "Mission starten: Optionen vergleichen",
    ]);
  });

  it("starts a template's goal with the chosen driver", async () => {
    const actions = makeActions();
    const commands = buildCommands(makeCtx({ actions, driver: "ollama", system: null }));
    await commands[0].run();
    expect(actions.startMission).toHaveBeenCalledWith(TEMPLATES[0].goal, "ollama");
  });

  it("offers the kill-all command and runs it", async () => {
    const actions = makeActions();
    const commands = buildCommands(makeCtx({ actions }));
    const killAll = commands.find((command) => command.label === "Alle Prozesse beenden");
    expect(killAll?.group).toBe("Prozesse");
    await killAll?.run();
    expect(actions.killAll).toHaveBeenCalledTimes(1);
  });

  it("offers the boot replay command", () => {
    const labels = buildCommands(makeCtx()).map((command) => command.label);
    expect(labels).toContain("Boot erneut abspielen");
  });

  it("lists the eight newest runs, newest first", () => {
    const runs = Array.from({ length: 10 }, (_, index) => makeRun(`r${index}`, index));
    const commands = buildCommands(makeCtx({ runs }));
    const runCommands = commands.filter((command) => command.group === "Runs");
    expect(runCommands).toHaveLength(8);
    expect(runCommands[0].label).toBe("Run öffnen: Ziel r9");
    expect(runCommands.at(-1)?.label).toBe("Run öffnen: Ziel r2");
  });

  it("opens a run by id", () => {
    const actions = makeActions();
    const commands = buildCommands(makeCtx({ runs: [makeRun("r1", 1)], actions }));
    commands.find((command) => command.group === "Runs")?.run();
    expect(actions.openRun).toHaveBeenCalledWith("r1");
  });

  it("offers the munin search command", () => {
    const actions = makeActions();
    const commands = buildCommands(makeCtx({ actions }));
    const munin = commands.find((command) => command.group === "Munin");
    expect(munin?.label).toBe("Munin durchsuchen…");
    munin?.run();
    expect(actions.openMunin).toHaveBeenCalledWith("");
  });

  it("enables every driver while no system status is known", () => {
    for (const driver of ["scripted", "claude", "ollama"] as const) {
      const commands = buildCommands(makeCtx({ driver, system: null }));
      expect(commands.filter((command) => command.disabled !== undefined)).toEqual([]);
    }
  });

  it("disables mission commands with a German reason when claude is not logged in", () => {
    const system = makeSystem({ claude: { ok: false, version: null, detail: "kein Login" } });
    const commands = buildCommands(makeCtx({ driver: "claude", system }));
    const missions = commands.filter((command) => command.group === "Mission");
    expect(missions).not.toHaveLength(0);
    for (const mission of missions) expect(mission.disabled).toBe("Claude nicht angemeldet");
    // Only the mission commands depend on the driver — killing processes never does.
    expect(commands.find((command) => command.label === "Alle Prozesse beenden")?.disabled).toBeUndefined();
  });

  it("disables mission commands with a German reason when ollama is unreachable", () => {
    const system = makeSystem({ ollama: { ok: false, models: [], detail: "connection refused" } });
    const commands = buildCommands(makeCtx({ driver: "ollama", system }));
    for (const mission of commands.filter((command) => command.group === "Mission")) {
      expect(mission.disabled).toBe("Ollama nicht erreichbar");
    }
  });
});

describe("driverReason", () => {
  it("never blocks the simulation driver — it is the kernel itself", () => {
    const system = makeSystem({ claude: { ok: false, version: null, detail: "" } });
    expect(driverReason(system, "scripted")).toBeUndefined();
    expect(driverReason(system, "claude")).toBe("Claude nicht angemeldet");
    expect(driverReason(null, "claude")).toBeUndefined();
  });
});

describe("freeTextCommand", () => {
  it("quotes the typed goal and starts it", async () => {
    const actions = makeActions();
    const command = freeTextCommand("  Finde drei Optionen  ", {
      system: null,
      driver: "scripted",
      actions,
    });
    expect(command?.label).toBe("Mission starten: »Finde drei Optionen«");
    expect(command?.group).toBe("Mission");
    await command?.run();
    expect(actions.startMission).toHaveBeenCalledWith("Finde drei Optionen", "scripted");
  });

  it("has no command for blank text and carries the driver reason", () => {
    const actions = makeActions();
    expect(freeTextCommand("   ", { system: null, driver: "scripted", actions })).toBeNull();
    const system = makeSystem({ ollama: { ok: false, models: [], detail: "" } });
    expect(freeTextCommand("Ziel", { system, driver: "ollama", actions })?.disabled).toBe(
      "Ollama nicht erreichbar",
    );
  });
});
