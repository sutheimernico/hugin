/**
 * One agent, up close (spec §2.9, view 3): who it is, what it has spent, what it has said and
 * the switch that stops it. Clicking a node in the graph morphs that card into this sheet —
 * both carry `layoutId="proc-<pid>"`, so the shell shows one object moving, not two panels.
 *
 * The sheet overlays the kernel-log column instead of replacing it in the tree: the log keeps
 * its scroll position and its stick-to-bottom state while an agent is being read.
 */

import { motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "../../components/Button";
import { Chip, type Tone } from "../../components/Chip";
import { Meter } from "../../components/Meter";
import { StateRing } from "../../components/StateRing";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { DRIVER_LABEL, exitReasonLabel, ROLE_LABEL, STATE_LABEL } from "../../lib/i18n";
import { CONTEXT_WINDOW, FALLBACK_ICON, PROGRAM_ICON, programAccent } from "../../lib/programs";
import { isAlive } from "../../state/selectors";
import type { Driver, Proc, TranscriptItem } from "../../state/types";
import { ToolCallCard } from "./ToolCallCard";

/** Same tones as the mode chip: the driver is named the same way wherever it is named. */
const DRIVER_TONE: Record<Driver, Tone> = { claude: "violet", ollama: "amber", scripted: "cyan" };

/** How an ending reads: finished, stopped, or broken. */
const EXIT_TONE: Record<string, string> = {
  done: "text-green",
  killed: "text-muted",
  failed: "text-red",
  driver_error: "text-red",
};

/** The house transition (spec §2.9): 280 ms on the expo curve. */
const SHEET: { duration: number; ease: [number, number, number, number] } = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
};

export type AgentWindowProps = {
  proc: Proc;
  /** Wall clock in seconds while live, the last event's timestamp during replay. */
  now: number;
  onClose: () => void;
  onKill: (pid: number) => void;
};

export function AgentWindow({ proc, now, onClose, onKill }: AgentWindowProps) {
  const Icon = PROGRAM_ICON[proc.program] ?? FALLBACK_ICON;
  const accent = programAccent(proc.program);
  const living = isAlive(proc);
  const { budget, usage } = proc;
  const elapsed = proc.startedAt === null ? 0 : (proc.exitedAt ?? now) - proc.startedAt;

  useCloseOnEscape(onClose);

  return (
    <motion.section
      data-testid="agent-window"
      aria-label={`Agent ${proc.program}, PID ${proc.pid}`}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={SHEET}
      className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-panel border border-border bg-surface"
    >
      <motion.header
        layoutId={`proc-${proc.pid}`}
        transition={SHEET}
        className="flex shrink-0 items-start gap-3 border-b border-border px-3 py-2.5"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-md"
          style={{ background: `${accent}1F`, color: accent }}
        >
          <Icon size={16} strokeWidth={1.75} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-mono text-[13px] text-text">{proc.program}</span>
            {/* `ROLE_LABEL` is keyed by program name; the kernel's own `role` is English prose
                and only stands in for a program the shell does not know. */}
            <span className="truncate text-[11px] text-muted">
              {ROLE_LABEL[proc.program] ?? proc.role}
            </span>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted tabular-nums">PID {proc.pid}</span>
            <span className="flex items-center gap-1 text-[11px] text-muted">
              <StateRing state={proc.state} size={10} />
              {STATE_LABEL[proc.state]}
            </span>
            <Chip tone="muted" className="max-w-40 truncate font-mono">
              {proc.model}
            </Chip>
            <Chip tone={DRIVER_TONE[proc.driver]}>{DRIVER_LABEL[proc.driver]}</Chip>
          </span>
        </span>

        <button
          type="button"
          aria-label="Agentfenster schließen"
          title="Schließen (Esc)"
          onClick={onClose}
          className="shrink-0 rounded px-1 leading-none text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text"
        >
          ✕
        </button>
      </motion.header>

      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <p className="mb-2 truncate text-[11px] text-muted" title={proc.task}>
          {proc.task}
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Meter
            label="Runden"
            value={usage.turns}
            max={budget.max_turns}
            tone="violet"
            format={(value) => `${value}/${budget.max_turns}`}
          />
          <Meter
            label="Tokens"
            value={usage.output_tokens}
            max={budget.max_output_tokens}
            tone="cyan"
            format={(value) => `${fmtTokens(value)}/${fmtTokens(budget.max_output_tokens)}`}
          />
          <Meter
            label="Zeit"
            value={elapsed}
            max={budget.max_seconds}
            tone="violet"
            format={(value) => `${fmtDuration(value)}/${fmtDuration(budget.max_seconds)}`}
          />
          {/* Context is the model's window, not a budget: how much this agent has read. */}
          <Meter
            label="Kontext"
            value={usage.input_tokens}
            max={CONTEXT_WINDOW}
            tone="cyan"
            format={(value) => `${Math.round((value / CONTEXT_WINDOW) * 100)} %`}
          />
        </div>
      </div>

      <Transcript proc={proc} />

      <div className="flex shrink-0 items-end justify-between gap-3 border-t border-border px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {proc.exitReason !== null && (
            <p className={`text-[12px] ${EXIT_TONE[proc.exitReason] ?? "text-amber"}`}>
              {exitReasonLabel(proc.exitReason)}
            </p>
          )}
          {proc.stderrTail !== null && (
            <pre
              data-testid="stderr-tail"
              className="max-h-20 overflow-auto rounded border border-border/60 bg-base/60 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted"
            >
              {lastLines(proc.stderrTail, 4)}
            </pre>
          )}
        </div>
        <Button variant="danger" size="sm" disabled={!living} onClick={() => onKill(proc.pid)}>
          Prozess beenden
        </Button>
      </div>
    </motion.section>
  );
}

/**
 * The transcript, virtualised and pinned to its end — the same stick-to-bottom construction as
 * the kernel log (see `features/log/KernelLog.tsx` for why `followOutput` is not used here).
 *
 * `thinking` items are folded out of the list and replaced by a single shimmer row at the end:
 * the reducer records every toggle, but a finished thought is not something to keep reading.
 */
function Transcript({ proc }: { proc: Proc }) {
  const handle = useRef<VirtuosoHandle>(null);
  const [stick, setStick] = useState(true);

  const rows = useMemo(() => {
    const said = proc.transcript.filter((item) => item.t !== "thinking");
    return proc.thinking ? [...said, { t: "thinking", on: true } as TranscriptItem] : said;
  }, [proc.transcript, proc.thinking]);

  // The cursor belongs on the sentence still being written, which is the last prose row.
  const cursorAt = useMemo(() => {
    if (proc.state !== "running") return -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].t === "text") return index;
    }
    return -1;
  }, [rows, proc.state]);

  useEffect(() => {
    if (!stick) return;
    handle.current?.scrollToIndex({ index: "LAST", align: "end" });
  }, [rows.length, stick]);

  if (rows.length === 0) {
    return (
      <p className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[12px] text-muted">
        Noch keine Ausgabe
      </p>
    );
  }

  return (
    <div
      className="min-h-0 flex-1"
      onWheel={(event) => {
        if (event.deltaY < 0) setStick(false);
      }}
    >
      <Virtuoso
        ref={handle}
        data={rows}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        atBottomThreshold={24}
        atBottomStateChange={(atBottom) => {
          if (atBottom) setStick(true);
        }}
        itemContent={(index, item) => <Row item={item} cursor={index === cursorAt} />}
        style={{ height: "100%" }}
      />
    </div>
  );
}

/** Memoised: a streaming run re-renders the list on every frame, but only its last row changes. */
const Row = memo(function Row({ item, cursor }: { item: TranscriptItem; cursor: boolean }) {
  if (item.t === "tool") return <ToolCallCard call={item} />;
  if (item.t === "thinking") return <ThinkingLine />;
  return (
    <p className="px-3 py-1 text-[13px] leading-5 whitespace-pre-wrap text-text">
      {item.text}
      {cursor && (
        <motion.span
          data-testid="transcript-cursor"
          aria-hidden
          className="ml-px inline-block text-violet"
          animate={{ opacity: [1, 1, 0, 0] }}
          transition={{ duration: 1, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: "linear" }}
        >
          ▍
        </motion.span>
      )}
    </p>
  );
});

function ThinkingLine() {
  return (
    <motion.p
      className="px-3 py-1 text-[12px] text-muted italic"
      animate={{ opacity: [0.45, 1, 0.45] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
    >
      denkt…
    </motion.p>
  );
}

/** Esc closes the sheet — unless the keystroke belongs to something the user is typing in. */
function useCloseOnEscape(onClose: () => void): void {
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTyping(event.target)) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
}

/** The command palette owns Esc while its input has the focus; this is that hand-off. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function lastLines(text: string, count: number): string {
  return text.split("\n").slice(-count).join("\n");
}
