# UI redesign, October 2026

## Concept

Hugin supervises processes, so the shell borrows from the oldest process supervisor there is: the
railway signal box (German: *Stellwerk*). The screen is a track diagram on a light grey console.
Every agent is a block section with a signal mast in front of it, the spawn tree is track laid
out left to right, and messages and syscalls are trains that run along it. A signal lamp is the
only place where state is shown in colour: green means the process runs, amber means it waits for
a tool, red means it failed or was stopped, an unlit lamp means it is queued. Everything else is
ink on grey paper. A kill is an emergency brake with two beats, `TERM` (amber stamp, the block
holds) and `KILL` (red, the block collapses onto its track), so supervision is something you can
see happen rather than a status that flips. It is deliberately not a dark neon dashboard: the
page is light, flat, printed-looking, and the only glow is a lit lamp.

What makes it Hugin and not a template: the lamp mast and the track edges, the `TERM → KILL`
beat, budget burn drawn as a segmented fuel gauge that fills from green to red, and the event
stream as a timetable (time, rail, icon, sentence) instead of log lines.

## Token plan

| Token | Value | Use |
|---|---|---|
| `base` | `#D8DAD5` | console chassis (page background) |
| `surface` | `#ECEDE9` | panels |
| `surface-2` | `#F8F8F5` | raised parts: node cards, popovers |
| `border` | `#BDC1B8` | hairlines and track bed |
| `text` | `#1B2126` | ink |
| `muted` | `#566059` | secondary text (5.4:1 on `surface`) |
| `blue` | `#2A5C9E` | live / active, selection, focus |
| `teal` | `#1C7C80` | tool calls |
| `green` | `#1E7B4F` | signal "Fahrt": running, done, success |
| `amber` | `#A86A00` | signal "Halt erwartet": waiting, budget warning |
| `red` | `#B8312B` | signal "Halt": failed, killed, danger |
| `plum` | `#86426A` | replay |

Role accents (planner, scout, smith, judge, scribe) are drawn from the same set, darkened for
light paper; the role is carried by icon and name first, accent second.

Type: **Barlow Semi Condensed** (display, node titles, big numerals; the face of German railway
and road signage), **IBM Plex Sans** (text), **IBM Plex Mono** only where the content is code
(PIDs, tool names, event rows). Space Grotesk, Inter and JetBrains Mono are gone.

Shape and elevation: one radius family (`4 px` for parts, `10 px` for panels), no shadows except
the one under a floating sheet, no gradients, no glass, no dot grid. Panels are separated by
grey space and a hairline, not nested in cards.

## Layout

| Width | Layout |
|---|---|
| ≥ 1200 | three columns: process table + mission ledger (left), signal-box diagram (centre, the hero), event timetable + agent sheet (right) |
| 720 to 1199 | diagram on top at full width, process table and timetable side by side below |
| < 720 | one column, bottom navigation (Mission, Verlauf, Prozesse, Mehr); the diagram becomes a vertical process tree with the same lamps and gauges; the agent sheet is a full-height bottom sheet |

## Motion

150 to 400 ms, `transform` and `opacity` only, one easing (`cubic-bezier(0.16, 1, 0.3, 1)`).

- Spawn: the card grows out of its parent's position along the new track.
- Message / syscall: a train (small rounded bar, rotated along the path) runs the edge.
- Finish: the lamp turns green with one ring that expands once.
- Kill: amber `TERM` stamp for 600 ms, then red `KILL` stamp, the card compacts and desaturates.
- Numbers (tokens, budget) count up; gauges fill in segments.
- `prefers-reduced-motion`: trains are not drawn, transitions collapse to instant, the lamp
  states stay readable through colour and label.

## Status language

Raw enum keys never reach the screen. `running` is "Läuft", `waiting_tool` is "Wartet auf
Werkzeug", `done` is "Fertig", `killed` is "Gestoppt"; syscalls read "Agent starten", "Bericht
abgeben" and so on (`lib/i18n.ts`, `features/log/describe.ts`).

## Replay-only build

`VITE_REPLAY_ONLY=1` builds the same shell with a recording player instead of the SSE source
and the HTTP API. It is deployed to GitHub Pages and labelled "Replay einer aufgezeichneten
Mission" in the UI.
