import { Play } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "../../components/Button";
import { Chip, type Tone } from "../../components/Chip";
import { goalText } from "../../lib/describe";
import { DRIVER_LABEL } from "../../lib/i18n";
import type { Driver } from "../../state/types";

const DRIVER_TONE: Record<string, Tone> = { claude: "blue", ollama: "amber", scripted: "teal" };

/** An unknown driver is shown as it came, never renamed into something friendlier. */
function driverLabel(driver: Driver | string): string {
  return DRIVER_LABEL[driver] ?? (driver === "" ? "unbekannt" : driver);
}

type ReplayRowProps = {
  title: string;
  driver: string;
  /** The facts under the title, already formatted. */
  meta: string[];
  extra?: ReactNode;
  busy: boolean;
  onReplay: () => void;
  testId: string;
  /** Stagger index for the entrance. */
  index?: number;
};

/** One run or recording: what it was about, which driver ran it, and the way back into it. */
export function ReplayRow({ title, driver, meta, extra, busy, onReplay, testId, index = 0 }: ReplayRowProps) {
  return (
    <div
      data-testid={testId}
      style={{ "--i": index } as CSSProperties}
      className="hugin-rise ease-out-expo group flex items-center gap-4 border-b border-border px-5 py-4 transition-colors duration-150 hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <span
          className="font-display line-clamp-2 text-[19px] leading-[1.2] font-semibold text-text"
          title={title}
        >
          {goalText(title)}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <Chip tone={DRIVER_TONE[driver] ?? "muted"}>{driverLabel(driver)}</Chip>
          {meta.map((part) => (
            <span key={part} className="tabular-nums">
              {part}
            </span>
          ))}
          {extra}
        </span>
      </div>
      <Button variant="primary" size="md" disabled={busy} onClick={onReplay} className="shrink-0">
        <Play size={14} fill="currentColor" aria-hidden />
        {busy ? "lädt…" : "Replay"}
      </Button>
    </div>
  );
}
