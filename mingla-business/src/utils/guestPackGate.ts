/**
 * #4548 — the small, always-loaded door to the Host's guest pack working copy.
 *
 * The wizards' Continue / Publish and the live editor's Save changes must save
 * a changed pack first, but the editor, its working copy and its service are
 * heavy and load only with the Where step's editor chunk (keeps them off the
 * eager boot payload). This module is the only thing those screens import: it
 * holds no state of its own and it forwards to the
 * working copy once that module has loaded and registered itself. Until then
 * nothing can be pending, so every question answers "no pack changes".
 *
 * Pure: no React, no network, no storage.
 */

export type GuestPackSaveResult =
  | { ok: true; saved: boolean }
  | { ok: false; reason: "invalid" | "failed"; message: string };

export interface GuestPackDriver {
  hasPending: (eventId: string) => boolean;
  flush: (eventId: string) => Promise<GuestPackSaveResult>;
  release: (eventId: string) => void;
}

let driver: GuestPackDriver | null = null;

/** Called once by the working copy when it loads. */
export function setGuestPackDriver(next: GuestPackDriver): void {
  driver = next;
}

/** A wizard draft reaches the server on its first autosave; until then its id is local ("d_…"). */
export function guestPackEventIdForDraft(draftId: string): string | null {
  return draftId.startsWith("d_") ? null : draftId;
}

/** True when this event has typed pack changes the server does not have yet. */
export function hasPendingGuestPack(eventId: string | null | undefined): boolean {
  if (eventId === null || eventId === undefined || driver === null) return false;
  return driver.hasPending(eventId);
}

/**
 * The save-first gate for the main buttons: saves a changed pack and says
 * whether the host may go on. No pack, or nothing changed, is an instant yes.
 */
export async function flushGuestPack(
  eventId: string | null | undefined,
): Promise<GuestPackSaveResult> {
  if (eventId === null || eventId === undefined || driver === null) {
    return { ok: true, saved: false };
  }
  return driver.flush(eventId);
}

export function releaseGuestPackSession(eventId: string | null | undefined): void {
  if (eventId === null || eventId === undefined || driver === null) return;
  driver.release(eventId);
}
