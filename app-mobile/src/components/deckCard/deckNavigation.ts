/**
 * #4347 rework (tester P1-2) — leaving the deck for another route.
 *
 * In collab the deck lives inside CollabDeckSheet's full-screen RN Modal, so a
 * plain `router.push` lands the new screen BEHIND the modal: the tap looks dead.
 * Every route that leaves the deck (a claimed venue's page, a host's brand page)
 * goes through here: when the deck's host supplies `onExternalRoute` it owns the
 * hand-off (close itself, then push); otherwise the push happens directly.
 */
export interface LeaveDeckHandlers {
  readonly onExternalRoute?: ((path: string) => void) | null;
  readonly push: (path: string) => void;
}

export function leaveDeckTo(path: string, handlers: LeaveDeckHandlers): void {
  if (typeof path !== 'string' || path.length === 0) return;
  if (handlers.onExternalRoute) {
    handlers.onExternalRoute(path);
    return;
  }
  handlers.push(path);
}
