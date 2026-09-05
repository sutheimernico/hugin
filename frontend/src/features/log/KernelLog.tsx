import { Virtuoso } from "react-virtuoso";
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
        <Virtuoso
          data={lines}
          // Smooth follow keeps the newest line in view without ripping the scroll position
          // away from someone who scrolled up (Virtuoso stops following once you leave the end).
          followOutput="smooth"
          computeItemKey={(_, line) => line.seq}
          itemContent={(_, line) => <LogRow line={line} />}
          style={{ height: "100%" }}
        />
      )}
    </Panel>
  );
}

function LogRow({ line }: { line: LogLine }) {
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
}

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
