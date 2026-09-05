/**
 * The palette's command list — pure data, no React.
 *
 * `Command` and `buildCommands` are BINDING (plan Task 16). Everything a command needs to do
 * lives behind `actions`, so this module can be unit-tested without a store, a fetch or a DOM.
 *
 * Honesty rule (spec §5): a driver the machine cannot run is never silently swapped for another
 * one — the command stays visible and carries a German reason why it will not start.
 */

import { DRIVER_LABEL, STATE_LABEL } from "../../lib/i18n";
import type { Driver, Run, SystemStatus } from "../../state/types";

export interface Command {
  id: string;
  group: "Mission" | "Prozesse" | "Runs" | "Munin";
  label: string;
  hint?: string;
  disabled?: string;
  run: () => void | Promise<void>;
}

export interface CommandActions {
  startMission(goal: string, driver: Driver): Promise<void>;
  killAll(): Promise<void>;
  openRun(id: string): void;
  openMunin(q: string): void;
}

export interface CommandContext {
  templates: { id: string; title: string; goal: string }[];
  runs: Run[];
  system: SystemStatus | null;
  driver: Driver;
  actions: CommandActions;
}

/** Offered in this order — the simulation is the default because it always works. */
export const DRIVERS: readonly Driver[] = ["scripted", "claude", "ollama"];

/** Stable command ids the palette needs by name (it highlights one of them when it opens). */
export const KILL_ALL_ID = "procs:kill-all";
export const MUNIN_SEARCH_ID = "munin:search";
export const FREE_TEXT_ID = "mission:free";

export function missionCommandId(templateId: string): string {
  return `mission:${templateId}`;
}

/** Set by the boot screen (Task 26), cleared by the "Boot erneut abspielen" command. */
export const BOOTED_KEY = "hugin.booted";

/** How many past runs the palette offers before the list stops being a list. */
const RUN_LIMIT = 8;

/**
 * Why a driver cannot be used, in German, or `undefined` while it can. Until `/api/system`
 * exists (Task 21) `system` is `null` and nothing is gated — the shell does not invent a
 * verdict it has not been told. `scripted` is the kernel itself and never unavailable.
 */
export function driverReason(system: SystemStatus | null, driver: Driver): string | undefined {
  if (system === null) return undefined;
  if (driver === "claude" && !system.claude.ok) return "Claude nicht angemeldet";
  if (driver === "ollama" && !system.ollama.ok) return "Ollama nicht erreichbar";
  return undefined;
}

export function buildCommands(ctx: CommandContext): Command[] {
  const blocked = driverReason(ctx.system, ctx.driver);

  const commands: Command[] = ctx.templates.map((template) => ({
    id: missionCommandId(template.id),
    group: "Mission",
    label: `Mission starten: ${template.title}`,
    hint: template.goal,
    disabled: blocked,
    run: () => ctx.actions.startMission(template.goal, ctx.driver),
  }));

  commands.push(
    {
      id: KILL_ALL_ID,
      group: "Prozesse",
      label: "Alle Prozesse beenden",
      hint: "Panik-Schalter",
      run: () => ctx.actions.killAll(),
    },
    {
      // The shell's own startup is a process too — this is the group for machine actions.
      id: "shell:boot",
      group: "Prozesse",
      label: "Boot erneut abspielen",
      hint: "Startsequenz neu laden",
      run: replayBoot,
    },
  );

  const newest = [...ctx.runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, RUN_LIMIT);
  for (const run of newest) {
    commands.push({
      id: `run:${run.id}`,
      group: "Runs",
      label: `Run öffnen: ${run.goal}`,
      hint: `${DRIVER_LABEL[run.driver]} · ${STATE_LABEL[run.state] ?? run.state}`,
      run: () => ctx.actions.openRun(run.id),
    });
  }

  commands.push({
    id: MUNIN_SEARCH_ID,
    group: "Munin",
    label: "Munin durchsuchen…",
    hint: "Gedächtnis aller Runs",
    // The browser (Task 23) owns the query; an empty one shows the newest memories.
    run: () => ctx.actions.openMunin(""),
  });

  return commands;
}

/** What the typed text itself means: start exactly this goal. `null` while nothing is typed. */
export function freeTextCommand(
  text: string,
  ctx: Pick<CommandContext, "system" | "driver" | "actions">,
): Command | null {
  const goal = text.trim();
  if (goal === "") return null;
  return {
    id: FREE_TEXT_ID,
    group: "Mission",
    label: `Mission starten: »${goal}«`,
    hint: DRIVER_LABEL[ctx.driver],
    disabled: driverReason(ctx.system, ctx.driver),
    run: () => ctx.actions.startMission(goal, ctx.driver),
  };
}

/** Forget that this browser session has booted, then load the shell again (Task 26). */
export function replayBoot(): void {
  try {
    window.sessionStorage.removeItem(BOOTED_KEY);
  } catch {
    // A browser with storage disabled never remembered the boot in the first place.
  }
  window.location.reload();
}
