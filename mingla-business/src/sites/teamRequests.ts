/**
 * #4453 — Website workspace, "Ask the Mingla team": the brand's website
 * change requests and the call that sends one. Service calls and React Query
 * hooks, in the shape of contentApi.ts.
 *
 * A request is a support ticket (topic "website_change", shared with the
 * brand) plus a detail row in support_website_requests. It is filed only by
 * the database function issue_4453_create_website_request, which checks that
 * the caller can open this brand's website; rows are read under row level
 * security (the person who sent it and teammates with website access).
 *
 * Imported only by the Website section's lazy chunk, never the boot path.
 */
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { BrandSitesError, createBrandSiteOperationId } from "../services/brandSitesService";
import { brandSiteKeys } from "./brandSiteKeys";

/** Every team-request key lives under the Website factory's root. */
export const websiteRequestKeys = {
  byBrand: (brandId: string | null) => [...brandSiteKeys.all, brandId, "team-requests"] as const,
};

export const WEBSITE_REQUEST_LIMITS = {
  what: 2000,
  why: 2000,
  missingCapability: 1000,
  sectionLabel: 120,
  pagePath: 300,
} as const;

export type WebsiteRequestStatus = "received" | "ready" | "closed";

export type WebsiteRequest = {
  ticketId: string;
  ticketNumber: number | null;
  what: string;
  sectionLabel: string | null;
  pagePath: string | null;
  status: WebsiteRequestStatus;
  createdAt: string;
  dueAt: string;
  readyAt: string | null;
};

export type WebsiteRequestWhere = {
  pagePath?: string | null;
  sectionId?: string | null;
  sectionLabel?: string | null;
};

export type CreateWebsiteRequestInput = {
  brandId: string;
  siteId: string;
  what: string;
  where?: WebsiteRequestWhere | null;
  why?: string | null;
  missingCapability?: string | null;
  draftDigest?: string | null;
};

export type CreatedWebsiteRequest = {
  ticketId: string;
  ticketNumber: number | null;
  /** True when this same request had already been filed (a retry). */
  alreadySent: boolean;
};

type RequestRow = {
  ticket_id: string;
  what: string;
  section_label: string | null;
  page_path: string | null;
  due_at: string;
  ready_at: string | null;
  created_at: string;
  ticket: { ticket_number: number | null; status: string | null } | { ticket_number: number | null; status: string | null }[] | null;
};

const REQUEST_SELECT =
  "ticket_id, what, section_label, page_path, due_at, ready_at, created_at, ticket:support_tickets!inner(ticket_number, status)";

/** received → Mingla is working on it; ready → look at the draft; closed → finished. */
export function websiteRequestStatus(ticketStatus: string | null | undefined, readyAt: string | null | undefined): WebsiteRequestStatus {
  if (ticketStatus === "resolved" || ticketStatus === "closed") return "closed";
  return readyAt ? "ready" : "received";
}

export function toWebsiteRequest(row: RequestRow): WebsiteRequest {
  const ticket = Array.isArray(row.ticket) ? row.ticket[0] ?? null : row.ticket;
  const number = Number(ticket?.ticket_number);
  return {
    ticketId: row.ticket_id,
    ticketNumber: Number.isInteger(number) && number > 0 ? number : null,
    what: row.what,
    sectionLabel: row.section_label,
    pagePath: row.page_path,
    status: websiteRequestStatus(ticket?.status, row.ready_at),
    createdAt: row.created_at,
    dueAt: row.due_at,
    readyAt: row.ready_at,
  };
}

/** The brand's requests to the Mingla team, newest first. */
export async function listWebsiteRequests(brandId: string): Promise<WebsiteRequest[]> {
  const { data, error } = await supabase
    .from("support_website_requests")
    .select(REQUEST_SELECT)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    throw new BrandSitesError("REQUESTS_UNAVAILABLE", "Mingla could not load your requests to the team. Try again.", true);
  }
  return ((data ?? []) as unknown as RequestRow[]).map(toWebsiteRequest);
}

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

/** What the database refuses, said before the round trip. Null when the request can be sent. */
export function websiteRequestProblem(input: CreateWebsiteRequestInput): string | null {
  const what = clean(input.what);
  if (!what) return "Say what you want changed.";
  if (what.length > WEBSITE_REQUEST_LIMITS.what) return `Keep what you want under ${WEBSITE_REQUEST_LIMITS.what} characters.`;
  if ((clean(input.why)?.length ?? 0) > WEBSITE_REQUEST_LIMITS.why) return `Keep the reason under ${WEBSITE_REQUEST_LIMITS.why} characters.`;
  if ((clean(input.missingCapability)?.length ?? 0) > WEBSITE_REQUEST_LIMITS.missingCapability) {
    return `Keep what Ari could not do under ${WEBSITE_REQUEST_LIMITS.missingCapability} characters.`;
  }
  return null;
}

/** The exact arguments of issue_4453_create_website_request. */
export function buildCreateWebsiteRequestArgs(input: CreateWebsiteRequestInput, clientRequestId: string) {
  const pagePath = clean(input.where?.pagePath);
  const sectionId = pagePath ? clean(input.where?.sectionId) : null;
  const sectionLabel = clean(input.where?.sectionLabel)?.replace(/\s+/g, " ").slice(0, WEBSITE_REQUEST_LIMITS.sectionLabel) ?? null;
  const where: Record<string, string> = {};
  if (pagePath) where.page_path = pagePath;
  if (sectionId) where.section_id = sectionId;
  if (sectionLabel) where.section_label = sectionLabel;
  return {
    p_client_request_id: clientRequestId,
    p_brand_id: input.brandId,
    p_site_id: input.siteId,
    p_what: (input.what ?? "").trim(),
    p_where: where,
    p_why: clean(input.why),
    p_missing_capability: clean(input.missingCapability),
    p_draft_digest: clean(input.draftDigest),
  };
}

const CREATE_ERRORS: Record<string, { message: string; retryable: boolean }> = {
  website_access_required: { message: "You need access to this brand's website to ask for a change.", retryable: false },
  not_brand_member: { message: "You need to be on this brand's team to ask for a change.", retryable: false },
  not_authenticated: { message: "Sign in again to send this request.", retryable: false },
  request_id_taken: { message: "This request could not be sent. Try again.", retryable: true },
  what_required: { message: "Say what you want changed.", retryable: false },
  what_too_long: { message: `Keep what you want under ${WEBSITE_REQUEST_LIMITS.what} characters.`, retryable: false },
  why_too_long: { message: `Keep the reason under ${WEBSITE_REQUEST_LIMITS.why} characters.`, retryable: false },
  missing_capability_too_long: {
    message: `Keep what Ari could not do under ${WEBSITE_REQUEST_LIMITS.missingCapability} characters.`,
    retryable: false,
  },
};

function createErrorFrom(raw: string | null | undefined): BrandSitesError {
  const text = raw ?? "";
  const code = Object.keys(CREATE_ERRORS).find((key) => text.includes(key));
  if (code) return new BrandSitesError(code.toUpperCase(), CREATE_ERRORS[code].message, CREATE_ERRORS[code].retryable);
  return new BrandSitesError("REQUEST_NOT_SENT", "Your request was not sent. Check your connection and try again.", true);
}

/**
 * Send one request. `clientRequestId` is the ticket id: sending again with
 * the same id returns the request already filed instead of a second one.
 */
export async function createWebsiteRequest(
  input: CreateWebsiteRequestInput,
  clientRequestId: string,
): Promise<CreatedWebsiteRequest> {
  const problem = websiteRequestProblem(input);
  if (problem) throw new BrandSitesError("VALIDATION_FAILED", problem, false);
  const { data, error } = await supabase.rpc(
    "issue_4453_create_website_request",
    buildCreateWebsiteRequestArgs(input, clientRequestId),
  );
  if (error) throw createErrorFrom(error.message);
  const result = (data ?? null) as { ticket_id?: unknown; ticket_number?: unknown; replayed?: unknown } | null;
  if (!result || typeof result.ticket_id !== "string" || result.ticket_id.length === 0) {
    throw createErrorFrom(null);
  }
  const number = Number(result.ticket_number);
  return {
    ticketId: result.ticket_id,
    ticketNumber: Number.isInteger(number) && number > 0 ? number : null,
    alreadySent: result.replayed === true,
  };
}

/** One id per distinct request: the same words sent again reuse it. */
function requestFingerprint(input: CreateWebsiteRequestInput): string {
  return JSON.stringify(buildCreateWebsiteRequestArgs(input, ""));
}

/** `{ requests }` for the brand, newest first, plus the query's own state. */
export function useWebsiteRequests(brandId: string | null, enabled = true) {
  const query = useQuery({
    queryKey: websiteRequestKeys.byBrand(brandId),
    queryFn: () => listWebsiteRequests(brandId!),
    enabled: brandId !== null && enabled,
    staleTime: 15_000,
  });
  return { ...query, requests: query.data ?? [] };
}

/**
 * Send a request to the Mingla team. A second press after a dropped reply
 * (same brand, site and words) reuses the first press's id, so the team gets
 * one ticket; a changed request gets a new id.
 */
export function useCreateWebsiteRequest() {
  const client = useQueryClient();
  const inFlight = useRef<{ fingerprint: string; id: string } | null>(null);
  return useMutation({
    mutationFn: (input: CreateWebsiteRequestInput) => {
      const fingerprint = requestFingerprint(input);
      if (inFlight.current?.fingerprint !== fingerprint) {
        inFlight.current = { fingerprint, id: createBrandSiteOperationId() };
      }
      return createWebsiteRequest(input, inFlight.current.id);
    },
    onSuccess: (_created, input) => {
      inFlight.current = null;
      void client.invalidateQueries({ queryKey: websiteRequestKeys.byBrand(input.brandId) });
    },
  });
}
