import { useCallback, useState } from "react";
import { errorText } from "../../hooks/useLoaded";
import { getRecordingEvents, getRunEvents } from "../../lib/api";
import { useHuginStore } from "../../state/store";
import type { HEvent } from "../../state/types";

type Source = { runId?: string; slug?: string };

/**
 * Loads a run's or a recording's events once and hands them to the store — from there on the
 * shell is a projection of a cursor instead of a stream. Shared by the runs list and the idle
 * stage, which both offer the same "Replay" button.
 */
export function useReplayLauncher() {
  const enterReplay = useHuginStore((store) => store.enterReplay);
  const setView = useHuginStore((store) => store.setView);
  const play = useHuginStore((store) => store.play);
  const setSpeed = useHuginStore((store) => store.setSpeed);

  // Which row is fetching its events, and what went wrong if it did not arrive.
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const start = useCallback(
    async (source: Source, load: () => Promise<HEvent[]>, autoplay = false) => {
      setBusy(source.runId ?? source.slug ?? "");
      setProblem(null);
      try {
        enterReplay(source, await load());
        setView("control");
        if (autoplay) {
          // A four-minute run at 1x is a long wait for a first impression.
          setSpeed(4);
          play();
        }
      } catch (reason) {
        setProblem(errorText(reason));
      } finally {
        setBusy(null);
      }
    },
    [enterReplay, setView, play, setSpeed],
  );

  const startRun = useCallback(
    (runId: string) => start({ runId }, () => getRunEvents(runId, 0)),
    [start],
  );
  const startRecording = useCallback(
    (slug: string, autoplay = false) =>
      start({ slug }, () => getRecordingEvents(slug), autoplay),
    [start],
  );

  return { busy, problem, startRun, startRecording };
}
