/**
 * #4548 — guest pack rules, one owner for the Host editor and its save path.
 *
 * Mirrors the server contract (`biz_set_event_guest_pack`): a note of up to
 * 1,000 characters and up to 5 items, each with a label of 1..40 characters
 * and one https link of up to 2,048 characters. The server stays the
 * authority; this is the inline check that tells the host first.
 *
 * Pure: no React, no network, no storage.
 */

export const GUEST_PACK_MAX_ITEMS = 5;
export const GUEST_PACK_NOTE_MAX = 1000;
export const GUEST_PACK_LABEL_MAX = 40;
export const GUEST_PACK_URL_MAX = 2048;

export const GUEST_PACK_COPY = {
  labelMissing: "Add a label so guests know what this is.",
  urlMissing: "Add a link, or remove this one.",
  urlInsecure: "Use a secure link (https)",
  urlIncomplete:
    "That isn't a full link. Paste the whole web address, starting with https://",
  urlScheme:
    "Only web links work here. Use a link that starts with https://",
  urlTooLong: "That link is too long. Use a shorter share link.",
  noteTooLong: "Shorten the note to 1,000 characters or fewer.",
  httpsAdded: "Added https:// for you.",
} as const;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_DOMAIN = /^[^\s/:@]+\.[^\s/:@]+(?:[/?#][^\s]*)?$/;
const FULL_HTTPS = /^https:\/\/[^\s/]+\.[^\s]+$/i;

export type LinkCheck =
  | { ok: true; url: string; fixed: boolean }
  | { ok: false; error: string };

/**
 * Checks one typed link. A bare domain gets `https://` added (`fixed: true`);
 * `http://`, any other scheme, junk and over-long links are refused with the
 * approved copy. An empty string is NOT valid here: the caller decides whether
 * an empty link is a "missing" error (save) or nothing to say yet (typing).
 */
export function checkGuestPackLink(raw: string): LinkCheck {
  const text = raw.trim();
  if (text === "") return { ok: false, error: GUEST_PACK_COPY.urlMissing };
  if (/^http:\/\//i.test(text)) {
    return { ok: false, error: GUEST_PACK_COPY.urlInsecure };
  }
  if (/^https:\/\//i.test(text)) {
    if (!FULL_HTTPS.test(text)) {
      return { ok: false, error: GUEST_PACK_COPY.urlIncomplete };
    }
    if (text.length > GUEST_PACK_URL_MAX) {
      return { ok: false, error: GUEST_PACK_COPY.urlTooLong };
    }
    return { ok: true, url: text, fixed: false };
  }
  if (SCHEME.test(text)) return { ok: false, error: GUEST_PACK_COPY.urlScheme };
  if (BARE_DOMAIN.test(text)) {
    const url = `https://${text}`;
    if (url.length > GUEST_PACK_URL_MAX) {
      return { ok: false, error: GUEST_PACK_COPY.urlTooLong };
    }
    return { ok: true, url, fixed: true };
  }
  return { ok: false, error: GUEST_PACK_COPY.urlIncomplete };
}

export function checkGuestPackLabel(raw: string): string | null {
  return raw.trim() === "" ? GUEST_PACK_COPY.labelMissing : null;
}

export function checkGuestPackNote(raw: string): string | null {
  return raw.length > GUEST_PACK_NOTE_MAX ? GUEST_PACK_COPY.noteTooLong : null;
}

export interface GuestPackItemInput {
  label: string;
  url: string;
}

export interface GuestPackItemCheck {
  labelError: string | null;
  urlError: string | null;
  /** The link as it will be saved (https added), or the typed text when invalid. */
  url: string;
  fixed: boolean;
}

export function checkGuestPackItem(item: GuestPackItemInput): GuestPackItemCheck {
  const link = checkGuestPackLink(item.url);
  return {
    labelError: checkGuestPackLabel(item.label),
    urlError: link.ok ? null : link.error,
    url: link.ok ? link.url : item.url,
    fixed: link.ok ? link.fixed : false,
  };
}

export interface GuestPackPayload {
  note: string | null;
  items: GuestPackItemInput[];
}

export type GuestPackBuild =
  | { ok: true; payload: GuestPackPayload }
  | { ok: false; noteError: string | null; invalidItems: number };

/**
 * Builds the exact `biz_set_event_guest_pack` arguments, or reports what is
 * wrong. An empty pack (no note, no items) is valid: saving it deletes the pack.
 */
export function buildGuestPackPayload(
  note: string,
  items: ReadonlyArray<GuestPackItemInput>,
): GuestPackBuild {
  const noteError = checkGuestPackNote(note);
  let invalidItems = 0;
  const out: GuestPackItemInput[] = [];
  for (const item of items) {
    const check = checkGuestPackItem(item);
    if (check.labelError !== null || check.urlError !== null) {
      invalidItems += 1;
      continue;
    }
    out.push({ label: item.label.trim(), url: check.url });
  }
  if (items.length > GUEST_PACK_MAX_ITEMS) invalidItems += 1;
  if (noteError !== null || invalidItems > 0) {
    return { ok: false, noteError, invalidItems };
  }
  const trimmed = note.trim();
  return {
    ok: true,
    payload: { note: trimmed === "" ? null : trimmed, items: out },
  };
}

/** "Note and 4 links" for the collapsed row once something is saved. */
export function guestPackSummary(
  saved: { note: string | null; items: ReadonlyArray<unknown> } | null,
): string | null {
  if (saved === null) return null;
  const n = saved.items.length;
  const parts: string[] = [];
  if (saved.note !== null) parts.push("Note");
  if (n > 0) parts.push(`${n} ${n === 1 ? "link" : "links"}`);
  if (parts.length === 0) return null;
  return parts.join(" and ");
}

