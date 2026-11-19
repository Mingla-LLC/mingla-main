/**
 * #4453 — the ONE place the workspace reaches the team-request data layer
 * (`./teamRequests`: the brand's requests and the call that sends one).
 *
 * Two forms of a page's address meet here, and this file is where they are
 * converted:
 *  - the workspace (Studio's page list, Ari's focus) names a page WITHOUT a
 *    leading slash: "" is the home page, "about", "resources/faqs";
 *  - a request is stored with the address a visitor sees: "/" is the home
 *    page, "/about" (issue_4453_create_website_request refuses any other
 *    form, and the Support desk reads "/" as the home page).
 */
import {
  useCreateWebsiteRequest,
  useWebsiteRequests,
  type WebsiteRequest,
  type WebsiteRequestStatus,
} from "./teamRequests";

export type TeamRequestStatus = WebsiteRequestStatus;
export type TeamRequest = {
  ticketId: string;
  /** "Request 2041", or "" while the number is not known. */
  ticketNumber: string;
  what: string;
  sectionId: string | null;
  sectionLabel: string | null;
  /** The workspace's form: "" is the home page. Null: the whole website. */
  pagePath: string | null;
  status: TeamRequestStatus;
  createdAt: string;
  dueAt: string | null;
  readyAt: string | null;
};
export type TeamRequestInput = {
  brandId: string;
  siteId: string;
  what: string;
  /** `page_path` in the workspace's form ("" is the home page). */
  where: { page_path: string; section_id?: string | null; section_label?: string | null };
  why: string;
  missingCapability: string;
  draftDigest: string;
};

/** Workspace page path ("" / "about") -> the stored visitor address ("/" / "/about"). */
export function requestPagePath(workspacePath: string | null | undefined): string {
  return `/${(workspacePath ?? "").trim().replace(/^\/+|\/+$/g, "")}`;
}

/** Stored visitor address ("/" / "/about") -> the workspace's page path ("" / "about"); null stays null. */
export function workspacePagePath(stored: string | null | undefined): string | null {
  if (typeof stored !== "string" || stored.trim().length === 0) return null;
  return stored.trim().replace(/^\/+|\/+$/g, "");
}

export function ticketNumberLabel(value: number | null | undefined): string {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? `Request ${value}` : "";
}

export function toTeamRequest(row: WebsiteRequest): TeamRequest {
  return {
    ticketId: row.ticketId,
    ticketNumber: ticketNumberLabel(row.ticketNumber),
    what: row.what || "Website change",
    sectionId: row.sectionId,
    sectionLabel: row.sectionLabel,
    pagePath: workspacePagePath(row.pagePath),
    status: row.status,
    createdAt: row.createdAt,
    dueAt: row.dueAt || null,
    readyAt: row.readyAt,
  };
}

/** The arguments `./teamRequests` takes, from the workspace's request. */
export function toCreateInput(input: TeamRequestInput) {
  return {
    brandId: input.brandId,
    siteId: input.siteId,
    what: input.what,
    where: {
      pagePath: requestPagePath(input.where.page_path),
      sectionId: input.where.section_id ?? null,
      sectionLabel: input.where.section_label ?? null,
    },
    why: input.why,
    missingCapability: input.missingCapability,
    draftDigest: input.draftDigest || null,
  };
}

/** The brand's requests, newest first. */
export function useTeamRequests(brandId: string | null): { requests: TeamRequest[]; isLoading: boolean; isError: boolean; refetch: () => void } {
  const query = useWebsiteRequests(brandId);
  const requests = query.requests.map(toTeamRequest).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    requests,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => { void query.refetch(); },
  };
}

export function useSendTeamRequest(): { send: (input: TeamRequestInput) => Promise<{ ticketId: string; ticketNumber: string }>; isPending: boolean } {
  const mutation = useCreateWebsiteRequest();
  return {
    send: async (input) => {
      const created = await mutation.mutateAsync(toCreateInput(input));
      return { ticketId: created.ticketId, ticketNumber: ticketNumberLabel(created.ticketNumber) };
    },
    isPending: mutation.isPending,
  };
}
