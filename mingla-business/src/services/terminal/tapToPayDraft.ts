/**
 * #4271 — the door-sale draft handed to the Tap to Pay route.
 *
 * Door mode (#4389) hands off to
 *   /event/<id>/door/tap/new?draft=<base64 json {lines, eventDateId, buyerPhone?, buyerName?}>
 * The draft only names WHAT is being sold. The server prices it (door-tap-intent
 * create); nothing here is trusted as an amount. `buyerName` is shown on the
 * paid screen's Guest row and sent with create so the sale keeps it (stored
 * like the buyer phone); it is never a charge input.
 */

export interface TapToPayDraftLine {
  ticketTypeId: string;
  quantity: number;
}

export interface TapToPayDraft {
  lines: TapToPayDraftLine[];
  eventDateId: string | null;
  buyerPhone: string | null;
  phoneCountryIso: string | null;
  /** What the host typed in the sale sheet, if anything. Saved on the sale. */
  buyerName?: string | null;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const MAX_LINES = 50;
const MAX_QUANTITY = 99;
const MAX_NAME = 120;

/** UTF-8 safe base64 encode that does not depend on a global btoa. */
export const encodeBase64Utf8 = (value: string): string => {
  const bytes = unescape(encodeURIComponent(value));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i);
    const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : NaN;
    const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : NaN;
    const triple = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += Number.isNaN(b) ? "=" : BASE64_ALPHABET[(triple >> 6) & 63];
    out += Number.isNaN(c) ? "=" : BASE64_ALPHABET[triple & 63];
  }
  return out;
};

/** UTF-8 safe base64 decode. Accepts URL-safe characters and missing padding. */
export const decodeBase64Utf8 = (value: string): string | null => {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) return null;
  let bytes = "";
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(escape(bytes));
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** Parses the route's `draft` param. Returns null for anything malformed. */
export const parseTapToPayDraft = (raw: string | null | undefined): TapToPayDraft | null => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let decoded = decodeBase64Utf8(raw);
  if (decoded === null) {
    // Expo Router may hand the param over still percent-encoded.
    try {
      decoded = decodeBase64Utf8(decodeURIComponent(raw));
    } catch {
      decoded = null;
    }
  }
  if (decoded === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.lines)) return null;
  if (parsed.lines.length === 0 || parsed.lines.length > MAX_LINES) return null;
  const lines: TapToPayDraftLine[] = [];
  for (const line of parsed.lines) {
    if (!isRecord(line)) return null;
    const ticketTypeId = optionalString(line.ticketTypeId);
    const quantity = line.quantity;
    if (
      ticketTypeId === null ||
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return null;
    }
    lines.push({ ticketTypeId, quantity });
  }
  // Cut by characters, not UTF-16 units, so a name never ends in half an emoji.
  const typedName = optionalString(parsed.buyerName);
  const buyerName =
    typedName === null ? null : Array.from(typedName).slice(0, MAX_NAME).join("").trim() || null;
  return {
    lines,
    eventDateId: optionalString(parsed.eventDateId),
    buyerPhone: optionalString(parsed.buyerPhone),
    phoneCountryIso: optionalString(parsed.phoneCountryIso),
    // Only present when the host typed a name, so an older draft reads the same.
    ...(buyerName !== null ? { buyerName } : {}),
  };
};

/** Builds the `draft` param (used by the setup screen to hand the sale back). */
export const encodeTapToPayDraft = (draft: TapToPayDraft): string =>
  encodeBase64Utf8(
    JSON.stringify({
      lines: draft.lines,
      eventDateId: draft.eventDateId,
      ...(draft.buyerPhone !== null ? { buyerPhone: draft.buyerPhone } : {}),
      ...(draft.phoneCountryIso !== null ? { phoneCountryIso: draft.phoneCountryIso } : {}),
      ...(draft.buyerName != null ? { buyerName: draft.buyerName } : {}),
    }),
  );

/**
 * #4271 — "Sell another" keeps what was sold (tickets, date) for the next guest
 * and drops everything about this guest (name, phone, phone country).
 */
export const sellAnotherDraft = (draft: TapToPayDraft): TapToPayDraft => ({
  lines: draft.lines.map((line) => ({ ticketTypeId: line.ticketTypeId, quantity: line.quantity })),
  eventDateId: draft.eventDateId,
  buyerPhone: null,
  phoneCountryIso: null,
});
