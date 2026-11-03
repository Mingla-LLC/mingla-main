// Issue #3802 (Wave 1) — the address of a Hosts or Creators view.
//
// Pure module. Every filter set and open card has its own address:
//   #/hosts?q=palm&icp=event_organizer&region=lagos&mine=1&due=stale&card=<id>
// Defaults are left out, so the plain board is just #/hosts.
//
// Issue #4255: the board is the only view (D8). An old `view=list` or
// `view=region` link opens the board (the value is ignored). The Owner
// dropdown is `mine=1` (Mine) or `owner=<teammate>|none`; the host toggles of
// #3980 (`filter=nonext|soon`) are Due choices now; `side=<kind>:<id>` is the
// linked item open in the second panel.
//
// Whatever is in the address is treated as untrusted: a value that is not
// plainly well-formed is dropped here, and a well-formed value that names
// nothing real (an ICP or region that does not exist) is dropped by
// cleanCrmState() once the lists are loaded.

import { parseSideValue, sideValue } from "./panelStack.js";

export const NEW_CARD = "new";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_WORD = /^[a-z][a-z0-9_]{0,39}$/;
const SLUG = /^[a-z0-9-]{1,60}$/;
const MAX_Q = 80;

export const EMPTY_CRM_STATE = Object.freeze({
  q: "",
  icp: "",
  region: "",
  mine: false,
  card: "",
  // #3980 (R1): "fill in" (open the card on its first missing field).
  fill: false,
  // #4130 (Wave 4a) / #4255: the Due dropdown (lib/outreachView.js DUE_OPTIONS).
  due: "",
  // #4255: the Owner dropdown's teammate ("" = everyone, "none" = unassigned).
  owner: "",
  // #4255: the item open in the second panel ("host:<id>").
  side: "",
});
// #3980's two host toggles, read from old links into Due.
const OLD_HOST_FILTERS = ["nonext", "soon"];
export const DUE_VALUES = ["today", "week", "stale", "replied", "nonext", "soon", "noregion", "nodue"];
export const OWNER_NONE = "none";
const EMAIL = /^[^\s@?&#=]{1,64}@[^\s@?&#=]{1,190}$/;

/** The part of a hash after "?", or "" when there is none. */
export function hashSearch(hash) {
  const text = typeof hash === "string" ? hash : "";
  const at = text.indexOf("?");
  return at < 0 ? "" : text.slice(at + 1);
}

/** The first path segment of a hash: "#/hosts?x=1" -> "hosts". */
export function hashPageId(hash) {
  const text = typeof hash === "string" ? hash : "";
  return text.replace(/^#\/?/, "").split("?")[0].split("/")[0];
}

/**
 * Read a view out of a query string (the part after "?"). Never throws;
 * anything odd falls back to the default.
 */
export function parseCrmSearch(search) {
  const state = { ...EMPTY_CRM_STATE };
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return state;
  }
  const q = params.get("q");
  if (typeof q === "string" && q.length <= MAX_Q) state.q = q;
  const icp = params.get("icp");
  if (icp && ID_WORD.test(icp)) state.icp = icp;
  const region = params.get("region");
  if (region && SLUG.test(region)) state.region = region;
  if (params.get("mine") === "1") state.mine = true;
  const card = params.get("card");
  if (card && (card === NEW_CARD || UUID.test(card))) state.card = card.toLowerCase();
  if (params.get("fill") === "1" && state.card && state.card !== NEW_CARD) state.fill = true;
  const due = params.get("due");
  if (due && DUE_VALUES.includes(due)) state.due = due;
  const filter = params.get("filter");
  if (!state.due && filter && OLD_HOST_FILTERS.includes(filter)) state.due = filter;
  const owner = String(params.get("owner") || "").toLowerCase();
  if (owner === OWNER_NONE || EMAIL.test(owner)) state.owner = owner;
  if (state.owner) state.mine = false;
  const side = sideValue(parseSideValue(params.get("side") || ""));
  if (side) state.side = side;
  return state;
}

/** Read a view out of a whole address: "#/hosts?view=list&mine=1". */
export function parseCrmHash(hash) {
  return parseCrmSearch(hashSearch(hash));
}

/** The query string for a view, defaults left out, in one fixed order. */
export function buildCrmSearch(state) {
  const s = { ...EMPTY_CRM_STATE, ...(state || {}) };
  const params = new URLSearchParams();
  if (typeof s.q === "string" && s.q !== "" && s.q.length <= MAX_Q) params.set("q", s.q);
  if (s.icp && ID_WORD.test(s.icp)) params.set("icp", s.icp);
  if (s.region && SLUG.test(s.region)) params.set("region", s.region);
  if (s.mine && !s.owner) params.set("mine", "1");
  if (s.owner && (s.owner === OWNER_NONE || EMAIL.test(s.owner))) params.set("owner", s.owner);
  if (s.card && (s.card === NEW_CARD || UUID.test(s.card))) params.set("card", s.card);
  if (s.fill && s.card && s.card !== NEW_CARD) params.set("fill", "1");
  if (s.due && DUE_VALUES.includes(s.due)) params.set("due", s.due);
  const side = sideValue(parseSideValue(s.side || ""));
  if (side) params.set("side", side);
  return params.toString();
}

export function buildCrmHash(pageId, state) {
  const search = buildCrmSearch(state);
  return `#/${pageId}${search ? `?${search}` : ""}`;
}

/**
 * Drop an ICP or region that names nothing real. `icpIds` and `regionSlugs`
 * are the lists the server returned.
 */
export function cleanCrmState(state, { icpIds = [], regionSlugs = [] } = {}) {
  const next = { ...EMPTY_CRM_STATE, ...(state || {}) };
  if (next.icp && !icpIds.includes(next.icp)) next.icp = "";
  if (next.region && !regionSlugs.includes(next.region)) next.region = "";
  return next;
}

export function sameCrmState(a, b) {
  return buildCrmSearch(a) === buildCrmSearch(b);
}

// ── Homes, the Team dashboard and Beta leads (issue #3802, Wave 1) ─────────
//
// The same rules as above: whatever is in the address is untrusted, a value
// that is not plainly well-formed is dropped, and defaults are left out.

/** The Hosts board cut down to one target: an ICP and a region. */
export function targetSliceHash(icp, regionSlug) {
  return buildCrmHash("hosts", { icp, region: regionSlug });
}


/** #/team-dashboard?person=<teammate email>: whose due cards are listed. */
export function parseTeamSearch(search) {
  const state = { person: "" };
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return state;
  }
  const person = params.get("person");
  if (typeof person === "string" && EMAIL.test(person)) state.person = person.toLowerCase();
  return state;
}

export function buildTeamSearch(state) {
  const params = new URLSearchParams();
  const person = typeof state?.person === "string" ? state.person : "";
  if (person && EMAIL.test(person)) params.set("person", person.toLowerCase());
  return params.toString();
}

export const BETA_SHOWS = ["all", "new"];

/** #/beta-leads?show=new: every lead, or only the ones not in Hosts yet. */
export function parseBetaSearch(search) {
  const state = { show: "all" };
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return state;
  }
  if (params.get("show") === "new") state.show = "new";
  return state;
}

export function buildBetaSearch(state) {
  return state?.show === "new" ? "show=new" : "";
}
