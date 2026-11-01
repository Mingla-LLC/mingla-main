// #4226 — who an admin email reaches.
//
// Every audience reads ONE list of people: the admin-only SQL function
// public.admin_people_directory() (migration 20280228004226), the same list
// the People page and the Data room read. It holds every account (with the
// People classifier's app status: explorer, host, both, incomplete) and every
// ticket buyer or holder with no account ('ticket_buyer_no_app').
//
// Audiences:
//   Explorers      app status explorer or both
//   Hosts          app status host or both
//   Everyone / all explorer, host or both (people with a Mingla app)
//   Ticket buyers  anyone with a paid ticket (bought, comp'd or held),
//                  whatever their app status
// Segment filters narrow any of these: app status, event city, country,
// bought tickets (yes / no), brand bought from, and the #3720 profile filters.
//
// Staff and test (is_internal) are left out of every bulk send and counted.
// Ticket buyers are reached only with marketing consent: on the "Ticket
// buyers" audience, and for anyone whose only tie is a ticket (no app), a
// recipient whose consent is not 'yes' is left out and counted. An
// unsubscribed person is never sent to, on any audience.
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
].join(",");

export const APP_STATUSES = [
  "explorer",
  "host",
  "both",
  "incomplete",
  "ticket_buyer_no_app",
] as const;

const WITH_APP = ["explorer", "host", "both"];

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
  if (audience.mode === "everyone") return query.in("app_status", WITH_APP);

  const filters = audience.filters ?? {};
  const userType = filters.userType ?? "all";
  const appStatus = filters.appStatus && filters.appStatus !== "all"
    ? filters.appStatus
    : null;
  if (userType === "host") query = query.in("app_status", ["host", "both"]);
  else if (userType === "explorer") {
    query = query.in("app_status", ["explorer", "both"]);
  } else if (userType === "ticket_buyers") {
    query = query.eq("is_ticket_holder", true);
  } else if (!appStatus) {
    // "All users" without an app-status filter means people with an app.
    query = query.in("app_status", WITH_APP);
  }
  if (appStatus) query = query.eq("app_status", appStatus);
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
  if (
    audience.mode === "segment" &&
    audience.filters?.userType === "ticket_buyers"
  ) return true;
  return row.app_status === "ticket_buyer_no_app";
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
};

export function appStatusLabel(value: string | null | undefined): string {
  return (value && APP_STATUS_LABELS[value]) || "Unknown";
}
