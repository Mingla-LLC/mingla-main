/**
 * #4453 — the ONE place the workspace reaches the team-request data layer.
 * INTEGRATOR: when `./teamRequests` (build contract G) is merged, change the
 * import below from "./teamRequests.stub" to "./teamRequests" and delete the
 * stub. Nothing else imports either file.
 */
import { useCreateWebsiteRequest, useWebsiteRequests } from "./teamRequests.stub";

export type TeamRequestStatus = "received" | "ready" | "closed";
export type TeamRequest = {
  ticketId: string;
  ticketNumber: string;
  what: string;
  sectionLabel: string | null;
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
  where: { page_path: string; section_id?: string | null; section_label?: string | null };
  why: string;
  missingCapability: string;
  draftDigest: string;
};

type Loose = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

function normalise(row: unknown): TeamRequest | null {
  if (!row || typeof row !== "object") return null;
  const entry = row as Loose;
  const ticketId = text(entry.ticketId);
  if (!ticketId) return null;
  const status = entry.status === "ready" || entry.status === "closed" ? entry.status : "received";
  return {
    ticketId,
    ticketNumber: text(entry.ticketNumber) ?? "",
    what: text(entry.what) ?? "Website change",
    sectionLabel: text(entry.sectionLabel),
    pagePath: typeof entry.pagePath === "string" ? entry.pagePath : null,
    status,
    createdAt: text(entry.createdAt) ?? "",
    dueAt: text(entry.dueAt),
    readyAt: text(entry.readyAt),
  };
}

/**
 * The owner's requests, newest first. Reads either a query result holding
 * `{ requests }` or a plain `{ requests }` (the contract names the shape, not
 * the wrapper), so the swap is one line whichever the real hook returns.
 */
export function useTeamRequests(brandId: string | null): { requests: TeamRequest[]; isLoading: boolean; isError: boolean; refetch: () => void } {
  const result = useWebsiteRequests(brandId) as unknown as Loose;
  const holder = (result.data && typeof result.data === "object" ? result.data : result) as Loose;
  const rows = Array.isArray(holder.requests) ? holder.requests : [];
  const requests = rows.map(normalise).filter((row): row is TeamRequest => row !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    requests,
    isLoading: result.isLoading === true,
    isError: result.isError === true,
    refetch: () => { if (typeof result.refetch === "function") void (result.refetch as () => unknown)(); },
  };
}

export function useSendTeamRequest(): { send: (input: TeamRequestInput) => Promise<{ ticketId: string | null; ticketNumber: string | null }>; isPending: boolean } {
  const mutation = useCreateWebsiteRequest() as unknown as Loose | ((input: TeamRequestInput) => Promise<unknown>);
  const run = typeof mutation === "function"
    ? mutation
    : (mutation.mutateAsync as (input: TeamRequestInput) => Promise<unknown>);
  return {
    send: async (input) => {
      const result = (await run(input)) as Loose | null | undefined;
      return { ticketId: text(result?.ticketId ?? result?.ticket_id), ticketNumber: text(result?.ticketNumber ?? result?.ticket_number) };
    },
    isPending: typeof mutation === "function" ? false : mutation.isPending === true,
  };
}
