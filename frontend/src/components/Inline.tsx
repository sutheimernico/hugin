import type { ReactNode } from "react";

/** `code` and **bold**: the only two markdown marks agents use in a running sentence. */
const MARKS = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;

/**
 * Renders agent prose with its inline marks instead of the raw characters. Anything else —
 * headings, lists, links — stays as typed: a transcript is not a document renderer.
 */
export function Inline({ text }: { text: string }): ReactNode {
  return text.split(MARKS).map((part, index) => {
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded-part bg-surface-2 px-1 py-px font-mono text-[0.88em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
