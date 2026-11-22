import { createScope, type Scope } from "animejs";

export function createSafeScope(
  root: HTMLElement,
  setup: (reducedMotion: boolean) => void,
): Scope {
  const hasMatchMedia =
    typeof window !== "undefined" && typeof window.matchMedia === "function";

  if (!hasMatchMedia) {
    return createScope({ root }).add(() => {
      setup(true);
    });
  }

  return createScope({
    root,
    mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" },
  }).add((self) => {
    const reduced = Boolean(self?.matches?.reduce);
    setup(reduced);
  });
}
