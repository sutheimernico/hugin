import { Chip, type Tone } from "../../components/Chip";
import { MODE_LABEL } from "../../lib/i18n";
import type { Mode } from "../../state/types";

/**
 * The honesty chip (spec §1.2): what the shell is showing is never in doubt — which driver is
 * live, or that the data is simulated or replayed. It is the only element in the top bar that
 * glows, and only while something is actually running.
 */
const MODE_TONE: Record<Mode, Tone> = {
  idle: "muted",
  claude: "violet",
  ollama: "amber",
  scripted: "cyan",
  replay: "rose",
};

export function ModeChip({ mode }: { mode: Mode }) {
  return (
    <Chip tone={MODE_TONE[mode]} pulse={mode !== "idle"} className="font-mono tracking-[0.14em]">
      {MODE_LABEL[mode]}
    </Chip>
  );
}
