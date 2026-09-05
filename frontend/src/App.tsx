import { MODE_LABEL } from "./lib/i18n";

export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base text-text">
      <h1 className="font-display text-5xl font-bold tracking-tight">hugin</h1>
      <span className="mono rounded-panel border border-border bg-surface px-3 py-1 text-xs tracking-widest text-muted">
        {MODE_LABEL.idle}
      </span>
    </main>
  );
}
