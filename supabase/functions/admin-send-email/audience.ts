// #4226 — who an admin email reaches.
//
// Every audience reads ONE list of people: the admin-only SQL function
// public.admin_people_directory() (migrations 20280301004226 and
// 20280302004226), the same list the People page and the Data room read. It
// holds every account (with the People classifier's app status: explorer,
// host, both, incomplete), every ticket buyer or holder with no account
// ('ticket_buyer_no_app') and every host contact with neither
// ('host_contact_no_app').
//
// Audiences:
//   Everyone       EVERY person on the list (Seth, 2026-11-02): explorers,
//                  hosts, both, didn't finish sign-up, ticket buyers with no
//                  app, host contacts with no app. No filter at all; the
//                  snapshot leaves out only what the rules exclude.
//   Explorers      app status explorer or both
//   Hosts          app status host or both
//   Ticket buyers  anyone with a paid ticket (bought, comp'd or held),
//                  whatever their app status
//   Host contacts  anyone a host imported or added to their contact book,
//                  whatever their app status
// Segment filters narrow any of these: app status, source (ticket buyer /
// host contact), event city, country, bought tickets (yes / no), brand bought
// from, and the #3720 profile filters.
//
// Left out of every bulk send, and counted by reason: staff and test
// (is_internal), no valid email, duplicate email, unsubscribed or suppressed
// (Mingla-wide, or by a brand that added them as a host contact — the list
// reports that as marketing_consent 'unsubscribed'), and no marketing consent
// where consent applies: people with no account (ticket buyers and host
// contacts) and anyone reached through the Ticket buyers or Host contacts
// audience need consent 'yes'. Accounts keep their existing rule.
import type { AudienceDefinition, RecipientProfile } from "./model.ts";

export const DIRECTORY_COLUMNS = [
  "person_key",
  "user_id",
  "email",
  "name",
  "first_name",
  "display_name",
  "username",
  "country",
  "preferred_language",
  "created_at",
  "segment",
  "app_status",
  "is_internal",
  "is_ticket_holder",
  "in_ticket_buyer_segment",
  "marketing_consent",
  "last_event_city",
  "event_cities",
  "brand_ids",
  "brands",
  "has_completed_onboarding",
  "email_verified",
  "active",
  "is_beta_tester",
  "is_host_contact",
  "host_brand_ids",
  "host_city",
  "consent_basis",
].join(",");

export const APP_STATUSES = [
  "explorer",
  "host",
  "both",
  "incomplete",
  "ticket_buyer_no_app",
  "host_contact_no_app",
] as const;

const WITH_APP = ["explorer", "host", "both"];

/** People with no Mingla account: marketing needs their consent 'yes'. */
export const NO_ACCOUNT_STATUSES = [
  "ticket_buyer_no_app",
  "host_contact_no_app",
];

/** The Everyone breakdown, in display order (app status of each person). */
export const EVERYONE_GROUPS = [...APP_STATUSES];

export interface DirectoryRow {
  person_key?: string | null;
  user_id?: string | null;
  email?: string | null;
  name?: string | null;
  first_name?: string | null;
  display_name?: string | null;
  username?: string | null;
  country?: string | null;
  preferred_language?: string | null;
  created_at?: string | null;
  segment?: string | null;
  app_status?: string | null;
  is_internal?: boolean | null;
  is_ticket_holder?: boolean | null;
  in_ticket_buyer_segment?: boolean | null;
  marketing_consent?: string | null;
  last_event_city?: string | null;
  event_cities?: string[] | null;
  brands?: Array<{ id: string; name: string }> | null;
  is_host_contact?: boolean | null;
  host_brand_ids?: string[] | null;
  host_city?: string | null;
  consent_basis?: string | null;
}

/** A Postgres array literal of one text element, safely quoted for `cs`. */
export function arrayLiteral(value: string): string {
  return `{"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`;
}

/** Narrow a PostgREST query on admin_people_directory() to an audience. */
export function applyDirectoryFilters(
  // deno-lint-ignore no-explicit-any
  query: any,
  audience: AudienceDefinition,
) {
  if (audience.mode === "person") {
    if (audience.profileId) return query.eq("user_id", audience.profileId);
    return query.eq("email", String(audience.email ?? "").toLowerCase().trim());
  }
  // Everyone is everyone: the whole list, no filter (#4226).
  if (audience.mode === "everyone") return query;

  const filters = audience.filters ?? {};
  const userType = filters.userType ?? "all";
  const appStatus = filters.appStatus && filters.appStatus !== "all"
    ? filters.appStatus
    : null;
  const source = filters.source && filters.source !== "all"
    ? filters.source
    : null;
  if (userType === "host") query = query.in("app_status", ["host", "both"]);
  else if (userType === "explorer") {
    query = query.in("app_status", ["explorer", "both"]);
  } else if (userType === "ticket_buyers") {
    query = query.eq("is_ticket_holder", true);
  } else if (userType === "host_contacts") {
    query = query.eq("is_host_contact", true);
  } else if (!appStatus && !source) {
    // "All users" without an app-status or source filter means people with
    // an app (the segment builder's starting point; Everyone is its own mode).
    query = query.in("app_status", WITH_APP);
  }
  if (appStatus) query = query.eq("app_status", appStatus);
  if (source === "ticket_buyer") query = query.eq("is_ticket_holder", true);
  if (source === "host_contact") query = query.eq("is_host_contact", true);
  if (filters.boughtTickets === "yes") {
    query = query.eq("is_ticket_holder", true);
  }
  if (filters.boughtTickets === "no") {
    query = query.eq("is_ticket_holder", false);
  }
  if (filters.city && filters.city !== "all") {
    query = query.contains("event_cities", arrayLiteral(filters.city));
  }
  if (filters.brandId && filters.brandId !== "all") {
    query = query.contains("brand_ids", arrayLiteral(filters.brandId));
  }
  if (filters.country && filters.country !== "all") {
    query = query.eq("country", filters.country);
  }
  if (filters.onboarding === "completed") {
    query = query.eq("has_completed_onboarding", true);
  }
  if (filters.onboarding === "incomplete") {
    query = query.eq("has_completed_onboarding", false);
  }
  if (filters.accountStatus === "active") query = query.eq("active", true);
  if (filters.accountStatus === "inactive") query = query.eq("active", false);
  if (filters.emailStatus === "verified") {
    query = query.eq("email_verified", true);
  }
  if (filters.emailStatus === "unverified") {
    query = query.eq("email_verified", false);
  }
  if (filters.language && filters.language !== "all") {
    query = query.eq("preferred_language", filters.language);
  }
  if (filters.beta === "beta") query = query.eq("is_beta_tester", true);
  if (filters.beta === "non_beta") query = query.eq("is_beta_tester", false);
  if (filters.joinedFrom) {
    query = query.gte("created_at", `${filters.joinedFrom}T00:00:00.000Z`);
  }
  if (filters.joinedTo) {
    query = query.lte("created_at", `${filters.joinedTo}T23:59:59.999Z`);
  }
  return query;
}

/** Does this recipient need a marketing 'yes' to be sent to? */
export function requiresMarketingConsent(
  audience: AudienceDefinition,
  row: RecipientProfile,
): boolean {
  // #4452 A1.5: a Leads list send is marketing (always 'yes'); a one-to-one
  // reply to a lead is not.
  if (audience.mode === "leads") return true;
  if (audience.mode === "lead_reply") return false;
  if (
    audience.mode === "segment" &&
    (audience.filters?.userType === "ticket_buyers" ||
      audience.filters?.userType === "host_contacts")
  ) return true;
  return NO_ACCOUNT_STATUSES.includes(String(row.app_status ?? ""));
}

/** One directory row as the recipient shape the composer personalises. */
export function directoryRowToRecipient(row: DirectoryRow): RecipientProfile {
  return {
    id: row.user_id ?? null,
    email: row.email ?? null,
    first_name: row.first_name ?? null,
    display_name: row.display_name ?? row.name ?? null,
    username: row.username ?? null,
    country: row.country ?? null,
    preferred_language: row.preferred_language ?? null,
    created_at: row.created_at ?? null,
    segment: row.segment ?? null,
    app_status: row.app_status ?? null,
    is_internal: row.is_internal === true,
    marketing_consent: row.marketing_consent ?? null,
  };
}

const APP_STATUS_LABELS: Record<string, string> = {
  explorer: "Explorer",
  host: "Host",
  both: "Host and Explorer",
  incomplete: "Didn't finish sign-up",
  ticket_buyer_no_app: "Ticket buyer, no app",
  host_contact_no_app: "Host contact, no app",
};

export function appStatusLabel(value: string | null | undefined): string {
  return (value && APP_STATUS_LABELS[value]) || "Unknown";
}

// ── #4452 A1.5: leads, through the existing composer (no new sender) ───────
//
// A Leads list selection is resolved by public.leads_audience_resolve (service
// role only; it refuses another actor's or an expired selection), and a reply
// reads the one lead through admin_lead_get as the caller. Each row becomes the
// recipient shape the composer personalises, with app_status 'lead'; the
// existing snapshotAudience then leaves out staff/test, invalid, duplicate,
// suppressed and (for "leads") no-consent people under its existing reasons.
//
// MINGLA-INVARIANT: I-4452-LEADS-EMAIL-CONSENT | issue #4452 | a Leads list send reaches only
// marketing_consent 'yes' people; a reply is blocked only by a full ('all') opt-out
// (issue_4452_leads_audience test).

/** Who may be sent at most: per send, per actor per day, replies per hour. */
export const LEADS_MAX_RECIPIENTS = 5_000;
export const LEADS_CAMPAIGNS_PER_DAY = 5;
export const LEAD_REPLIES_PER_HOUR = 60;

export function isLeadsAudience(audience: AudienceDefinition): boolean {
  return audience.mode === "leads" || audience.mode === "lead_reply";
}

export interface LeadRow {
  lead_id?: string | null;
  id?: string | null;
  email?: string | null;
  display_name?: string | null;
  name?: string | null;
  first_name?: string | null;
  marketing_consent?: string | boolean | null;
  is_internal?: boolean | null;
  is_test?: boolean | null;
}

/** One resolved lead as the recipient shape the composer personalises. */
export function leadRowToRecipient(row: LeadRow): RecipientProfile {
  const name = (row.display_name ?? row.name ?? "").trim() || null;
  const consent = typeof row.marketing_consent === "boolean"
    ? (row.marketing_consent ? "yes" : "no")
    : row.marketing_consent === "yes" || row.marketing_consent === "unsubscribed"
    ? row.marketing_consent
    : "no";
  return {
    id: null,
    email: row.email ?? null,
    first_name: (row.first_name ?? "").trim() || (name ? name.split(/\s+/)[0] : null),
    display_name: name,
    app_status: "lead",
    is_internal: row.is_internal === true || row.is_test === true,
    marketing_consent: consent,
  };
}

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/** The recipients of a leads audience. Reply reads as the caller (its gate). */
export async function loadLeadRecipients(
  service: RpcClient,
  audience: AudienceDefinition,
  actorId: string,
  caller: RpcClient,
): Promise<RecipientProfile[]> {
  if (audience.mode === "leads") {
    const { data, error } = await service.rpc("leads_audience_resolve", {
      p_selection_id: audience.selectionId,
      p_actor: actorId,
    });
    if (error) {
      throw new Error(/selection_expired/.test(error.message) ? "lead_selection_expired" : `leads_audience_failed:${error.message}`);
    }
    return ((data ?? []) as LeadRow[]).map(leadRowToRecipient);
  }
  if (audience.mode === "lead_reply") {
    const { data, error } = await caller.rpc("admin_lead_get", { p_id: audience.leadId });
    if (error) throw new Error(/not_found|P0002/.test(`${error.code ?? ""} ${error.message}`) ? "lead_not_found" : `lead_read_failed:${error.message}`);
    const lead = (data as { lead?: LeadRow } | null)?.lead;
    if (!lead) throw new Error("lead_not_found");
    // A reply goes to the lead even without marketing consent; staff/test too.
    return [{ ...leadRowToRecipient({ ...lead, is_test: false }), marketing_consent: "yes" }];
  }
  throw new Error("audience_mode_invalid");
}

/** The send limits, checked before the snapshot is stored. */
export function leadsLimitError(
  audience: AudienceDefinition,
  counts: { willReceive: number; recentSends: number },
): string | null {
  if (audience.mode === "leads") {
    if (counts.willReceive > LEADS_MAX_RECIPIENTS) return "leads_audience_too_large";
    if (counts.recentSends >= LEADS_CAMPAIGNS_PER_DAY) return "leads_send_limit";
  }
  if (audience.mode === "lead_reply" && counts.recentSends >= LEAD_REPLIES_PER_HOUR) return "lead_reply_limit";
  return null;
}

/** What admin_email_log.audience stores: never a search text, never an email. */
export function leadsAuditAudience(
  audience: AudienceDefinition,
  selection: { filter?: Record<string, unknown> | null } | null,
  selected: number,
): Record<string, unknown> {
  if (audience.mode === "lead_reply") return { mode: "lead_reply", leadId: audience.leadId };
  const filter = selection?.filter ? { ...selection.filter } : null;
  if (filter && "q" in filter) filter.q = "[search]";
  return { mode: "leads", selectionId: audience.selectionId, filter, selected };
}
