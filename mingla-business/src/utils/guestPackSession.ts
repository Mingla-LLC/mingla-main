/**
 * #4548 — the Host's working copy of one event's guest pack.
 *
 * Why a module store and not component state: the wizard's Continue and
 * Publish, and the live editor's Save changes, must save a changed pack FIRST,
 * from screens that do not own the Where step. The working copy therefore
 * lives here, keyed by event id, outlives the Where step's unmount, and is
 * released by the screen that owns the event (`releaseGuestPackSession`).
 *
 * Server truth is read through `biz_get_event_guest_pack` and written only
 * through `biz_set_event_guest_pack` (never inside the draft, publish or
 * live-edit payloads). In-memory only: no storage import.
 */

import {
  fetchEventGuestPack,
  saveEventGuestPack,
  type SavedGuestPack,
} from "../services/guestPackService";
import {
  setGuestPackDriver,
  type GuestPackSaveResult,
} from "./guestPackGate";
import {
  buildGuestPackPayload,
  checkGuestPackItem,
  checkGuestPackLink,
  checkGuestPackNote,
  GUEST_PACK_COPY,
  GUEST_PACK_MAX_ITEMS,
} from "./guestPackValidation";
import { registerSignOutCleanup } from "./signOutCleanups";

export interface GuestPackEditorItem {
  key: string;
  label: string;
  url: string;
  labelError: string | null;
  urlError: string | null;
  /** True after a blur added https:// to a bare domain. */
  fixed: boolean;
  confirmRemove: boolean;
}

export interface GuestPackSession {
  eventId: string;
  load: "loading" | "ready" | "error";
  /** What the server holds; null = no pack. */
  baseline: SavedGuestPack | null;
  note: string;
  items: GuestPackEditorItem[];
  noteError: string | null;
  saving: boolean;
  result: "saved" | "removed" | null;
  confirmRemoveAll: boolean;
  open: boolean;
}

export const GUEST_PACK_SAVE_FAILED_COPY =
  "Couldn't save the guest pack. Check your connection and try again.";
export const GUEST_PACK_FIX_BEFORE_SAVING_COPY =
  "Fix the guest pack links before saving.";

const sessions = new Map<string, GuestPackSession>();
let keyCounter = 0;

const nextKey = (): string => {
  keyCounter += 1;
  return `gp${keyCounter}`;
};

const listeners = new Set<() => void>();

export function subscribeGuestPack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

function put(next: GuestPackSession): void {
  sessions.set(next.eventId, next);
  emit();
}

function patch(eventId: string, change: Partial<GuestPackSession>): void {
  const current = sessions.get(eventId);
  if (current === undefined) return;
  put({ ...current, ...change });
}

export function getGuestPackSession(eventId: string): GuestPackSession | undefined {
  return sessions.get(eventId);
}

function itemsFromSaved(saved: SavedGuestPack | null): GuestPackEditorItem[] {
  return (saved?.items ?? []).map((item) => ({
    key: nextKey(),
    label: item.label,
    url: item.url,
    labelError: null,
    urlError: null,
    fixed: false,
    confirmRemove: false,
  }));
}

/** Starts (or retries) the read. Safe to call on every mount. */
export async function ensureGuestPackLoaded(eventId: string): Promise<void> {
  const existing = sessions.get(eventId);
  if (existing !== undefined && existing.load !== "error") return;
  put({
    eventId,
    load: "loading",
    baseline: null,
    note: "",
    items: [],
    noteError: null,
    saving: false,
    result: null,
    confirmRemoveAll: false,
    open: existing?.open ?? false,
  });
  try {
    const saved = await fetchEventGuestPack(eventId);
    const current = sessions.get(eventId);
    if (current === undefined) return; // released while loading
    put({
      ...current,
      load: "ready",
      baseline: saved,
      note: saved?.note ?? "",
      items: itemsFromSaved(saved),
    });
  } catch (error) {
    console.error("[guest-pack] load failed", error);
    patch(eventId, { load: "error" });
  }
}

const signature = (
  note: string,
  items: ReadonlyArray<{ label: string; url: string }>,
): string =>
  JSON.stringify([note.trim(), items.map((i) => [i.label.trim(), i.url.trim()])]);

export function isGuestPackDirty(session: GuestPackSession | undefined): boolean {
  if (session === undefined || session.load !== "ready") return false;
  return (
    signature(session.note, session.items) !==
    signature(session.baseline?.note ?? "", session.baseline?.items ?? [])
  );
}

/** True when this event has typed pack changes the server does not have yet. */
function hasPendingGuestPack(eventId: string | null | undefined): boolean {
  if (eventId === null || eventId === undefined) return false;
  return isGuestPackDirty(sessions.get(eventId));
}

export function setGuestPackOpen(eventId: string, open: boolean): void {
  patch(eventId, { open, confirmRemoveAll: false });
}

export function setGuestPackNote(eventId: string, note: string): void {
  patch(eventId, {
    note,
    result: null,
    // Clears as soon as the text is back in range; the over-limit error shows live.
    noteError: checkGuestPackNote(note),
  });
}

function mapItem(
  eventId: string,
  key: string,
  fn: (item: GuestPackEditorItem) => GuestPackEditorItem,
): void {
  const current = sessions.get(eventId);
  if (current === undefined) return;
  put({
    ...current,
    result: null,
    items: current.items.map((item) => (item.key === key ? fn(item) : item)),
  });
}

export function setGuestPackItemLabel(eventId: string, key: string, label: string): void {
  mapItem(eventId, key, (item) => ({
    ...item,
    label,
    labelError: label.trim() === "" ? item.labelError : null,
  }));
}

export function setGuestPackItemUrl(eventId: string, key: string, url: string): void {
  mapItem(eventId, key, (item) => ({
    ...item,
    url,
    fixed: false,
    urlError:
      item.urlError !== null && url.trim() !== "" && checkGuestPackLink(url).ok
        ? null
        : item.urlError,
  }));
}

/** Inline check on leaving the link field; adds https:// to a bare domain. */
export function blurGuestPackItemUrl(eventId: string, key: string): void {
  mapItem(eventId, key, (item) => {
    if (item.url.trim() === "") return { ...item, urlError: null, fixed: false };
    const check = checkGuestPackLink(item.url);
    if (!check.ok) return { ...item, urlError: check.error, fixed: false };
    return { ...item, url: check.url, urlError: null, fixed: check.fixed };
  });
}

export function addGuestPackItem(eventId: string): string | null {
  const current = sessions.get(eventId);
  if (current === undefined || current.items.length >= GUEST_PACK_MAX_ITEMS) return null;
  const key = nextKey();
  put({
    ...current,
    result: null,
    items: [
      ...current.items,
      { key, label: "", url: "", labelError: null, urlError: null, fixed: false, confirmRemove: false },
    ],
  });
  return key;
}

export function askRemoveGuestPackItem(eventId: string, key: string, ask: boolean): void {
  mapItem(eventId, key, (item) => ({ ...item, confirmRemove: ask }));
}

export function removeGuestPackItem(eventId: string, key: string): void {
  const current = sessions.get(eventId);
  if (current === undefined) return;
  put({ ...current, result: null, items: current.items.filter((i) => i.key !== key) });
}

export function moveGuestPackItem(eventId: string, key: string, by: -1 | 1): void {
  const current = sessions.get(eventId);
  if (current === undefined) return;
  const from = current.items.findIndex((i) => i.key === key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= current.items.length) return;
  const items = current.items.slice();
  const [moved] = items.splice(from, 1);
  if (moved === undefined) return;
  items.splice(to, 0, moved);
  put({ ...current, result: null, items });
}

export function askRemoveWholeGuestPack(eventId: string, ask: boolean): void {
  patch(eventId, { confirmRemoveAll: ask });
}

/** Clears the working copy so the next save deletes the pack. */
export function clearGuestPackFields(eventId: string): void {
  patch(eventId, {
    note: "",
    items: [],
    noteError: null,
    confirmRemoveAll: false,
    result: null,
  });
}

/** Puts the server's pack back into the fields (a failed "Remove pack"). */
export function restoreGuestPackFromBaseline(eventId: string): void {
  const current = sessions.get(eventId);
  if (current === undefined) return;
  put({
    ...current,
    note: current.baseline?.note ?? "",
    items: itemsFromSaved(current.baseline),
    noteError: null,
    result: null,
  });
}

const inFlight = new Map<string, Promise<GuestPackSaveResult>>();

/**
 * Validates every field, then saves the whole pack. Marks inline errors on
 * invalid fields. Never throws: the result says what happened so the caller
 * can toast and keep the host where they are.
 */
export function saveGuestPack(eventId: string): Promise<GuestPackSaveResult> {
  const running = inFlight.get(eventId);
  if (running !== undefined) return running;
  const run = doSave(eventId).finally(() => {
    inFlight.delete(eventId);
  });
  inFlight.set(eventId, run);
  return run;
}

async function doSave(eventId: string): Promise<GuestPackSaveResult> {
  const current = sessions.get(eventId);
  if (current === undefined || current.load !== "ready") {
    return { ok: true, saved: false };
  }
  if (!isGuestPackDirty(current)) return { ok: true, saved: false };

  const checked = current.items.map((item) => {
    const check = checkGuestPackItem(item);
    return {
      ...item,
      url: check.url,
      fixed: check.fixed || item.fixed,
      labelError: check.labelError,
      urlError: check.urlError,
    };
  });
  const build = buildGuestPackPayload(current.note, current.items);
  if (!build.ok) {
    put({
      ...current,
      items: checked,
      noteError: build.noteError,
      result: null,
      confirmRemoveAll: false,
    });
    return { ok: false, reason: "invalid", message: GUEST_PACK_FIX_BEFORE_SAVING_COPY };
  }

  patch(eventId, { saving: true, result: null, confirmRemoveAll: false });
  try {
    const saved = await saveEventGuestPack(eventId, build.payload);
    const latest = sessions.get(eventId);
    if (latest !== undefined) {
      const deleted = saved === null;
      put({
        ...latest,
        saving: false,
        baseline: saved,
        note: saved?.note ?? "",
        items: itemsFromSaved(saved),
        noteError: null,
        result: deleted ? "removed" : "saved",
      });
    }
    return { ok: true, saved: true };
  } catch (error) {
    console.error("[guest-pack] save failed", error);
    patch(eventId, { saving: false });
    // The server refused the content itself: say what to fix, not "check your
    // connection" (the connection is fine and retrying cannot help).
    // (GuestPackServiceError carries the code; read it structurally so a
    // mocked service module cannot turn this into a TypeError.)
    const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    if (code === "items_invalid") {
      return { ok: false, reason: "invalid", message: GUEST_PACK_FIX_BEFORE_SAVING_COPY };
    }
    if (code === "note_too_long") {
      return { ok: false, reason: "invalid", message: GUEST_PACK_COPY.noteTooLong };
    }
    return { ok: false, reason: "failed", message: GUEST_PACK_SAVE_FAILED_COPY };
  }
}

export function releaseGuestPackSession(eventId: string | null | undefined): void {
  if (eventId === null || eventId === undefined) return;
  if (sessions.delete(eventId)) emit();
}

/** Drops every working copy (sign-out). */
export function resetAllGuestPackSessions(): void {
  sessions.clear();
  inFlight.clear();
  emit();
}

async function flushOne(eventId: string): Promise<GuestPackSaveResult> {
  if (!hasPendingGuestPack(eventId) && !inFlight.has(eventId)) {
    return { ok: true, saved: false };
  }
  return saveGuestPack(eventId);
}

// Constitution #6: sign-out drops every working copy. This module loads lazily
// with the editor chunk, so it registers with the sign-out choke point
// (clearAllStores → runSignOutCleanups) instead of being imported there.
registerSignOutCleanup(resetAllGuestPackSessions);

// Registers this working copy with the always-loaded gate the screens call.
setGuestPackDriver({
  hasPending: hasPendingGuestPack,
  flush: flushOne,
  release: releaseGuestPackSession,
});
