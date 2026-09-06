/**
 * The memory browser (spec §2.9, view 4): what the agents learned, and who learned it.
 *
 * Unlike every other view this one is *not* a projection of the event stream — munin is a table
 * in SQLite, and its full text lives only there. So the browser queries the API, and the event
 * stream is used for one thing only: `munin.writes` tells it that the answer it is showing has
 * gone stale, which is what makes new memories appear during a run.
 */

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip } from "../../components/Chip";
import { Panel } from "../../components/Panel";
import { recentMunin, searchMunin, type ApiMemory } from "../../lib/api";
import { fmtDateTimeDe, relativeTimeDe } from "../../lib/time";
import { useHuginStore } from "../../state/store";

/** Long enough that a typed word is one query, short enough to feel like live search. */
const DEBOUNCE_MS = 250;

/** Ages are read to the minute, so the clock behind them may be coarse. */
const TICK_MS = 30_000;

/** The answer to one query. Carrying the query along is what tells a stale list from a fresh one. */
type Page = { query: string; rows: ApiMemory[] };

export function MuninBrowser() {
  // The palette prefills the query; taking it as the initial value (rather than in an effect)
  // means a prefilled browser never fires the "newest memories" request first.
  const [query, setQuery] = useState(() => useHuginStore.getState().muninQuery);
  const [page, setPage] = useState<Page | null>(null);
  const [selected, setSelected] = useState<ApiMemory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setMuninQuery = useHuginStore((store) => store.setMuninQuery);
  const writes = useHuginStore((store) => store.state.munin.writes);
  const now = useCoarseNow();

  // The prefill is a one-shot instruction, already consumed above. Clearing it keeps a query
  // typed once in the palette from re-opening with this view for the rest of the session.
  useEffect(() => setMuninQuery(""), [setMuninQuery]);

  const trimmed = query.trim();

  useEffect(() => {
    let live = true;
    // One timer for both triggers: a burst of keystrokes *and* a burst of munin writes during a
    // run collapse into a single request.
    const timer = window.setTimeout(() => {
      const answer = trimmed === "" ? recentMunin() : searchMunin(trimmed);
      answer
        .then((rows) => {
          if (!live) return;
          setPage({ query: trimmed, rows });
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!live) return;
          setPage({ query: trimmed, rows: [] });
          setError(errorText(reason));
        });
    }, DEBOUNCE_MS);

    // `live` is what makes a slow answer to an old query harmless: it can still arrive, it just
    // no longer has anywhere to land.
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [trimmed, writes]);

  // The list on screen still answers the previous query while the current one is in flight —
  // which is exactly when an empty state would be a lie.
  const settled = page !== null && page.query === trimmed;
  const rows = page?.rows ?? [];

  return (
    <Panel
      title="Munin — Gedächtnis"
      right={<Status settled={settled} count={rows.length} />}
      className="h-full"
      bodyClassName="flex min-h-0 flex-col p-0"
    >
      <div className="relative shrink-0 border-b border-border p-3">
        <Search
          size={14}
          strokeWidth={1.75}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-6 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          aria-label="Munin durchsuchen"
          placeholder="Wonach suchst du?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="ease-out-expo h-9 w-full rounded-panel border border-border bg-surface-2 pr-3 pl-9 text-[13px] text-text transition-colors duration-150 outline-none placeholder:text-muted focus:border-violet/60"
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 min-[900px]:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-border min-[900px]:border-r min-[900px]:border-b-0">
          {error !== null && <p className="p-4 text-[13px] text-red">{error}</p>}
          {error === null && settled && rows.length === 0 && (
            <p className="p-4 text-[13px] text-muted">
              {trimmed === ""
                ? "Munin ist noch leer — starte eine Mission."
                : `Keine Treffer für »${trimmed}«.`}
            </p>
          )}
          <ul>
            {rows.map((memory) => (
              <li key={memory.id}>
                <ResultRow
                  memory={memory}
                  now={now}
                  active={selected?.id === memory.id}
                  onSelect={setSelected}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {selected === null ? (
            <p className="text-[13px] text-muted">
              Wähle einen Eintrag, um ihn samt Herkunft zu lesen.
            </p>
          ) : (
            <Detail memory={selected} />
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Subtle by design: a spinner would claim the eye for a request that usually takes 20 ms. */
function Status({ settled, count }: { settled: boolean; count: number }) {
  return (
    <span className="font-mono text-[11px] text-muted">
      {settled ? `${count} ${count === 1 ? "Eintrag" : "Einträge"}` : "sucht…"}
    </span>
  );
}

type ResultRowProps = {
  memory: ApiMemory;
  now: number;
  active: boolean;
  onSelect: (memory: ApiMemory) => void;
};

function ResultRow({ memory, now, active, onSelect }: ResultRowProps) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(memory)}
      className={`ease-out-expo block w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2 ${
        active ? "bg-surface-2 shadow-[inset_2px_0_0_0_var(--color-violet)]" : ""
      }`}
    >
      <span className="block truncate text-[13px] text-text">{memory.title}</span>
      <span className="mt-1 block truncate font-mono text-[11px] text-muted">
        {origin(memory, now).join(" · ")}
      </span>
      {memory.tags.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {memory.tags.map((tag) => (
            <Chip key={tag} tone="muted">
              {tag}
            </Chip>
          ))}
        </span>
      )}
    </button>
  );
}

function Detail({ memory }: { memory: ApiMemory }) {
  return (
    // Capped, not full-bleed: on a 1600 px screen the pane is 1 200 px wide, and prose set that
    // long is unreadable.
    <article className="max-w-[72ch]">
      <h3 className="font-display text-[15px] leading-snug font-medium text-text">
        {memory.title}
      </h3>
      <p data-testid="munin-provenance" className="mt-1.5 font-mono text-[11px] text-muted">
        {provenance(memory)}
      </p>
      {memory.tags.length > 0 && (
        <p className="mt-2.5 flex flex-wrap gap-1">
          {memory.tags.map((tag) => (
            <Chip key={tag} tone="muted">
              {tag}
            </Chip>
          ))}
        </p>
      )}
      {/* The agent wrote prose with its own line breaks; the browser keeps them. */}
      <p className="mt-4 text-[13px] leading-relaxed whitespace-pre-wrap text-text">
        {memory.body}
      </p>
    </article>
  );
}

/** The short form under a result title: who wrote it and how long ago. */
function origin(memory: ApiMemory, now: number): string[] {
  const parts: string[] = [];
  if (memory.program !== null) parts.push(memory.program);
  if (memory.pid !== null) parts.push(`PID ${memory.pid}`);
  parts.push(relativeTimeDe(memory.created_at, now));
  return parts;
}

/** The long form in the detail pane. A missing field is named as missing, never guessed. */
function provenance(memory: ApiMemory): string {
  const parts = [`Geschrieben von ${memory.program ?? "unbekannt"}`];
  if (memory.pid !== null) parts.push(`PID ${memory.pid}`);
  if (memory.run_id !== null) parts.push(`Run ${memory.run_id}`);
  parts.push(fmtDateTimeDe(memory.created_at));
  return parts.join(" · ");
}

/** Seconds since the epoch, half a minute at a time — enough for "vor 7 Min." to stay true. */
function useCoarseNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1_000);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1_000), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Munin ist gerade nicht erreichbar.";
}
