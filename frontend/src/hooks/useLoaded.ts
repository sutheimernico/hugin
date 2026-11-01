import { useEffect, useState } from "react";

/** One list, loaded once. `load` is a module-level API function, so the effect runs once. */
export function useLoaded<T>(load: () => Promise<T[]>): { rows: T[] | null; error: string | null } {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    load()
      .then((answer) => {
        if (live) setRows(answer);
      })
      .catch((reason: unknown) => {
        if (!live) return;
        setRows([]);
        setError(errorText(reason));
      });
    return () => {
      live = false;
    };
  }, [load]);

  return { rows, error };
}

export function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Der Kernel ist gerade nicht erreichbar.";
}
