import { useEffect, useRef } from "react";
import { getRecordings } from "../../lib/api";
import { pickShowcase } from "../../lib/recordings";
import { useReplayLauncher } from "./useReplayLauncher";

/**
 * The Pages build opens on a running replay of the real Claude recording: the first thing a
 * visitor sees is the diagram moving, not an empty stage. Leaving the replay (Esc) returns to
 * the stage with the list of recordings.
 */
export function useShowcaseReplay(enabled: boolean): void {
  const { startRecording } = useReplayLauncher();
  const started = useRef(false);

  useEffect(() => {
    // StrictMode mounts every effect twice in development; one autoplay is enough.
    if (!enabled || started.current) return;
    started.current = true;
    void getRecordings()
      .then((recordings) => {
        const showcase = pickShowcase(recordings);
        if (showcase !== undefined) return startRecording(showcase.slug, showcase.tokens_lower_bound);
      })
      .catch(() => {
        // The stage below lists the recordings and shows the load error itself.
      });
  }, [enabled, startRecording]);
}
