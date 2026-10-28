/*
 * #2829 W7 — the inline script voyage runs first in the page (nonce'd): it
 * adds `.js` to <html> before first paint so scroll reveals start hidden, and
 * removes it again after 2,500 ms unless the reveal code proved it is alive
 * (`data-reveal-ready`). A dead bundle therefore degrades to the
 * no-JavaScript page — everything visible, nothing animated — never a blank.
 */
export const REVEAL_FAILSAFE_MS = 2500;

export const VOYAGE_HEAD_SCRIPT =
  "document.documentElement.classList.add('js');" +
  "setTimeout(function(){" +
  "if(!document.documentElement.hasAttribute('data-reveal-ready'))" +
  "document.documentElement.classList.remove('js')" +
  `},${REVEAL_FAILSAFE_MS})`;
