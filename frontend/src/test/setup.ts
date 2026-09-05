import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no layout engine, and xyflow refuses to render a graph it cannot measure. These
 * four stand-ins are the minimum the library needs (they mirror the official xyflow testing
 * guide): a ResizeObserver that answers once, a DOMMatrix that only knows the zoom factor,
 * element sizes read back from inline styles, and an SVG bounding box.
 *
 * Everything else in the shell is measured by the browser, never by a test.
 */

class TestResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    // xyflow reads `contentRect` as well as the element itself, so the entry carries the size
    // the inline style declares.
    const element = target as HTMLElement;
    const size = { width: element.offsetWidth, height: element.offsetHeight };
    const contentRect = size as DOMRectReadOnly;
    this.callback(
      [{ target, contentRect } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve(): void {}
  disconnect(): void {}
}

class TestDOMMatrixReadOnly {
  readonly m22: number;

  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

const globals = globalThis as unknown as Record<string, unknown>;
globals.ResizeObserver = TestResizeObserver;
globals.DOMMatrixReadOnly = TestDOMMatrixReadOnly;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    get(this: HTMLElement) {
      return Number.parseFloat(this.style.height) || 1;
    },
  },
  offsetWidth: {
    get(this: HTMLElement) {
      return Number.parseFloat(this.style.width) || 1;
    },
  },
});

// `getBBox` lives on SVGGraphicsElement in the DOM lib, but jsdom hangs everything off
// SVGElement — the cast is the seam between the two.
(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
