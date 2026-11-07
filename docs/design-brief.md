# Design brief: the signal box

Short research note behind the shell's concept (the full tokens and rules are in `design/redesign-2026-10.md`).

- **Track plan as the picture.** A Gleisbildstellwerk draws the station as its own track diagram and lights only what a set route occupies, rather than giving every route its own control ([DE751916C](https://patents.google.com/patent/DE751916C/de), [DE1007356B](https://patents.google.com/patent/DE1007356B/de)). Taken: the spawn tree is track laid out left to right, a section is lit only while an agent holds it, and the diagram never re-draws when something joins (fixed slots, one fit).
- **A lamp asks, then confirms.** On those panels a flashing lamp requests an action and steady light confirms it ([DE960468C](https://patents.google.com/patent/DE960468C/de)). Taken: state lives in the lamp only (green runs, amber waits for a tool, red failed or stopped, dark queued); a kill is two beats, `TERM` then `KILL`.
- **Panels are assembled from a few fixed parts** that mirror the physical plan ([AT200613B](https://patents.google.com/patent/AT200613B/de), [Uhlenbrock TrackControl](https://www.uhlenbrock.de/de_DE/service/download/publish/I4B053F1-012.apd/TrackControl-Prospekt+2023+web.pdf)). Taken: one block type per agent (mast, role, activity, budget gauge), one hub for memory, nothing decorative.
- **Mission control reduces load by grouping displays by question** (configuration, performance, sequence) instead of by data source ([JPL, Mars Observer displays](https://ntrs.nasa.gov/api/citations/19940019415/downloads/19940019415.pdf), [MCC display standards](https://ntrs.nasa.gov/citations/19730010501)). Taken: ledger (what is this mission), diagram and occupancy plan (who, when), timetable (what happened), one row per call.

Signature motion (each 150–400 ms, transform and opacity only, off under `prefers-reduced-motion`):

1. **A signal goes up:** a spawned agent blooms out of its parent's slot and the track to it lights.
2. **A train runs the track:** a message or memory write travels its edge as a dot.
3. **Two beats on a kill:** amber `TERM` stamp, then the red `KILL` stamp.

Ambient exception, stated rather than hidden: a running lamp carries one slow ring (2.4 s loop), the only looping motion in the shell.
