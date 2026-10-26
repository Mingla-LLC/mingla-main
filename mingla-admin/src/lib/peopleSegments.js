// Issue #4130 (Wave 3) — the words and shapes behind People, Brands and
// Offerings. Pure module: no React, no Supabase; a node test runs it.
//
// The server decides every number and every segment (admin_people_segments,
// admin_list_people, admin_list_brands_board, admin_list_offerings_board).
// This file only names them in plain English.

import { PROVIDER_LABEL, READINESS, READINESS_LABEL, parseReadinessCode } from "./paymentReadiness.js";

/** People tabs, in order. `id` is the address value (#/people?tab=...). */
export const PEOPLE_TABS = Object.freeze([
  Object.freeze({ id: "explorers", segment: "explorer", label: "Explorers" }),
  Object.freeze({ id: "hosts", segment: "host", label: "Hosts" }),
  Object.freeze({ id: "both", segment: "both", label: "Both" }),
  Object.freeze({ id: "incomplete", segment: "incomplete", label: "Didn't finish sign-up" }),
  Object.freeze({ id: "internal", segment: "internal", label: "Staff and test" }),
]);

export const DEFAULT_PEOPLE_TAB = "explorers";

/** The tab an address asks for, or the default. Never an inherited key. */
export function peopleTabFor(value) {
  return PEOPLE_TABS.find((tab) => tab.id === value) || PEOPLE_TABS.find((tab) => tab.id === DEFAULT_PEOPLE_TAB);
}

/** "Explorers · 75" once the count is known; just the label before. */
export function peopleTabLabel(tab, counts) {
  const value = counts && Number.isFinite(Number(counts[tab.segment])) ? Number(counts[tab.segment]) : null;
  return value === null ? tab.label : `${tab.label} · ${value.toLocaleString()}`;
}

/** A name to show; never invents one. */
export function personDisplayName(row) {
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  return name || "No name yet";
}

const SIGN_IN_LABELS = Object.freeze({ google: "Google", apple: "Apple", email: "Email", phone: "Phone" });

export function signInMethodLabel(value) {
  return (typeof value === "string" && Object.hasOwn(SIGN_IN_LABELS, value) && SIGN_IN_LABELS[value]) || "Not recorded";
}

/** How far someone who never finished got. */
export function gotAsFarAs(row) {
  if (row?.closed_business_account) return "Closed their business account";
  const raw = row?.onboarding_step;
  const step = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  if (Number.isInteger(step) && step > 0) return `Explorer onboarding, step ${step}`;
  if (Number.isInteger(step) && step === 0) return "Started Explorer onboarding";
  return "Signed in, never started onboarding";
}

/** Brand team roles in plain words. */
const ROLE_LABELS = Object.freeze({
  brand_owner: "Owner",
  brand_admin: "Admin",
  event_manager: "Event manager",
  finance_manager: "Finance",
  marketing_manager: "Marketing",
  scanner: "Door scanner",
});

export function brandRoleLabel(role) {
  return (typeof role === "string" && Object.hasOwn(ROLE_LABELS, role) && ROLE_LABELS[role]) || "Team member";
}

// Payment readiness — one owner: Wave 2a's rule (lib/paymentReadiness.js),
// which the server's admin_brand_payment_readiness() applies for the boards
// and returns as '<provider>_<state>'. This only names that code, with the
// Payments page's own words.
const READINESS_VARIANT = Object.freeze({ ready: "success", needs_action: "warning", no_setup: "default" });
const PROVIDER_SHORT = Object.freeze({ paystack: "Paystack", stripe: "Stripe" });

export function paymentReadiness(value) {
  const parsed = parseReadinessCode(value);
  if (!parsed) return null;
  const { provider, state } = parsed;
  const ready = state === READINESS.READY;
  return {
    provider,
    state,
    ready,
    variant: READINESS_VARIANT[state],
    // "Ready · Paystack · NGN", "Needs host action · Stripe · USD".
    label: `${READINESS_LABEL[state]} · ${PROVIDER_LABEL[provider]}`,
    short: ready ? PROVIDER_SHORT[provider] : READINESS_LABEL[state],
  };
}

/** The best readiness across a host's brands (ready beats not ready). */
export function bestReadiness(brands) {
  const list = Array.isArray(brands) ? brands : [];
  const ready = list.map((b) => paymentReadiness(b?.payment_readiness)).filter(Boolean);
  return ready.find((r) => r.ready) || ready[0] || null;
}

/** The Mingla fee column shows only when a brand has its own rate. */
export function feeOverrideLabel(bps) {
  if (bps === null || bps === undefined || bps === "") return null;
  const value = Number(bps);
  if (!Number.isFinite(value)) return null;
  return `${(value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% custom`;
}

export function hasFeeOverride(rows) {
  return (Array.isArray(rows) ? rows : []).some((row) => feeOverrideLabel(row?.take_rate_bps_override) !== null);
}

// Offerings: one state per row, from the server's `state`.
const OFFERING_STATES = Object.freeze({
  on_sale: Object.freeze({ label: "On sale", variant: "success" }),
  happening_now: Object.freeze({ label: "Happening now", variant: "brand" }),
  sales_closed: Object.freeze({ label: "Sales closed", variant: "warning" }),
  private: Object.freeze({ label: "Private link only", variant: "info" }),
  hidden: Object.freeze({ label: "Hidden", variant: "default" }),
  draft: Object.freeze({ label: "Draft", variant: "default" }),
  ended: Object.freeze({ label: "Ended", variant: "default" }),
  cancelled: Object.freeze({ label: "Cancelled", variant: "error" }),
});

export function offeringState(value) {
  return (typeof value === "string" && Object.hasOwn(OFFERING_STATES, value) && OFFERING_STATES[value]) || { label: "Unknown", variant: "default" };
}

export const OFFERING_VIEWS = Object.freeze([
  Object.freeze({ id: "on_sale", label: "On sale and upcoming" }),
  Object.freeze({ id: "drafts", label: "Drafts" }),
  Object.freeze({ id: "past", label: "Past" }),
  Object.freeze({ id: "cancelled", label: "Cancelled" }),
]);

export const DEFAULT_OFFERING_VIEW = "on_sale";

export function offeringViewFor(value) {
  return OFFERING_VIEWS.find((view) => view.id === value) || OFFERING_VIEWS[0];
}

const TYPE_LABELS = Object.freeze({ event: "Event", rsvp: "RSVP", trip: "Trip", experience: "Experience" });

export function offeringTypeLabel(value) {
  return (typeof value === "string" && Object.hasOwn(TYPE_LABELS, value) && TYPE_LABELS[value]) || "Offering";
}

/** Sold for ticketed offerings, going for RSVPs; both when both exist. */
export function soldOrGoing(row) {
  const sold = Number(row?.sold) || 0;
  const going = Number(row?.going) || 0;
  if (row?.event_type === "rsvp") return `${going.toLocaleString()} going`;
  if (going > 0) return `${sold.toLocaleString()} sold · ${going.toLocaleString()} going`;
  return `${sold.toLocaleString()} sold`;
}

/** Brands page: the old pages it now holds, by the `tab` an old address names. */
export const BRAND_TOOL_TABS = Object.freeze({
  websites: Object.freeze({ hosts: "brand-sites", label: "Websites" }),
  venues: Object.freeze({ hosts: "business-venues", label: "Venues" }),
  claims: Object.freeze({ hosts: "claims", label: "Venue claims" }),
});

export function brandToolFor(value) {
  return typeof value === "string" && Object.hasOwn(BRAND_TOOL_TABS, value) ? BRAND_TOOL_TABS[value] : null;
}

/** Plain fields beside the server row, for the table and the CSV. */
export function flattenPersonRow(row) {
  const brands = Array.isArray(row?.brands) ? row.brands : [];
  const readiness = bestReadiness(brands);
  return {
    ...row,
    brand_names: brands.map((b) => b?.name).filter(Boolean).join("; "),
    main_role: brands.length ? brandRoleLabel(brands[0]?.role) : "",
    payments_label: readiness ? readiness.label : "",
    sign_in_label: signInMethodLabel(row?.sign_in_method),
    got_as_far: gotAsFarAs(row),
    internal_reason: row?.internal?.reason || (row?.segment === "internal" ? "Matches the staff and test email rule" : ""),
  };
}
