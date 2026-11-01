/**
 * How an event kind looks in the timetable: an icon and the colour family it belongs to.
 * The sentence itself is written by the reducer's `logText`; this decides everything around it.
 * Longest prefix first, so `proc.exit` can differ from `proc.`.
 */

import {
  Brain,
  CircleCheck,
  CircleX,
  Clock,
  Cpu,
  Database,
  FileText,
  Flag,
  GitFork,
  Gauge,
  Mail,
  OctagonX,
  Power,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "../../components/Chip";

export interface KindStyle {
  icon: LucideIcon;
  tone: Tone;
}

const KINDS: [string, KindStyle][] = [
  ["run.created", { icon: Flag, tone: "blue" }],
  ["run.done", { icon: CircleCheck, tone: "green" }],
  ["run.failed", { icon: CircleX, tone: "red" }],
  ["sched.", { icon: Clock, tone: "muted" }],
  ["proc.spawned", { icon: GitFork, tone: "blue" }],
  ["proc.thinking", { icon: Brain, tone: "muted" }],
  ["proc.exit", { icon: Power, tone: "muted" }],
  ["proc.", { icon: Cpu, tone: "muted" }],
  ["tool.", { icon: Wrench, tone: "teal" }],
  ["sys.", { icon: Cpu, tone: "teal" }],
  ["msg.", { icon: Mail, tone: "blue" }],
  ["munin.", { icon: Database, tone: "green" }],
  ["artifact.", { icon: FileText, tone: "green" }],
  ["budget.", { icon: Gauge, tone: "amber" }],
  ["kill", { icon: OctagonX, tone: "red" }],
];

const FALLBACK: KindStyle = { icon: Cpu, tone: "muted" };

export function describeKind(kind: string): KindStyle {
  return KINDS.find(([prefix]) => kind.startsWith(prefix))?.[1] ?? FALLBACK;
}
