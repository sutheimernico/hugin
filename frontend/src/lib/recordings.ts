/**
 * The recorded demo runs as static files — what the GitHub Pages build reads instead of the
 * kernel's `/api/recordings`. The format is the one `replay/recorder.py` exports: a manifest
 * list plus one JSON object per line for the events.
 */

import type { HEvent } from "../state/types";
import type { ApiRecording } from "./api";

/** One event per line; blank lines are tolerated, a broken line is an error worth seeing. */
export function parseJsonl(text: string): HEvent[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as HEvent);
}

/**
 * The recording the Pages build starts with: the real Claude run if there is one, because it is
 * the most telling, otherwise the first.
 */
export function pickShowcase(recordings: ApiRecording[]): ApiRecording | undefined {
  return recordings.find((recording) => recording.driver === "claude") ?? recordings[0];
}

const DRIVER_ORDER = ["claude", "scripted", "ollama"];

/**
 * The real Claude run first, the simulation second, the slow local model last — the order of
 * how much a visitor will get out of each, not the order the files happen to sort in.
 */
export function sortRecordings(recordings: ApiRecording[]): ApiRecording[] {
  const rank = (driver: string) => {
    const index = DRIVER_ORDER.indexOf(driver);
    return index === -1 ? DRIVER_ORDER.length : index;
  };
  return [...recordings].sort((a, b) => rank(a.driver) - rank(b.driver) || a.slug.localeCompare(b.slug));
}

function asset(path: string): string {
  return `${import.meta.env.BASE_URL}recordings/${path}`;
}

export async function fetchStaticRecordings(): Promise<ApiRecording[]> {
  const response = await fetch(asset("index.json"));
  if (!response.ok) throw new Error("Die Aufzeichnungen konnten nicht geladen werden.");
  return (await response.json()) as ApiRecording[];
}

export async function fetchStaticEvents(slug: string): Promise<HEvent[]> {
  const response = await fetch(asset(`${encodeURIComponent(slug)}.jsonl`));
  if (!response.ok) throw new Error("Die Aufzeichnung konnte nicht geladen werden.");
  return parseJsonl(await response.text());
}
