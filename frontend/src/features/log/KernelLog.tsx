import { memo, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Panel } from "../../components/Panel";
import type { LogLine } from "../../state/types";

/**
 * Colour by event family, longest prefix first. The families carry the meaning: agents are
 * violet, everything the agents call is cyan, memory is green, budgets warn and a kill is red.
 * Everything the kernel does around them stays muted so the ticker has a foreground at all.
 */
const KIND_COLOR: [string, string][] = [
  ["proc.", "text-violet"],
  ["tool.", "text-cyan"],
  ["sys.", "text-cyan"],
  ["munin.", "text-green"],
  ["budget.", "text-amber"],
  ["kill", "text-red"],
  ["run.", "text-text"],
];

export function KernelLog({ lines }: { lines: LogLine[] }) {
  return (
    <Panel
      title="Kernel-Log"
      right={
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {lines.length === 0 ? "" : lines.length}
        </span>
      }
      className="h-full"
      bodyClassName="min-h-0 p-0"
    >
      {lines.length === 0 ? (
        <p className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted">
          Kernel bereit — warte auf Ereignisse
        </p>
      ) : (
        <LogList lines={lines} />
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
function LogList({ lines }: { lines: LogLine[] }) {
  const handle = useRef<VirtuosoHandle>(null);
  // The user's intent, not the scroll position: scrolling up means "let me read", coming back
  // to the end means "follow again". Appended lines never change it.
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (!stick) return;
    handle.current?.scrollToIndex({ index: "LAST", align: "end" });
  }, [lines.length, stick]);

  return (
    <div
      className="h-full"
      onWheel={(event) => {
        if (event.deltaY < 0) setStick(false);
      }}
    >
      <Virtuoso
        ref={handle}
        data={lines}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        // A log line is 20 px high; a few pixels of rounding must still count as "at the end".
        atBottomThreshold={24}
        atBottomStateChange={(atBottom) => {
          if (atBottom) setStick(true);
        }}
        computeItemKey={(_, line) => line.seq}
        itemContent={(_, line) => <LogRow line={line} />}
        style={{ height: "100%" }}
      />
    </div>
  );
}

/**
 * Memoised: the ticker grows by hundreds of lines a second under the stress script, and a
 * `LogLine` never changes after the reducer appended it — so every already-rendered row can
 * be skipped instead of re-rendered on each batch.
 */
const LogRow = memo(function LogRow({ line }: { line: LogLine }) {
  return (
    <div
      data-testid="log-line"
      data-kind={line.kind}
      className={`flex gap-2 px-3 py-px font-mono text-[12px] leading-5 ${colorOf(line.kind)}`}
    >
      <span className="shrink-0 text-muted/60 tabular-nums">{clock(line.ts)}</span>
      <span className="w-7 shrink-0 text-right text-muted/60 tabular-nums">
        {line.pid === null ? "" : `[${line.pid}]`}
      </span>
      <span className="min-w-0 break-words">{line.text}</span>
    </div>
  );
});

function colorOf(kind: string): string {
  for (const [prefix, color] of KIND_COLOR) {
    if (kind.startsWith(prefix)) return color;
  }
  return "text-muted";
}

/** `HH:MM:SS` in the viewer's own time zone — built by hand so it never depends on a locale. */
function clock(ts: number): string {
  const d = new Date(ts * 1_000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
