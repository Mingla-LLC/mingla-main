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
