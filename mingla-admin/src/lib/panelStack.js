// Issue #4255 — the two side panels every daily-work page shares (Work,
// Calendar, Hosts and creators). Pure module: no React, no Supabase.
//
// Panel one is the page's own item (a work card, a host, an event...), named
// in the address the way that page always named it (`card=<id>` on Work and on
// Hosts and creators). Panel two is the item a link inside panel one points
// at, named `side=<kind>:<id>`, so a reload or a pasted link reopens both.
//
// Whatever is in the address is untrusted: a value that is not plainly
// well-formed is dropped here and the panel simply does not open.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What panel two can show. */
export const SIDE_KINDS = Object.freeze(["card", "host", "creator", "content", "event", "expected", "drafts"]);

/** Below this width panel two covers panel one, with a Back button (D10). */
export const PANEL_NARROW_PX = 1024;

/** The words of a kind, for "Open full page" and the Back button. */
export const SIDE_KIND_WORDS = Object.freeze({
  card: "work card",
  host: "host",
  creator: "creator",
  content: "post",
  event: "event",
  expected: "promised event",
  drafts: "message drafts",
});

function validId(kind, id) {
  if (typeof id !== "string") return false;
  if (kind === "drafts") return id === "all" || UUID.test(id);
  return UUID.test(id);
}

/** A side panel `{ kind, id }`, or null when it is not well-formed. */
export function cleanSide(side) {
  if (!side || typeof side !== "object") return null;
  const kind = String(side.kind || "");
  const id = String(side.id || "").toLowerCase();
  if (!SIDE_KINDS.includes(kind) || !validId(kind, id)) return null;
  return { kind, id };
}

/** "host:<uuid>" -> { kind: "host", id: "<uuid>" }; anything odd -> null. */
export function parseSideValue(value) {
  if (typeof value !== "string" || value.length > 80) return null;
  const at = value.indexOf(":");
  if (at < 1) return null;
  return cleanSide({ kind: value.slice(0, at), id: value.slice(at + 1) });
}

export function sideValue(side) {
  const clean = cleanSide(side);
  return clean ? `${clean.kind}:${clean.id}` : "";
}

/** The panel two named in a query string (the part after "?"). */
export function parseSide(search) {
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return null;
  }
  return parseSideValue(params.get("side"));
}

/** The same query string with panel two set (or removed with null). */
export function withSide(search, side) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const value = sideValue(side);
  if (value) params.set("side", value);
  else params.delete("side");
  return params.toString();
}

export function sameSide(a, b) {
  return sideValue(a) === sideValue(b) && sideValue(a) !== "";
}

/**
 * Opening another linked item replaces panel two and keeps a Back trail.
 * `current` is what panel two shows now ({ side, title }), `next` the side to
 * open. Returns the new trail; reopening what is already shown changes nothing.
 */
export function pushTrail(trail, current, next) {
  const list = Array.isArray(trail) ? trail : [];
  if (!current?.side || sameSide(current.side, next)) return list;
  return [...list, { side: cleanSide(current.side), title: String(current.title || "") }].slice(-20);
}

/** Back: the trail without its last entry, and the entry to show again. */
export function popTrail(trail) {
  const list = Array.isArray(trail) ? trail : [];
  if (!list.length) return { trail: [], back: null };
  return { trail: list.slice(0, -1), back: list[list.length - 1] };
}

/** The page an item lives on, for the small "Open full page" link. */
export function sideHref(side) {
  const s = cleanSide(side);
  if (!s) return "";
  switch (s.kind) {
    case "card":
      return `#/work-board?card=${s.id}`;
    case "host":
      return `#/outreach?tab=hosts&card=${s.id}`;
    case "creator":
      return `#/outreach?tab=creators&card=${s.id}`;
    case "content":
      return `#/content-calendar?card=${s.id}`;
    case "event":
    case "expected":
      return `#/content-calendar?event=${s.kind}:${s.id}`;
    case "drafts":
      return s.id === "all" ? "#/drafts" : `#/drafts?record=${s.id}`;
    default:
      return "";
  }
}

/**
 * A work card's linked record as a side panel, or null when the kind has no
 * panel (a GitHub link opens GitHub in a new tab instead).
 */
export function linkSide(link) {
  if (!link || typeof link !== "object") return null;
  const kind = { host: "host", creator: "creator", event: "event", expected: "expected", content: "content", card: "card", work_card: "card" }[link.kind];
  return kind ? cleanSide({ kind, id: link.id }) : null;
}
