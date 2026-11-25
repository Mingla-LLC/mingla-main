/**
 * #4490 P2 — keep the focused field above the phone's keyboard on mobile web.
 *
 * Mobile browsers shrink `window.visualViewport`, not the layout viewport, when
 * the keyboard opens, so a field low on the page can sit under it. On focus,
 * and again when the visual viewport resizes (the keyboard finished opening),
 * the focused element is scrolled to the middle of what is visible. Native is
 * handled by SmartScrollView's keyboard-aware container; this is a no-op there.
 */
export function revealFocusedField(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const reveal = (): void => {
    const active = document.activeElement as HTMLElement | null;
    if (active !== null && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  window.setTimeout(reveal, 250);
  const viewport = window.visualViewport;
  if (viewport != null) {
    const onResize = (): void => {
      reveal();
      viewport.removeEventListener("resize", onResize);
    };
    viewport.addEventListener("resize", onResize);
    window.setTimeout(() => viewport.removeEventListener("resize", onResize), 1500);
  }
}

/**
 * #4490 - callback ref for the container of a long form: any field focused
 * inside it is scrolled above the phone keyboard and any pinned bar (web only;
 * native uses SmartScrollView). One place, so a screen cannot forget it.
 */
export function revealFocusedFieldWithin(node: unknown): void {
  const el = node as { addEventListener?: (t: string, l: () => void) => void } | null;
  if (el === null || typeof el.addEventListener !== "function") return;
  el.addEventListener("focusin", revealFocusedField);
}
