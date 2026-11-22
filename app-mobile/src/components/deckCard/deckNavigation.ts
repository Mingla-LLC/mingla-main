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

/**
 * #4490 W3 fix 1 — a route opened from the deck's card sheet: the sheet
 * closes first, then the route leaves the deck through the same hand-off
 * (`leaveDeckTo`), so in collab the shared deck's modal closes before the push.
 */
export function leaveSheetTo(
  path: string,
  handlers: LeaveDeckHandlers & { readonly closeSheet: () => void },
): void {
  if (typeof path !== 'string' || path.length === 0) return;
  handlers.closeSheet();
  leaveDeckTo(path, handlers);
}
