import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Panel } from "../../components/Panel";
import { fmtDuration } from "../../lib/format";
import type { LogLine } from "../../state/types";
import { describeKind } from "./describe";
import { timetableRows, type TimetableRow } from "./timetable";

const TONE_TEXT = {
  blue: "text-blue",
  teal: "text-teal",
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  plum: "text-plum",
  muted: "text-muted",
} as const;

type TimetableProps = {
  lines: LogLine[];
  /** When the mission began; times are counted from there. `null` before any mission. */
  origin: number | null;
};

/**
 * The event stream as a timetable: when, on which rail (process), what kind, and one German
 * sentence. It replaces a log of text lines; the vertical hairline is the process lane.
 */
export function Timetable({ lines, origin }: TimetableProps) {
  const rows = useMemo(() => timetableRows(lines, origin), [lines, origin]);
  return (
    <Panel
      title="Fahrplan"
      right={
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {rows.length === 0 ? "" : `${rows.length} Ereignisse`}
        </span>
      }
      className="h-full"
      bodyClassName="min-h-0 p-0"
    >
      {rows.length === 0 ? (
        <p className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted">
          Kernel bereit — warte auf Ereignisse
        </p>
      ) : (
        <LogList rows={rows} />
      )}
    </Panel>
  );
}

/**
 * Its own component so its state starts when the list appears, not when the empty panel does.
 *
 * Sticking to the bottom is done here rather than through Virtuoso's `followOutput`, and that is
 * a measured decision: the SSE backfill arrives in a burst of frame-sized batches, so the list
 * appears with a few hundred lines and keeps growing before its first scroll has settled.
 * `followOutput` only follows a list that is *already* at its end, so it never engaged and the
 * ticker stayed frozen on the oldest lines. Pinning the last line ourselves has no such race.
 */
function LogList({ rows }: { rows: TimetableRow[] }) {
  const handle = useRef<VirtuosoHandle>(null);
  // The user's intent, not the scroll position: scrolling up means "let me read", coming back
  // to the end means "follow again". Appended lines never change it.
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (!stick) return;
    handle.current?.scrollToIndex({ index: "LAST", align: "end" });
  }, [rows.length, stick]);

  return (
    <div
      className="h-full"
      onWheel={(event) => {
        if (event.deltaY < 0) setStick(false);
      }}
    >
      <Virtuoso
        ref={handle}
        data={rows}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        // A log line is 20 px high; a few pixels of rounding must still count as "at the end".
        atBottomThreshold={24}
        atBottomStateChange={(atBottom) => {
          if (atBottom) setStick(true);
        }}
        computeItemKey={(_, row) => row.line.seq}
        itemContent={(_, row) => <LogRow row={row} />}
        style={{ height: "100%" }}
      />
    </div>
  );
}

/**
 * Memoised: the ticker grows by hundreds of lines a second under the stress script, and a
 * row never changes after the reducer appended its line.
 */
const LogRow = memo(function LogRow({ row }: { row: TimetableRow }) {
  const { line } = row;
  const { icon: Icon, tone } = describeKind(line.kind);
  return (
    <div
      data-testid="log-line"
      data-kind={line.kind}
      className="grid grid-cols-[3rem_2.5rem_1.25rem_minmax(0,1fr)] items-start gap-x-1.5 px-4 text-[13px] leading-5"
    >
      <span className="py-1 font-mono text-[11px] text-muted tabular-nums">
        {fmtDuration(row.at)}
      </span>
      {/* The rail: one hairline runs through every row, the pid sits on it. */}
      <span className="relative flex justify-center self-stretch">
        <span aria-hidden className="absolute inset-y-0 w-px bg-border" />
        <span className="relative my-0.5 self-start bg-surface px-1 font-display text-[13px] font-semibold text-text tabular-nums">
          {line.pid === null ? "" : line.pid}
        </span>
      </span>
      <Icon size={15} aria-hidden className={`mt-[3px] ${TONE_TEXT[tone]}`} />
      <span className={`min-w-0 py-1 break-words hyphens-none ${tone === "muted" ? "text-muted" : "text-text"}`}>{line.text}</span>
    </div>
  );
});
