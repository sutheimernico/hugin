/**
 * One tool or syscall in an agent's transcript: a single line until it is asked to explain
 * itself. Collapsed is the default because a transcript is read for its prose — the calls are
 * the footnotes, and a wall of JSON would bury the sentence that caused it.
 */

import { motion } from "motion/react";
import { memo, useState } from "react";
import { toolLabel } from "../../lib/describe";
import type { TranscriptItem } from "../../state/types";

export type ToolItem = Extract<TranscriptItem, { t: "tool" }>;

export const ToolCallCard = memo(function ToolCallCard({ call }: { call: ToolItem }) {
  const [open, setOpen] = useState(false);
  // No result event yet — the call is still out there. `ok` is the field the result fills in.
  const pending = call.ok === undefined;

  return (
    <div className="px-4 py-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="ease-out-expo flex w-full items-center gap-2 rounded-part border border-border bg-surface-2 px-2.5 py-1.5 text-left text-[13px] leading-4 transition-colors duration-150 hover:border-text/40"
      >
        {/* Syscalls are the kernel's own surface (teal); a program's tools stay muted. */}
        <span className={call.sys ? "shrink-0 text-teal" : "shrink-0 text-muted"}>
          {call.sys ? "System" : "Werkzeug"}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-text" title={call.tool}>
          {toolLabel(call.tool)}
        </span>
        {pending ? (
          <motion.span
            data-testid="tool-pending"
            aria-label="läuft"
            className="size-1.5 shrink-0 rounded-full bg-teal"
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <>
            <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{call.ms ?? 0} ms</span>
            <span className={call.ok ? "shrink-0 text-green" : "shrink-0 text-red"}>
              {call.ok ? "✓" : "✗"}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="mt-1 flex flex-col gap-2 rounded-part border border-border bg-base/60 p-2">
          <Field label="Eingabe" value={call.input} />
          <Field label="Ausgabe" value={call.output} />
        </div>
      )}
    </div>
  );
});

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {value === undefined ? (
        <span className="text-[11px] text-muted/70 italic">Noch kein Ergebnis</span>
      ) : (
        <pre className="max-h-40 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap text-text">
          {value}
        </pre>
      )}
    </div>
  );
}
