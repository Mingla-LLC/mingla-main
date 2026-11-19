// Issue #4226 Phase 2 — the ONE People filter, in plain words. Pure module:
// no React, no Supabase; a node test runs it.
//
// The server owns every rule (admin_people_filter / admin_people_facets /
// admin_people_filter_counts, migration 20281118024226). People and Email both
// send the SAME filter object, so a play's count on Email equals the People
// count. This file names the keys and values, builds the tabs, the Activation
// plays and the hand-off links, and never decides who matches.

/** Every filter key (mirror of admin_people_filter_check; a test pins it). */
export const PEOPLE_FILTER_KEYS = Object.freeze([
  "track",
  "explorer_stage",
  "host_next_step",
  "stopped_step",
  "source",
  "activity_status",
  "country",
  "city",
  "payout_country",
  "bank_connected",
  "joined_window",
  "joined_from",
  "joined_to",
  "brand_id",
  "emails_ok",
  "search",
]);

export const TRACK_LABELS = Object.freeze({
  explorers: "Explorers (incl. Both)",
  hosts: "Hosts (incl. Both)",
  both: "Both apps only",
  signing_up: "Signing up",
  no_account: "No Mingla account yet",
  no_account_buyers: "No account: ticket buyer",
  no_account_contacts: "No account: host contact",
  internal: "Staff and test",
});

export const EXPLORER_STAGES = Object.freeze(["signing_up", "onboarded", "exploring", "connected", "going", "regular"]);
export const EXPLORER_STAGE_LABELS = Object.freeze({
  signing_up: "Signing up",
  onboarded: "Onboarded",
  exploring: "Exploring",
  connected: "Connected",
  going: "Going",
  regular: "Regular",
});

/** The Host checklist, in order (spec D1). */
export const HOST_CHECKLIST = Object.freeze([
  Object.freeze({ key: "host_account", label: "Host account" }),
  Object.freeze({ key: "brand_created", label: "Brand created" }),
  Object.freeze({ key: "payout_country", label: "Payout country set" }),
  Object.freeze({ key: "offering_drafted", label: "First offering drafted" }),
  Object.freeze({ key: "published", label: "Published" }),
  Object.freeze({ key: "bank_connected", label: "Bank connected" }),
  Object.freeze({ key: "first_sale", label: "First sale" }),
  Object.freeze({ key: "repeat_seller", label: "Repeat seller" }),
]);

export const HOST_STEPS = Object.freeze([
  "team_member", "create_brand", "set_payout_country", "draft_offering", "publish",
  "connect_bank", "first_sale", "repeat_sale", "repeat_seller",
]);
export const HOST_STEP_LABELS = Object.freeze({
  team_member: "Team member",
  create_brand: "Next: create a brand",
  set_payout_country: "Next: set payout country",
  draft_offering: "Next: draft an offering",
  publish: "Next: publish",
  connect_bank: "Next: connect bank",
  first_sale: "Next: first sale",
  repeat_sale: "Next: a second offering sells",
  repeat_seller: "Repeat seller",
});

export const SOURCE_LABELS = Object.freeze({
  friend_invite: "Friend invite",
  collab_invite: "Collab invite",
  ticket_link: "Ticket link",
  host_invite: "Host invite",
  referral_link: "Referral link",
  web_ticket_first: "Web ticket first",
  paid_ad: "Paid ad",
  app_store: "App store",
  website: "Website",
  organic: "Organic",
  host_contact: "Host contact",
  web_checkout: "Web checkout",
  beta_lead: "Beta waitlist",
  app_lead: "App waitlist",
  unknown: "Unknown",
});

export const CONFIDENCE_LABELS = Object.freeze({ known: "Known", inferred: "Inferred", unknown: "Not known" });

export const ACTIVITY_LABELS = Object.freeze({
  active: "Active",
  cooling: "Cooling",
  dormant: "Dormant",
  never: "Never active",
});

export const CITY_SOURCE_LABELS = Object.freeze({
  discovery_city: "discovery city",
  custom_location: "custom location",
  event_city: "event city",
  host_city: "host city",
  brand_city: "brand city",
});

export const COUNTRY_SOURCE_LABELS = Object.freeze({
  profile: "profile",
  phone: "from phone",
  host_contact: "from the host",
  payout_country: "payout country",
  event: "event country",
});

const YES_NO = Object.freeze({ yes: "Yes", no: "No" });
const JOINED = Object.freeze({ "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" });

const own = (map, value) => (typeof value === "string" && Object.hasOwn(map, value) ? map[value] : null);

/** The plain words for one filter value. Unknown values show as they are. */
export function optionLabel(key, value, fallback) {
  const text = value === null || value === undefined ? "" : String(value);
  switch (key) {
    case "track": return own(TRACK_LABELS, text) || text;
    case "explorer_stage": return own(EXPLORER_STAGE_LABELS, text) || text;
    case "host_next_step": return own(HOST_STEP_LABELS, text) || text;
    case "source": return own(SOURCE_LABELS, text) || text;
    case "activity_status": return own(ACTIVITY_LABELS, text) || text;
    case "stopped_step": return text === "none" ? "Step not recorded" : `Stopped at step ${text}`;
    case "bank_connected": return own(YES_NO, text) || text;
    case "emails_ok": return own(YES_NO, text) || text;
    case "joined_window": return own(JOINED, text) || text;
    case "brand_id": return fallback || "A brand";
    default: return fallback || text;
  }
}

export const FILTER_LABELS = Object.freeze({
  track: "Track",
  explorer_stage: "Explorer stage",
  host_next_step: "Host next step",
  stopped_step: "Where they stopped",
  source: "Source",
  activity_status: "Activity",
  country: "Country",
  city: "City",
  payout_country: "Payout country",
  bank_connected: "Bank connected",
  joined_window: "Joined",
  joined_from: "Joined from",
  joined_to: "Joined through",
  brand_id: "Added by or bought from",
  emails_ok: "Emails OK",
  search: "Search",
});

/** Only the keys that narrow: no empty, "all" or unknown keys. Never mutates. */
export function cleanFilter(filter) {
  const out = {};
  if (!filter || typeof filter !== "object") return out;
  for (const key of PEOPLE_FILTER_KEYS) {
    const raw = filter[key];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (!value || value === "all") continue;
    out[key] = value;
  }
  return out;
}

/** Removable chips for a filter (the track is shown, not removable by chip). */
export function filterChips(filter, brandNames = {}) {
  const clean = cleanFilter(filter);
  return Object.entries(clean).map(([key, value]) => ({
    key,
    removable: key !== "track",
    label: `${FILTER_LABELS[key] || key}: ${optionLabel(key, value, key === "brand_id" ? brandNames[value] : undefined)}`,
  }));
}

/** A filter without one key (a chip's ×). */
export function withoutKey(filter, key) {
  const next = { ...cleanFilter(filter) };
  delete next[key];
  return next;
}

// ── People tabs ─────────────────────────────────────────────────────────────
// Each tab is a track plus the strip (a stage filter) and the filters it
// offers. Options always come from admin_people_facets: values that exist in
// the tab, with how many people each would give.
export const JOURNEY_TABS = Object.freeze([
  Object.freeze({
    id: "explorers", label: "Explorers", track: "explorers",
    note: "Includes people on both apps.",
    strip: "explorer_stage", stripTitle: "Explorer stage",
    stripOrder: ["onboarded", "exploring", "connected", "going", "regular"],
    filters: ["source", "activity_status", "country", "city", "joined_window"],
  }),
  Object.freeze({
    id: "hosts", label: "Hosts", track: "hosts",
    note: "Includes people on both apps.",
    strip: "host_next_step", stripTitle: "Hosts by next step",
    stripOrder: ["create_brand", "set_payout_country", "draft_offering", "publish", "connect_bank", "first_sale", "repeat_sale", "repeat_seller", "team_member"],
    filters: ["bank_connected", "payout_country", "activity_status", "city", "source", "joined_window"],
  }),
  Object.freeze({
    id: "both", label: "Both apps", track: "both",
    note: "People who use the Explorer app and host.",
    strip: "host_next_step", stripTitle: "Both apps by host next step",
    stripOrder: ["create_brand", "set_payout_country", "draft_offering", "publish", "connect_bank", "first_sale", "repeat_sale", "repeat_seller", "team_member"],
    filters: ["explorer_stage", "activity_status", "country", "source"],
  }),
  Object.freeze({
    id: "signing", label: "Signing up", track: "signing_up",
    note: "Made an account, never finished Explorer onboarding, not a host.",
    strip: "stopped_step", stripTitle: "Where they stopped",
    stripOrder: null,
    filters: ["country", "source", "activity_status", "joined_window"],
  }),
  Object.freeze({
    id: "noaccount", label: "No account yet", track: "no_account",
    note: "People we can reach who never made a Mingla account.",
    strip: "track", stripTitle: "People with no Mingla account",
    stripOrder: ["no_account_buyers", "no_account_contacts"],
    stripLabels: { no_account_buyers: "Bought a ticket", no_account_contacts: "Host contact, never bought" },
    filters: ["brand_id", "city", "country", "emails_ok"],
  }),
  Object.freeze({
    id: "staff", label: "Staff and test", track: "internal",
    note: "Never emailed in bulk; left out of every other tab and count.",
    strip: null, stripTitle: null, stripOrder: null,
    filters: ["source", "activity_status"],
  }),
]);

export const DEFAULT_JOURNEY_TAB = "explorers";

// Old addresses (#/people?tab=incomplete, ticket-buyers, host-contacts, internal).
const TAB_ALIASES = Object.freeze({
  incomplete: "signing",
  "ticket-buyers": "noaccount",
  "host-contacts": "noaccount",
  internal: "staff",
});

export function journeyTabFor(value) {
  const id = typeof value === "string" && Object.hasOwn(TAB_ALIASES, value) ? TAB_ALIASES[value] : value;
  return JOURNEY_TABS.find((tab) => tab.id === id) || JOURNEY_TABS.find((tab) => tab.id === DEFAULT_JOURNEY_TAB);
}

/**
 * The filter a tab sends: its track, the strip choice and the filters. The
 * "No account yet" strip narrows the track itself (buyers or contacts).
 */
export function tabFilter(tab, { strip = null, filters = {}, search = "" } = {}) {
  const base = { ...cleanFilter(filters) };
  delete base.track;
  const out = { track: tab.track, ...base };
  if (strip && tab.strip === "track") out.track = strip;
  else if (strip && tab.strip) out[tab.strip] = strip;
  if (search && search.trim()) out.search = search.trim();
  return cleanFilter(out);
}

/** Same filter (ignoring blanks and key order)? */
export function sameFilter(a, b) {
  const x = cleanFilter(a);
  const y = cleanFilter(b);
  const kx = Object.keys(x);
  return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
}

/**
 * The play (or saved group) the current filter is. The chosen id wins when its
 * filter is still the current one; otherwise the first play with this exact
 * filter; otherwise none. So the highlighted card, the suggested message and
 * the starting point always belong to the audience that is really selected.
 */
export function playForFilter(plays, filter, playId = null) {
  const list = Array.isArray(plays) ? plays : [];
  const chosen = playId ? list.find((p) => p.id === playId) : null;
  if (chosen && sameFilter(chosen.filter, filter)) return chosen;
  return list.find((p) => sameFilter(p.filter, filter)) || null;
}

/**
 * What "Use as a starting point" puts in the draft: the group's own name as the
 * subject and its own message as the body. A subject or body the person wrote
 * is kept; one this button filled in for a previous group is replaced.
 */
export function startingPoint(play, { subject = "", bodyText = "", lastAutoSubject = "", lastAutoBody = "" } = {}) {
  const subjectFree = !String(subject).trim() || subject === lastAutoSubject;
  const bodyFree = !String(bodyText).trim() || bodyText === lastAutoBody;
  return {
    subject: subjectFree ? play.name : null,
    message: bodyFree && play.message ? play.message : null,
  };
}

/** Strip buttons from facets, in the tab's order, zeros kept visible but inert. */
export function stripOptions(tab, facets, counts) {
  if (!tab.strip) return [];
  if (tab.strip === "track") {
    return tab.stripOrder.map((value) => ({
      value,
      label: tab.stripLabels?.[value] || optionLabel("track", value),
      count: Number(counts?.[value] ?? 0),
    }));
  }
  const options = Array.isArray(facets?.[tab.strip]) ? facets[tab.strip] : [];
  const byValue = new Map(options.map((o) => [String(o.value), Number(o.count) || 0]));
  const order = tab.stripOrder || [...byValue.keys()].sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : Number(a) - Number(b)));
  return order.map((value) => ({ value, label: optionLabel(tab.strip, value), count: byValue.get(value) || 0 }));
}

/** Select options for one filter: only values that exist, each with a count. */
export function facetOptions(key, facets) {
  const options = Array.isArray(facets?.[key]) ? facets[key] : [];
  return options
    .filter((o) => Number(o.count) > 0 && o.value !== null && o.value !== undefined && o.value !== "")
    .map((o) => ({
      value: String(o.value),
      label: `${optionLabel(key, o.value, o.label)} (${Number(o.count).toLocaleString()})`,
      count: Number(o.count),
    }));
}

// ── Labels on rows ──────────────────────────────────────────────────────────
export function stageLabel(row) {
  if (!row) return "";
  if (row.person_kind === "internal") return "Staff and test";
  if (row.person_kind === "no_account_buyer") return "Bought a ticket";
  if (row.person_kind === "no_account_contact") return "Host contact, never bought";
  if (row.explorer_stage === "signing_up") {
    return row.explorer_stopped_step === null || row.explorer_stopped_step === undefined
      ? "Step not recorded"
      : `Stopped at step ${row.explorer_stopped_step}`;
  }
  const parts = [];
  if (row.explorer_stage) parts.push(EXPLORER_STAGE_LABELS[row.explorer_stage] || row.explorer_stage);
  if (row.host_next_step) {
    if (row.host_next_step === "team_member") {
      const team = row.host_checklist?.team_brands?.[0]?.name;
      parts.push(team ? `Team member at ${team}` : "Team member");
    } else {
      parts.push(HOST_STEP_LABELS[row.host_next_step] || row.host_next_step);
    }
  }
  return parts.join(" · ");
}

export function sourceLabel(row) {
  return own(SOURCE_LABELS, row?.source) || "Unknown";
}

export function confidenceLabel(row) {
  const base = own(CONFIDENCE_LABELS, row?.source_confidence) || "Not known";
  return row?.source_detail ? `${base} · ${row.source_detail}` : base;
}

export function placeLabel(row) {
  const city = row?.city ? `${row.city}` : "No city yet";
  return row?.country ? `${city}, ${row.country}` : city;
}

export function placeSourceLabel(row) {
  const parts = [];
  parts.push(row?.city_source ? own(CITY_SOURCE_LABELS, row.city_source) || row.city_source : "no city saved");
  if (row?.country_source) parts.push(`country ${own(COUNTRY_SOURCE_LABELS, row.country_source) || row.country_source}`);
  return parts.join(" · ");
}

export function activityLabel(row) {
  return own(ACTIVITY_LABELS, row?.activity_status) || "";
}

export function goingLabel(row) {
  const n = (v) => Number(v) || 0;
  const parts = [];
  if (n(row?.ticket_count)) parts.push(`${n(row.ticket_count)} ${n(row.ticket_count) === 1 ? "ticket" : "tickets"}`);
  if (n(row?.rsvp_count)) parts.push(`${n(row.rsvp_count)} ${n(row.rsvp_count) === 1 ? "RSVP" : "RSVPs"}`);
  if (n(row?.experience_count)) parts.push(`${n(row.experience_count)} ${n(row.experience_count) === 1 ? "experience" : "experiences"}`);
  return parts.length ? parts.join(" · ") : "0 bookings";
}

export function hostSummaryLabel(row) {
  const brands = Number(row?.brand_count) || 0;
  const live = Number(row?.published_count) || 0;
  if (!brands) return row?.host_next_step === "team_member" ? "On a brand team" : "No brand yet";
  return `${brands} ${brands === 1 ? "brand" : "brands"} · ${live} published`;
}

// ── The person panel ────────────────────────────────────────────────────────
const TABS_BY_KIND = Object.freeze({
  explorer: ["journey", "going", "social", "activity", "support"],
  host: ["journey", "brands", "money", "activity", "support"],
  both: ["journey", "going", "brands", "money", "social", "activity", "support"],
  signing_up: ["journey", "activity", "support"],
  internal: ["journey", "activity", "support"],
  no_account_buyer: ["details"],
  no_account_contact: ["details"],
});
const PANEL_TAB_LABELS = Object.freeze({
  journey: "Journey", going: "Going", social: "Social", activity: "Activity",
  support: "Support", brands: "Brands", money: "Money", details: "Details",
});

/** The panel's tabs for a kind of person. Non-hosts never get Brands or Money. */
export function panelTabsFor(kind) {
  const ids = own(TABS_BY_KIND, kind) || TABS_BY_KIND.explorer;
  return ids.map((id) => ({ id, label: PANEL_TAB_LABELS[id] }));
}

export function isHostKind(kind) {
  return kind === "host" || kind === "both";
}

/** The checklist with the next step marked (first unticked item). */
export function hostChecklistView(checklist) {
  const items = Array.isArray(checklist?.items) ? checklist.items : [];
  const byKey = new Map(items.map((item) => [item.key, item]));
  let nextMarked = false;
  return HOST_CHECKLIST.map((step) => {
    const item = byKey.get(step.key) || {};
    const done = item.done === true;
    const next = !done && !nextMarked;
    if (next) nextMarked = true;
    return { key: step.key, label: step.label, done, next, at: item.at || null };
  });
}

/** The Explorer ladder: done up to the current stage. */
export function explorerLadder(stage) {
  const index = EXPLORER_STAGES.indexOf(stage);
  return EXPLORER_STAGES.map((key, i) => ({
    key,
    label: EXPLORER_STAGE_LABELS[key],
    done: index >= 0 && i <= index,
    current: i === index,
  }));
}

// ── Activation plays (spec D8 + D10) ────────────────────────────────────────
// Each play is a saved People filter. Email counts it with the same function
// People uses; "Edit filters" opens it in the builder.
export const ACTIVATION_PLAYS = Object.freeze([
  Object.freeze({ id: "stuck", group: "Explorers", name: "Stuck in sign-up", who: "Made an account but stopped during onboarding.", goal: "Onboarded",
    filter: Object.freeze({ track: "signing_up" }),
    message: "You're one step away: finish setting up and we'll show you what's on near you this weekend." }),
  Object.freeze({ id: "nosave", group: "Explorers", name: "Onboarded, never saved", who: "Finished onboarding, no saves or swipes since.", goal: "Exploring",
    filter: Object.freeze({ track: "explorers", explorer_stage: "onboarded" }),
    message: "Here are five things happening in your city this week. Save one to get a reminder." }),
  Object.freeze({ id: "dormant", group: "Explorers", name: "Going, now dormant", who: "Had a ticket, RSVP or booking, inactive for 30+ days.", goal: "Going again",
    filter: Object.freeze({ track: "explorers", explorer_stage: "going", activity_status: "dormant" }),
    message: "New events from hosts you've been to are live. Take a look." }),
  Object.freeze({ id: "nobrand", group: "Hosts", name: "Hosts with no brand", who: "Opened the Host app but never finished creating a brand.", goal: "Brand created",
    filter: Object.freeze({ track: "hosts", host_next_step: "create_brand" }),
    message: "Set up your brand in five minutes, and we'll help you publish your first event." }),
  Object.freeze({ id: "nooffer", group: "Hosts", name: "Brand, no offering", who: "Created a brand, never drafted an event or experience.", goal: "First draft",
    filter: Object.freeze({ track: "hosts", host_next_step: "draft_offering" }),
    message: "Your brand is ready. Here's a template to draft your first event." }),
  Object.freeze({ id: "draft", group: "Hosts", name: "Draft, not published", who: "Has a draft, nothing published yet.", goal: "Published",
    filter: Object.freeze({ track: "hosts", host_next_step: "publish" }),
    message: "Your draft is nearly there. Publish it and start selling today." }),
  Object.freeze({ id: "nobank", group: "Hosts", name: "Published, no bank", who: "Has a live offering but no bank connected, so can't be paid.", goal: "Bank connected",
    filter: Object.freeze({ track: "hosts", host_next_step: "connect_bank" }),
    message: "You have a live event. Connect your bank so ticket money reaches you after each sale." }),
  Object.freeze({ id: "nosale", group: "Hosts", name: "Bank connected, no sale", who: "Ready to be paid, no ticket sold yet.", goal: "First sale",
    filter: Object.freeze({ track: "hosts", host_next_step: "first_sale" }),
    message: "Three ways hosts like you got their first ten sales." }),
  Object.freeze({ id: "buyers", group: "No Mingla account yet", name: "Ticket buyers, no account", who: "Bought on the web, never made a Mingla account. Marketing consent only.", goal: "Get the Explorer app",
    filter: Object.freeze({ track: "no_account_buyers" }),
    message: "Your tickets live in the Mingla app, plus what's on next from the hosts you love." }),
  Object.freeze({ id: "contacts", group: "No Mingla account yet", name: "Host contacts, never bought", who: "Uploaded by a host, never bought a ticket, no Mingla account.", goal: "First ticket",
    filter: Object.freeze({ track: "no_account_contacts" }),
    message: "Here's what's coming up from hosts in your city. Grab a spot before it sells out." }),
]);

export const PLAY_GROUPS = Object.freeze(["Explorers", "Hosts", "No Mingla account yet"]);

/** The audience admin-send-email receives for a People filter. */
export function peopleAudience(filter) {
  return { mode: "people", people: cleanFilter(filter) };
}

// ── Hand-off links (People ⇄ Email) ─────────────────────────────────────────
export function encodeFilter(filter) {
  return encodeURIComponent(JSON.stringify(cleanFilter(filter)));
}

/** A filter from an address value; anything unreadable is "no filter". */
export function decodeFilter(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value.startsWith("%7B") || value.startsWith("%7b") ? decodeURIComponent(value) : value);
    const clean = cleanFilter(parsed);
    return Object.keys(clean).length ? clean : null;
  } catch {
    return null;
  }
}

/** "Email these N people": the composer, with this filter preloaded. */
export function emailHrefFor(filter) {
  return `#/email?compose=1&people=${encodeFilter(filter)}`;
}

/** "Email this person": the composer's One person search, prefilled. */
export function recipientHrefFor(email) {
  return `#/email?compose=1&recipient=${encodeURIComponent(String(email || "").trim())}`;
}

/** The recipient an Email address carries (#/email?recipient=...). */
export function recipientFromHash(hash) {
  const raw = typeof hash === "string" ? hash : "";
  const at = raw.indexOf("?");
  if (at < 0) return null;
  const value = (new URLSearchParams(raw.slice(at + 1)).get("recipient") || "").trim();
  return value.length >= 2 && value.length <= 320 ? value : null;
}

/** The People filter an Email address carries (#/email?people=...). */
export function peopleFilterFromHash(hash) {
  const raw = typeof hash === "string" ? hash : "";
  const at = raw.indexOf("?");
  if (at < 0) return null;
  return decodeFilter(new URLSearchParams(raw.slice(at + 1)).get("people"));
}

/** "See these people in People": the tab that fits the track. */
export function peopleHrefFor(filter) {
  const clean = cleanFilter(filter);
  const tab = JOURNEY_TABS.find((t) => t.track === clean.track)
    || (clean.track === "no_account_buyers" || clean.track === "no_account_contacts" ? JOURNEY_TABS.find((t) => t.id === "noaccount") : null)
    || JOURNEY_TABS[0];
  return `#/people?tab=${tab.id}&f=${encodeFilter(clean)}`;
}

// ── Saved groups ────────────────────────────────────────────────────────────
// [TRANSITIONAL] Saved groups live in this browser (localStorage) until a
// server table for saved audiences exists — exit: a shared, audited
// admin_email_saved_groups table read by Email. No server storage for
// audiences exists today (email_templates holds message bodies only).
export const SAVED_GROUPS_KEY = "mingla_admin_people_groups_v1";

export function readSavedGroups(storage) {
  try {
    const raw = storage?.getItem(SAVED_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((g) => g && typeof g.id === "string" && typeof g.name === "string").map((g) => ({
        id: g.id, name: g.name, who: String(g.who || ""), filter: cleanFilter(g.filter), group: "Your saved groups", goal: "Your call", message: "",
      }))
      : [];
  } catch {
    return [];
  }
}

/** Save a group; returns the new list. Throws when the browser refuses. */
export function saveGroup(storage, groups, { name, filter }) {
  const clean = cleanFilter(filter);
  if (!Object.keys(clean).length) throw new Error("Add at least one filter before saving a group.");
  const entry = {
    id: `saved-${Date.now().toString(36)}`,
    name: String(name || "").trim() || `Saved group ${groups.length + 1}`,
    who: filterChips(clean).map((c) => c.label).join(" · "),
    filter: clean,
  };
  const next = [...groups, { ...entry, group: "Your saved groups", goal: "Your call", message: "" }];
  storage.setItem(SAVED_GROUPS_KEY, JSON.stringify(next.map(({ id, name: n, who, filter: f }) => ({ id, name: n, who, filter: f }))));
  return next;
}
