import { useEffect, useRef } from "react";

/**
 * One Esc stack for the whole app. Esc closes exactly one thing: the topmost open layer.
 * Without it every layer listens on `window` on its own, and one keystroke would close the
 * agent window and also end the replay beneath it.
 */
export const ESC_PRIORITY = {
  replay: 0,
  agentWindow: 10,
  sheet: 20,
  panic: 30,
  palette: 40,
  boot: 100,
} as const;

type Handler = (event: KeyboardEvent) => boolean | void;
type Layer = { id: symbol; priority: number; handler: { current: Handler } };

const layers: Layer[] = [];
let installed = false;

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || layers.length === 0) return;
  const top = layers.reduce((best, layer) => (layer.priority >= best.priority ? layer : best));
  // A handler returns `false` to decline (the key belongs to a text field); nothing underneath
  // may react either, so the event is still the top layer's and stays there.
  if (top.handler.current(event) === false) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** Registers `handler` as a layer while `active`; higher `priority` handles Esc first. */
export function useEscapeLayer(active: boolean, priority: number, handler: Handler): void {
  const latest = useRef<Handler>(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!active) return;
    if (!installed) {
      // Capture phase: the stack sees Esc before any listener that is not part of it.
      window.addEventListener("keydown", onKey, true);
      installed = true;
    }
    const layer: Layer = { id: Symbol("esc"), priority, handler: latest };
    layers.push(layer);
    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
    };
  }, [active, priority]);
}
