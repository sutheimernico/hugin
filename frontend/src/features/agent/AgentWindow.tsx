/**
 * One agent, up close: who it is, what it has spent, what it has said and
 * the switch that stops it. The card in the diagram stays where it is, outlined as selected,
 * so the track plan never has a hole in it while an agent is being read.
 *
 * The sheet overlays the kernel-log column instead of replacing it in the tree: the log keeps
 * its scroll position and its stick-to-bottom state while an agent is being read.
 */

import { modelLabel } from "../../lib/describe";
import { ESC_PRIORITY, useEscapeLayer } from "../../lib/escape";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "../../components/Button";
import { Chip, type Tone } from "../../components/Chip";
import { Meter } from "../../components/Meter";
import { StateRing } from "../../components/StateRing";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { fmtDuration, fmtTokens } from "../../lib/format";
import { DRIVER_LABEL, exitReasonLabel, ROLE_LABEL, STATE_LABEL } from "../../lib/i18n";
import { CONTEXT_WINDOW, FALLBACK_ICON, PROGRAM_ICON, programAccent } from "../../lib/programs";
import { isAlive } from "../../state/selectors";
import type { Driver, Proc, TranscriptItem } from "../../state/types";
import { ToolCallCard } from "./ToolCallCard";

/** Same tones as the mode chip: the driver is named the same way wherever it is named. */
const DRIVER_TONE: Record<Driver, Tone> = { claude: "blue", ollama: "amber", scripted: "teal" };

/** How an ending reads: finished, stopped, or broken. */
const EXIT_TONE: Record<string, string> = {
  done: "text-green",
  killed: "text-muted",
  failed: "text-red",
  driver_error: "text-red",
};

/** The house transition: 280 ms on the expo curve. */
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
  // The sheet rises on a phone and slides in from the right everywhere else.
  const enter = useBreakpoint() === "mobile" ? { y: 32 } : { x: 16 };

  return (
    <motion.section
      data-testid="agent-window"
      aria-label={`Agent ${proc.program}, PID ${proc.pid}`}
      initial={{ opacity: 0, ...enter }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, ...enter }}
      transition={SHEET}
      // Phone: a full-height sheet under the top bar. Tablet: a drawer on the right. Desktop:
      // it fills the timetable column it overlays. The one shadow in the shell is this drawer's.
      className="fixed inset-x-0 top-14 bottom-0 z-50 flex flex-col overflow-hidden border-l border-text/25 bg-surface min-[720px]:left-auto min-[720px]:w-[440px] min-[720px]:shadow-[-14px_0_28px_-18px_rgba(27,33,38,0.5)] min-[1200px]:absolute min-[1200px]:inset-0 min-[1200px]:z-10 min-[1200px]:w-auto min-[1200px]:shadow-none"
    >
      <motion.header
        className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-text">
          <StateRing state={proc.state} size={16} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <Icon size={18} strokeWidth={2} style={{ color: accent }} className="shrink-0 self-center" />
            {/* `ROLE_LABEL` is keyed by program name; the kernel's own `role` is English prose
                and only stands in for a program the shell does not know. */}
            <span className="font-display truncate text-[24px] leading-7 font-semibold text-text">
              {ROLE_LABEL[proc.program] ?? proc.role}
            </span>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px] text-muted tabular-nums">
              {proc.program} · PID {proc.pid}
            </span>
            <span className="text-[13px] font-medium text-text">{STATE_LABEL[proc.state]}</span>
            <Chip tone="muted" className="max-w-40 truncate" title={proc.model}>
              {modelLabel(proc.model)}
            </Chip>
            <Chip tone={DRIVER_TONE[proc.driver]}>{DRIVER_LABEL[proc.driver]}</Chip>
          </span>
        </span>

        <button
          type="button"
          aria-label="Agentfenster schließen"
          title="Schließen (Esc)"
          onClick={onClose}
          className="shrink-0 rounded p-1.5 leading-none text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text"
        >
          <X size={20} aria-hidden />
        </button>
      </motion.header>

      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="mb-3 line-clamp-2 text-[13px] leading-snug text-muted" title={proc.task}>
          {proc.task}
        </p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Meter
            label="Runden"
            value={usage.turns}
            max={budget.max_turns}
            tone="blue"
            // The CLI counts its own turns and may end a run slightly past the cap.
            format={(value) =>
              value > budget.max_turns
                ? `${value} (Limit ${budget.max_turns})`
                : `${value}/${budget.max_turns}`
            }
          />
          <Meter
            label="Tokens"
            value={usage.output_tokens}
            max={budget.max_output_tokens}
            tone="teal"
            format={(value) => `${fmtTokens(value)}/${fmtTokens(budget.max_output_tokens)}`}
          />
          <Meter
            label="Zeit"
            value={elapsed}
            max={budget.max_seconds}
            tone="blue"
            format={(value) => `${fmtDuration(value)}/${fmtDuration(budget.max_seconds)}`}
          />
          {/* Context is the model's window, not a budget: how much this agent has read. */}
          <Meter
            label="Kontext"
            value={usage.input_tokens}
            max={CONTEXT_WINDOW}
            tone="teal"
            format={(value) => `${Math.min(100, Math.round((value / CONTEXT_WINDOW) * 100))} %`}
          />
        </div>
      </div>

      <Transcript proc={proc} />

      <div className="flex shrink-0 items-end justify-between gap-3 border-t border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {proc.exitReason !== null && (
            <p className={`text-[12px] ${EXIT_TONE[proc.exitReason] ?? "text-amber"}`}>
              {exitReasonLabel(proc.exitReason)}
            </p>
          )}
          {proc.stderrTail !== null && (
            <pre
              data-testid="stderr-tail"
              className="max-h-20 overflow-auto rounded-part border border-border bg-base/60 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted"
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
      <p className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[13px] text-muted">
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
    <p className="px-4 py-1.5 text-[14px] leading-[1.55] whitespace-pre-wrap text-text">
      {item.text}
      {cursor && (
        <motion.span
          data-testid="transcript-cursor"
          aria-hidden
          className="ml-px inline-block text-blue"
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
      className="px-4 py-1 text-[13px] text-muted italic"
      animate={{ opacity: [0.45, 1, 0.45] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
    >
      denkt…
    </motion.p>
  );
}

/** Esc closes the sheet — unless the keystroke belongs to something the user is typing in. */
function useCloseOnEscape(onClose: () => void): void {
  useEscapeLayer(true, ESC_PRIORITY.agentWindow, (event) => {
    if (isTyping(event.target)) return false;
    onClose();
  });
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
