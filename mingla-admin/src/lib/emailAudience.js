// Issue #4226 — the Email composer's audience words and shapes. Pure module:
// no React, no Supabase; a node test runs it.
//
// The edge function (admin-send-email) decides who matches, reading the same
// people list as the People page (admin_people_directory). This file only
// builds the request and names the answer in plain English.
//
// "Everyone" (Seth, 2026-11-02) is every person on that list: explorers,
// hosts, both, didn't finish sign-up, ticket buyers with no app and host
// contacts with no app. Only the rules leave anyone out (unsubscribed or
// suppressed, no consent where it applies, staff and test, no email,
// duplicates), and the estimate counts each reason and each group.

/** Every segment filter, at its "All" value. Hosts is the default audience. */
export const EMPTY_FILTERS = Object.freeze({
  userType: "host",
  appStatus: "all",
  source: "all",
  city: "all",
  boughtTickets: "all",
  brandId: "all",
  country: "all",
  onboarding: "all",
  accountStatus: "all",
  emailStatus: "all",
  language: "all",
  beta: "all",
  joinedFrom: "",
  joinedTo: "",
});

/** The quick audience buttons, in order. Each segment preset sets userType. */
export const AUDIENCE_PRESETS = Object.freeze([
  Object.freeze({ id: "hosts", label: "Hosts", userType: "host" }),
  Object.freeze({ id: "person", label: "One person" }),
  Object.freeze({ id: "segment", label: "Segment" }),
  Object.freeze({ id: "explorers", label: "Explorer users", userType: "explorer" }),
  Object.freeze({ id: "ticket_buyers", label: "Ticket buyers", userType: "ticket_buyers" }),
  Object.freeze({ id: "host_contacts", label: "Host contacts", userType: "host_contacts" }),
  Object.freeze({ id: "everyone", label: "Everyone" }),
]);

export const APP_STATUS_OPTIONS = Object.freeze([
  Object.freeze({ value: "explorer", label: "Explorer" }),
  Object.freeze({ value: "host", label: "Host" }),
  Object.freeze({ value: "both", label: "Host and Explorer" }),
  Object.freeze({ value: "incomplete", label: "Didn't finish sign-up" }),
  Object.freeze({ value: "ticket_buyer_no_app", label: "Ticket buyer, no app" }),
  Object.freeze({ value: "host_contact_no_app", label: "Host contact, no app" }),
]);

/** #4226: the Source filter — how someone came to Mingla's list. */
export const SOURCE_OPTIONS = Object.freeze([
  Object.freeze({ value: "ticket_buyer", label: "Ticket buyer" }),
  Object.freeze({ value: "host_contact", label: "Host contact" }),
]);

/** #4226: the Everyone breakdown, one line per group, in this order. */
export const EVERYONE_GROUPS = Object.freeze([
  Object.freeze({ key: "explorer", label: "Explorers" }),
  Object.freeze({ key: "host", label: "Hosts" }),
  Object.freeze({ key: "both", label: "Host and Explorer" }),
  Object.freeze({ key: "incomplete", label: "Didn't finish sign-up" }),
  Object.freeze({ key: "ticket_buyer_no_app", label: "Ticket buyers, no app" }),
  Object.freeze({ key: "host_contact_no_app", label: "Host contacts, no app" }),
]);

/** Is this preset the one showing? */
export function presetIsActive(preset, audienceMode, filters) {
  if (preset.userType) return audienceMode === "segment" && filters?.userType === preset.userType;
  return audienceMode === preset.id;
}

/** What choosing a preset does: the next mode and filters. */
export function choosePreset(preset, filters) {
  if (preset.userType) return { audienceMode: "segment", filters: { ...EMPTY_FILTERS, userType: preset.userType } };
  return { audienceMode: preset.id, filters };
}

/** A chosen person: an account (profile_id) or a ticket buyer with no account (email). */
export function isRecipientChosen(recipient) {
  return Boolean(recipient?.profile_id || recipient?.email);
}

/** The audience the edge function receives. */
export function audienceFor(mode, selectedRecipient, filters) {
  if (mode === "person") {
    if (selectedRecipient?.profile_id) return { mode, profileId: selectedRecipient.profile_id };
    if (selectedRecipient?.email) return { mode, email: selectedRecipient.email };
    return { mode, profileId: "" };
  }
  if (mode === "everyone") return { mode, filters: {} };
  return { mode, filters };
}

const n = (value) => Number(value) || 0;

/** Everyone the estimate leaves out, by reason, in plain words. Zeros are hidden. */
export function exclusionReasons(estimate) {
  if (!estimate) return [];
  return [
    { key: "opted_out", label: "unsubscribed", count: n(estimate.opted_out) },
    { key: "no_consent", label: "didn't agree to marketing email", count: n(estimate.no_consent) },
    { key: "internal", label: "staff and test", count: n(estimate.internal) },
    { key: "no_contact", label: "no valid email", count: n(estimate.no_contact) },
    { key: "duplicate", label: "duplicate email", count: n(estimate.duplicate) },
  ].filter((reason) => reason.count > 0);
}

/**
 * Who will receive, by group (estimate.groups from admin-send-email). Every
 * group is listed, zeros included, so a group that went missing shows as 0.
 */
export function groupBreakdown(estimate) {
  if (!estimate || !estimate.groups || typeof estimate.groups !== "object") return [];
  return EVERYONE_GROUPS.map((group) => ({ ...group, count: n(estimate.groups[group.key]) }));
}

/** The audience in a few words, for the send button and the review. */
export function audienceSummary(audienceMode, filters, estimate, selectedRecipient) {
  if (audienceMode === "everyone") {
    return estimate?.will_receive != null ? `Everyone (${estimate.will_receive})` : "Everyone";
  }
  if (audienceMode === "person") return selectedRecipient?.display_name || "One person";
  const count = estimate?.will_receive ?? "—";
  if (filters?.userType === "host") return `${count} Hosts`;
  if (filters?.userType === "explorer") return `${count} Explorer users`;
  if (filters?.userType === "ticket_buyers") return `${count} ticket buyers`;
  if (filters?.userType === "host_contacts") return `${count} host contacts`;
  return `${count} matching people`;
}

/** Campaign history: the active filters of a stored segment audience. */
export function audienceFilterWords(filters) {
  const f = filters || {};
  const status = APP_STATUS_OPTIONS.find((o) => o.value === f.appStatus);
  const source = SOURCE_OPTIONS.find((o) => o.value === f.source);
  const userTypeWords = { ticket_buyers: "ticket buyers", host_contacts: "host contacts" };
  return [
    Object.hasOwn(userTypeWords, f.userType || "") ? userTypeWords[f.userType] : f.userType && f.userType !== "all" ? f.userType : null,
    status ? status.label : null,
    source ? `source: ${source.label.toLowerCase()}` : null,
    f.city && f.city !== "all" ? `event city ${f.city}` : null,
    f.boughtTickets === "yes" ? "bought tickets" : f.boughtTickets === "no" ? "no tickets" : null,
    f.brandId && f.brandId !== "all" ? "one brand" : null,
    f.country && f.country !== "all" ? f.country : null,
    f.onboarding && f.onboarding !== "all" ? f.onboarding : null,
    f.accountStatus && f.accountStatus !== "all" ? f.accountStatus : null,
    f.emailStatus && f.emailStatus !== "all" ? f.emailStatus : null,
    f.language && f.language !== "all" ? f.language : null,
    f.beta && f.beta !== "all" ? f.beta : null,
    f.joinedFrom || f.joinedTo ? "joined date" : null,
  ].filter(Boolean);
}
