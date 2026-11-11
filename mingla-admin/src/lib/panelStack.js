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
export const SIDE_KINDS = Object.freeze(["card", "host", "creator", "content", "event", "expected", "drafts", "brand", "thread"]);

/**
 * #4270 W7: a Brand group's side panel also opens a brand's own Calendar
 * (`calendar:<host record id>`), which exists only there.
 */
export const BRAND_GROUP_SIDE_KINDS = Object.freeze([...SIDE_KINDS, "calendar"]);

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
  brand: "brand",
  calendar: "calendar",
  thread: "thread",
});

function validId(kind, id) {
  if (typeof id !== "string") return false;
  if (kind === "drafts") return id === "all" || UUID.test(id);
  return UUID.test(id);
}

/** A side panel `{ kind, id }`, or null when it is not well-formed. */
export function cleanSide(side, kinds = SIDE_KINDS) {
  if (!side || typeof side !== "object") return null;
  const kind = String(side.kind || "");
  const id = String(side.id || "").toLowerCase();
  if (!kinds.includes(kind) || !validId(kind, id)) return null;
  return { kind, id };
}

/** "host:<uuid>" -> { kind: "host", id: "<uuid>" }; anything odd -> null. */
export function parseSideValue(value, kinds = SIDE_KINDS) {
  if (typeof value !== "string" || value.length > 80) return null;
  const at = value.indexOf(":");
  if (at < 1) return null;
  return cleanSide({ kind: value.slice(0, at), id: value.slice(at + 1) }, kinds);
}

export function sideValue(side, kinds = SIDE_KINDS) {
  const clean = cleanSide(side, kinds);
  return clean ? `${clean.kind}:${clean.id}` : "";
}

/** The panel two named in a query string (the part after "?"). */
export function parseSide(search, kinds = SIDE_KINDS) {
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return null;
  }
  return parseSideValue(params.get("side"), kinds);
}

/** The same query string with panel two set (or removed with null). */
export function withSide(search, side, kinds = SIDE_KINDS) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const value = sideValue(side, kinds);
  if (value) params.set("side", value);
  else params.delete("side");
  return params.toString();
}

export function sameSide(a, b, kinds = SIDE_KINDS) {
  return sideValue(a, kinds) === sideValue(b, kinds) && sideValue(a, kinds) !== "";
}

/**
 * Opening another linked item replaces panel two and keeps a Back trail.
 * `current` is what panel two shows now ({ side, title }), `next` the side to
 * open. Returns the new trail; reopening what is already shown changes nothing.
 */
export function pushTrail(trail, current, next, kinds = SIDE_KINDS) {
  const list = Array.isArray(trail) ? trail : [];
  if (!current?.side || sameSide(current.side, next, kinds)) return list;
  return [...list, { side: cleanSide(current.side, kinds), title: String(current.title || "") }].slice(-20);
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
    // #4255 W3: a card's thread opens beside the card.
    case "thread":
      return `#/work-board?card=${s.id}&side=thread:${s.id}`;
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
    case "brand":
      return `#/brands?brandId=${s.id}`;
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

/**
 * #4270 W2/W7: where the Brand groups page is, in its address (after "?"):
 * group=<conversation> (the open thread; on a phone or tablet it means the
 * thread is showing), brand=<brand id> (open that brand's group, from a host
 * card), side=<kind>:<id> (the item open in the side panel beside the chat,
 * any Brand group kind) and rail=plan|host|media|people (the right rail's
 * tab). `host` stays the host card's record id when the panel shows one.
 */
export const BRAND_GROUP_RAIL_TABS = Object.freeze(["plan", "host", "media", "people"]);

export function brandGroupView(search) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const side = parseSide(search, BRAND_GROUP_SIDE_KINDS);
  const rail = params.get("rail") || "";
  return {
    group: params.get("group") || "",
    brand: params.get("brand") || "",
    host: side?.kind === "host" ? side.id : "",
    side,
    rail: BRAND_GROUP_RAIL_TABS.includes(rail) ? rail : "",
  };
}

/**
 * Issue #4270 W2 rework (P3-2): how "Back to the chat" closes the host card.
 * When this page opened it (a history entry was pushed), it goes back, so the
 * browser's Back then walks thread -> list; a host card that arrived in the
 * address (a pasted link, a reload) gets a new entry without it, never a
 * replace, so Back never repeats the thread.
 */
export function hostCloseStep(openedHere) {
  return openedHere ? "back" : "push";
}

/**
 * #4270 W7: closing the Brand group side panel. `pushesHere` is how many
 * history entries this page pushed since the panel opened (the first open and
 * each link followed inside it). Going back that many returns the address to
 * exactly what it was before the panel opened, so the browser's Back never
 * reopens a closed item. A panel that arrived in the address (a pasted link,
 * a reload) gets a new entry without it: never a replace (W2 rework P3-2).
 */
export function sideCloseStep(pushesHere) {
  const n = Number(pushesHere);
  return Number.isInteger(n) && n > 0 ? { kind: "go", delta: -n } : { kind: "push" };
}

export function brandGroupSearch(search, patch) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  params.set("tab", "brand-groups");
  for (const [k, v] of Object.entries(patch)) {
    if (k === "host" || k === "side") continue;
    if (k === "rail") {
      if (BRAND_GROUP_RAIL_TABS.includes(v)) params.set("rail", v); else params.delete("rail");
      continue;
    }
    if (v) params.set(k, v); else params.delete(k);
  }
  let next = params.toString();
  if (Object.hasOwn(patch, "host")) next = withSide(next, patch.host ? { kind: "host", id: patch.host } : null);
  if (Object.hasOwn(patch, "side")) next = withSide(next, patch.side || null, BRAND_GROUP_SIDE_KINDS);
  return next;
}
