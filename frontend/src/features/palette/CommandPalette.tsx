/**
 * The ⌘K palette (spec §2.9, view 6) — the one place a mission is started.
 *
 * `cmdk` provides the list: filtering, ↑↓/Enter and the group headings. The dialog frame around
 * it is ours rather than `Command.Dialog`, because the overlay is a motion element (scale .98→1
 * over 150 ms) and because a portal-and-focus-trap layer would buy nothing here — the palette is
 * the only thing on screen while it is open, and Esc, the backdrop and focus restore are four
 * lines below.
 */

import { Command as Cmdk, defaultFilter } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Kbd } from "../../components/Kbd";
import type { ToastTone } from "../../components/Toast";
import { getRuns, getTemplates, killAll, postMission } from "../../lib/api";
import { DRIVER_LABEL } from "../../lib/i18n";
import { useHuginStore } from "../../state/store";
import type { Driver, Run, SystemStatus } from "../../state/types";
import {
  buildCommands,
  DRIVERS,
  driverReason,
  freeTextCommand,
  FREE_TEXT_ID,
  missionCommandId,
  MUNIN_SEARCH_ID,
  type Command,
  type CommandActions,
} from "./commands";

const GROUPS: Command["group"][] = ["Mission", "Prozesse", "Runs", "Munin"];

/** `cmdk` renders the heading itself, so its style has to reach it through the group element. */
const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:font-display [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase";

type CommandPaletteProps = {
  open: boolean;
  /** ⌘K anywhere in the shell: the palette owns its own shortcut, the shell owns the flag. */
  onOpen: () => void;
  onClose: () => void;
  onToast: (text: string, tone: ToastTone) => void;
};

export function CommandPalette({ open, onOpen, onClose, onToast }: CommandPaletteProps) {
  usePaletteHotkey(onOpen);

  const system = useHuginStore((store) => store.system);
  const setView = useHuginStore((store) => store.setView);
  const setMuninQuery = useHuginStore((store) => store.setMuninQuery);
  const setActiveRunId = useHuginStore((store) => store.setActiveRunId);

  const [search, setSearch] = useState("");
  /**
   * The highlighted command, controlled rather than left to `cmdk`. Left alone it highlights
   * whatever registered first — which was "Alle Prozesse beenden", one Enter away from killing
   * every agent. The palette says what is highlighted; `cmdk` only reports the reader's moves.
   */
  const [selected, setSelected] = useState(MUNIN_SEARCH_ID);
  const [driver, setDriver] = useState<Driver>("scripted");
  const [templates, setTemplates] = useState<{ id: string; title: string; goal: string }[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  /**
   * No command list before the kernel has answered. Without this the palette would paint the
   * static commands first and `cmdk` would highlight "Alle Prozesse beenden" — one Enter away
   * from killing every agent — until the templates arrived a frame later.
   */
  const [loaded, setLoaded] = useState(false);

  // Once per opening — the list is a snapshot of what the kernel offered when the user asked,
  // not a query that re-runs on every keystroke.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.all([getTemplates(), getRuns()])
      .then(([nextTemplates, nextRuns]) => {
        if (!live) return;
        setTemplates(nextTemplates);
        setRuns(nextRuns);
        setLoaded(true);
        setSelected(defaultSelection(nextTemplates));
      })
      .catch((error: unknown) => {
        if (!live) return;
        // The machine commands still work without the kernel's lists — show them and say why.
        setLoaded(true);
        onToast(errorText(error), "error");
      });
    return () => {
      live = false;
    };
  }, [open, onToast]);

  const fallback = defaultSelection(templates);

  // Every way out of the palette runs through here, so the next opening starts on a clean
  // search line. The driver is deliberately not reset: it is a setting, not a query.
  const close = useCallback(() => {
    setSearch("");
    setSelected(fallback);
    onClose();
  }, [fallback, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const actions: CommandActions = useMemo(
    () => ({
      async startMission(goal: string, missionDriver: Driver) {
        try {
          await postMission(goal, missionDriver);
          onToast("Mission gestartet", "info");
        } catch (error) {
          onToast(errorText(error), "error");
        }
      },
      async killAll() {
        try {
          const { killed } = await killAll();
          onToast(
            killed.length === 0 ? "Keine laufenden Prozesse" : `${killed.length} Prozesse beendet`,
            "info",
          );
        } catch (error) {
          onToast(errorText(error), "error");
        }
      },
      openRun(id: string) {
        setActiveRunId(id);
        setView("control");
      },
      openMunin(query: string) {
        setMuninQuery(query);
        setView("munin");
      },
    }),
    [onToast, setActiveRunId, setMuninQuery, setView],
  );

  const commands = useMemo(
    () => buildCommands({ templates, runs, system, driver, actions }),
    [templates, runs, system, driver, actions],
  );
  const freeText = freeTextCommand(search, { system, driver, actions });

  // An item's `value` is its id, so a controlled selection can name it; the text the search
  // runs against is its German label and hint, which is what the reader actually sees.
  const searchable = useMemo(() => {
    const text = new Map<string, string>();
    for (const command of [...commands, ...(freeText === null ? [] : [freeText])]) {
      text.set(command.id, `${command.label} ${command.hint ?? ""}`);
    }
    return text;
  }, [commands, freeText]);

  const select = useCallback(
    (command: Command) => {
      if (command.disabled !== undefined) return;
      close();
      void Promise.resolve(command.run()).catch((error: unknown) => {
        onToast(errorText(error), "error");
      });
    },
    [close, onToast],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-base/70 px-4 pt-[14vh] backdrop-blur-sm"
          onMouseDown={close}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Befehle"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            // The backdrop closes; a click inside is never a click on the backdrop.
            onMouseDown={(event) => event.stopPropagation()}
            className="w-[640px] max-w-full overflow-hidden rounded-panel border border-border bg-surface shadow-[0_40px_80px_-30px_#000]"
          >
            <Cmdk
              label="Befehle"
              loop
              value={selected}
              onValueChange={setSelected}
              filter={(value, query) => defaultFilter(searchable.get(value) ?? value, query)}
            >
              <div className="flex items-center gap-3 border-b border-border px-5">
                <Cmdk.Input
                  autoFocus
                  value={search}
                  // Typing always points at what the text itself means: start this mission.
                  onValueChange={(next) => {
                    setSearch(next);
                    setSelected(next.trim() === "" ? fallback : FREE_TEXT_ID);
                  }}
                  placeholder="Was soll hugin tun?"
                  className="h-14 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-muted"
                />
                <Kbd>Esc</Kbd>
              </div>

              <div className="flex items-center gap-3 border-b border-border px-5 py-3">
                <span className="font-display text-[11px] tracking-[0.14em] text-muted uppercase">
                  Treiber
                </span>
                <DriverPicker system={system} driver={driver} onPick={setDriver} />
              </div>

              <Cmdk.List className="max-h-[min(48vh,420px)] overflow-y-auto overscroll-contain p-2">
                <Cmdk.Empty className="px-3 py-6 text-center text-[13px] text-muted">
                  Kein Befehl gefunden.
                </Cmdk.Empty>

                {!loaded && <p className="mono px-3 py-6 text-[12px] text-muted">Lade Befehle …</p>}

                {loaded &&
                  GROUPS.map((group) => {
                    // What the reader typed *is* a mission, so it heads the Mission group
                    // rather than opening a second one with the same heading.
                    const typed = group === "Mission" && freeText !== null ? [freeText] : [];
                    const inGroup = [
                      ...typed,
                      ...commands.filter((command) => command.group === group),
                    ];
                    if (inGroup.length === 0) return null;
                    return (
                      <Cmdk.Group key={group} heading={group} className={GROUP_CLASS}>
                        {inGroup.map((command) => (
                          <CommandItem key={command.id} command={command} onSelect={select} />
                        ))}
                      </Cmdk.Group>
                    );
                  })}
              </Cmdk.List>

              <footer className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-[11px] text-muted">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>Auswählen</span>
                <Kbd>⏎</Kbd>
                <span>Ausführen</span>
              </footer>
            </Cmdk>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** ⌘K / Ctrl+K anywhere — except while the user is typing somewhere else. */
function usePaletteHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

function CommandItem({
  command,
  onSelect,
}: {
  command: Command;
  onSelect: (command: Command) => void;
}) {
  return (
    <Cmdk.Item
      value={command.id}
      disabled={command.disabled !== undefined}
      onSelect={() => onSelect(command)}
      className="ease-out-expo flex cursor-pointer items-center gap-3 rounded-panel px-3 py-2.5 transition-colors duration-150 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-45 data-[selected=true]:bg-violet/15 data-[selected=true]:text-text"
    >
      <span className="min-w-0 flex-1 truncate text-[13px] text-text">{command.label}</span>
      {command.disabled !== undefined ? (
        <span className="shrink-0 text-[11px] text-amber">{command.disabled}</span>
      ) : (
        command.hint !== undefined && (
          <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted">
            {command.hint}
          </span>
        )
      )}
    </Cmdk.Item>
  );
}

function DriverPicker({
  system,
  driver,
  onPick,
}: {
  system: SystemStatus | null;
  driver: Driver;
  onPick: (driver: Driver) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-panel border border-border bg-base p-1">
      {DRIVERS.map((option) => {
        const reason = driverReason(system, option);
        const active = option === driver;
        return (
          <button
            key={option}
            type="button"
            disabled={reason !== undefined}
            aria-pressed={active}
            title={reason ?? DRIVER_LABEL[option]}
            onClick={() => onPick(option)}
            className={`mono ease-out-expo rounded-[6px] px-2.5 py-1 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? "bg-violet/20 text-violet" : "text-muted hover:text-text"
            }`}
          >
            {DRIVER_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}

/** What a freshly opened palette points at — the first mission, never a destructive command. */
function defaultSelection(templates: { id: string }[]): string {
  const first = templates[0];
  return first === undefined ? MUNIN_SEARCH_ID : missionCommandId(first.id);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The backend's German `detail` if there is one, a plain sentence otherwise. */
function errorText(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "Die Anfrage ist fehlgeschlagen.";
}
