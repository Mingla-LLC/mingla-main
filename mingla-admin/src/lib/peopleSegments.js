// Issue #4130 (Wave 3) — the words and shapes behind People, Brands and
// Offerings. Pure module: no React, no Supabase; a node test runs it.
//
// The server decides every number and every segment (admin_people_segments,
// admin_list_people, admin_list_brands_board, admin_list_offerings_board).
// This file only names them in plain English.

import { PROVIDER_LABEL, READINESS, READINESS_LABEL, parseReadinessCode } from "./paymentReadiness.js";
import { joinMoneyAmounts } from "./moneyFormat.js";

/** People tabs, in order. `id` is the address value (#/people?tab=...). */
export const PEOPLE_TABS = Object.freeze([
  Object.freeze({ id: "explorers", segment: "explorer", label: "Explorers" }),
  Object.freeze({ id: "hosts", segment: "host", label: "Hosts" }),
  Object.freeze({ id: "both", segment: "both", label: "Both" }),
  Object.freeze({ id: "incomplete", segment: "incomplete", label: "Didn't finish sign-up" }),
  Object.freeze({ id: "internal", segment: "internal", label: "Staff and test" }),
  // #4226: anyone with a paid ticket who has not finished Explorer onboarding
  // (no account, or an account that never onboarded). Not a partition: an
  // account holder here keeps their own tab too.
  Object.freeze({ id: "ticket-buyers", segment: "ticket_buyer_no_app", label: "Ticket buyers, no app" }),
]);

export const DEFAULT_PEOPLE_TAB = "explorers";

/**
 * The staff and test email rule. Mirror of the server's
 * admin_internal_email_rule() (migration 20280113004130); a pg17 suite and a
 * node test pin the same cases on both sides. A row in admin_internal_accounts
 * still overrides it on the server.
 *   - domain usemingla.com, or example.com / .org / .net; or
 *   - domain ends with a reserved test name (.test, .invalid, .example,
 *     .localhost; whole last label only, so mytest.com is a real person); or
 *   - domain cloudtestlabaccounts.com (Google's test devices); or
 *   - the part before the @ starts with "test", or has "test" as its own token
 *     between . _ - + or digits. "contest" or "greatest" is a real person.
 */
export function isInternalEmail(email) {
  const value = typeof email === "string" ? email.trim().toLowerCase() : "";
  const at = value.lastIndexOf("@");
  if (at < 0) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (["usemingla.com", "example.com", "example.org", "example.net", "cloudtestlabaccounts.com"].includes(domain)) return true;
  if (/\.(test|invalid|example|localhost)$/.test(domain)) return true;
  return /^test/.test(local) || /(^|[._+0-9-])test($|[._+0-9-])/.test(local);
}

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

// #4226 — ticket facts in plain words.
const APP_STATUS_WORDS = Object.freeze({
  explorer: "Explorer",
  host: "Host",
  both: "Host and Explorer",
  incomplete: "Didn't finish sign-up",
  ticket_buyer_no_app: "No app yet",
});

export function appStatusLabel(value) {
  return (typeof value === "string" && Object.hasOwn(APP_STATUS_WORDS, value) && APP_STATUS_WORDS[value]) || "Unknown";
}

const CONSENT_WORDS = Object.freeze({
  yes: Object.freeze({ label: "Yes", variant: "success" }),
  no: Object.freeze({ label: "No", variant: "default" }),
  unsubscribed: Object.freeze({ label: "Unsubscribed", variant: "warning" }),
});

/** "Emails OK": may Mingla send this person marketing email? */
export function marketingConsent(value) {
  return (typeof value === "string" && Object.hasOwn(CONSENT_WORDS, value) && CONSENT_WORDS[value]) || CONSENT_WORDS.no;
}

/**
 * Money spent, one amount per currency, never summed across currencies
 * (Constitution #10). `spent` is { "NGN": 104500, "USD": 1000 } in minor
 * units. Free tickets only: "Free".
 */
export function spentLabel(spent) {
  const entries = spent && typeof spent === "object" ? Object.entries(spent) : [];
  const parts = entries
    .filter(([code, cents]) => /^[A-Z]{3}$/.test(code) && Number(cents) > 0)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([currency, cents]) => ({ cents: Number(cents), currency }));
  return parts.length ? joinMoneyAmounts(parts) : "Free";
}

/** Plain fields beside the server row, for the table and the CSV. */
export function flattenPersonRow(row) {
  const brands = Array.isArray(row?.brands) ? row.brands : [];
  const readiness = bestReadiness(brands);
  const bought = Array.isArray(row?.brands_bought) ? row.brands_bought : [];
  return {
    ...row,
    row_key: row?.id || row?.person_key || row?.email || "",
    app_status_label: appStatusLabel(row?.app_status),
    spent_label: row?.spent ? spentLabel(row.spent) : "",
    emails_ok_label: marketingConsent(row?.marketing_consent).label,
    brands_bought_names: bought.map((b) => b?.name).filter(Boolean).join("; "),
    brand_names: brands.map((b) => b?.name).filter(Boolean).join("; "),
    main_role: brands.length ? brandRoleLabel(brands[0]?.role) : "",
    payments_label: readiness ? readiness.label : "",
    sign_in_label: signInMethodLabel(row?.sign_in_method),
    got_as_far: gotAsFarAs(row),
    internal_reason: row?.internal?.reason || (row?.segment === "internal" ? "Matches the staff and test email rule" : ""),
  };
}

/**
 * #4130: the brand-level staff/test state in words, and the actions offered.
 * A recorded decision beats the owner account; with none, the owner decides.
 */
export function brandInternalView(row, internalNow = row?.internal === true) {
  const decision = row?.internal_decision && typeof row.internal_decision === "object" ? row.internal_decision : null;
  const internal = internalNow === true;
  const why = decision
    ? `${decision.is_internal ? "Marked as staff or test" : "Marked as a real host"} by ${decision.marked_by}: ${decision.reason}.`
    : internal
      ? "Its owner is a staff or test account."
      : "Its owner is a real account.";
  return {
    internal,
    label: internal ? "Left out of host counts" : "Counted as a real host",
    why,
    action: internal ? "real" : "internal",
    actionLabel: internal ? "Treat as a real host…" : "Treat as staff or test…",
    canClear: !!decision,
  };
}
