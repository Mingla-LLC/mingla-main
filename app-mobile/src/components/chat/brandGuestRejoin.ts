/**
 * #4459 (QA retest P3): after a rejoin the server shows history only from the
 * rejoin time (history_visible_from). The booking card announces the rejoin
 * here; the Chats page drops its in-memory and saved copy of that thread and
 * reloads it from the server, so no pre-rejoin message lingers on screen.
 *
 * A rejoin announced while no Chats page is listening is kept and handed to
 * the next listener, so a cold Chats page still starts clean.
 */
type Listener = (conversationId: string) => void;

let listener: Listener | null = null;
const pending = new Set<string>();

export function announceBrandGuestRejoin(conversationId: string): void {
  if (listener !== null) {
    listener(conversationId);
    return;
  }
  pending.add(conversationId);
}

/** Registers the Chats page's reset; returns the unregister. */
export function onBrandGuestRejoined(next: Listener): () => void {
  listener = next;
  const queued = Array.from(pending);
  pending.clear();
  queued.forEach((conversationId) => next(conversationId));
  return () => {
    if (listener === next) listener = null;
  };
}

/** Test seam: forget any listener and queued rejoins. */
export function resetBrandGuestRejoinForTests(): void {
  listener = null;
  pending.clear();
}
