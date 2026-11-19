/**
 * #4453 — STAND-IN for `./teamRequests` (build contract G), which another
 * builder writes. Same names and shapes as the contract, no server calls:
 * the list is empty and sending is refused with a plain reason, so the UI
 * built on it is honest until the real file lands. The integrator swaps the
 * one import in `teamRequestsPort.ts` and deletes this file.
 */
import { useMutation, useQuery } from "@tanstack/react-query";

export type WebsiteRequest = {
  ticketId: string;
  ticketNumber: string;
  what: string;
  sectionLabel: string | null;
  pagePath: string | null;
  status: "received" | "ready" | "closed";
  createdAt: string;
  dueAt: string | null;
  readyAt: string | null;
};

export type CreateWebsiteRequestInput = {
  brandId: string;
  siteId: string;
  what: string;
  where: { page_path: string; section_id?: string | null; section_label?: string | null };
  why: string;
  missingCapability: string;
  draftDigest: string;
};

export function useWebsiteRequests(brandId: string | null) {
  return useQuery({
    queryKey: ["brand-sites", brandId, "team-requests", "stub"],
    queryFn: async (): Promise<{ requests: WebsiteRequest[] }> => ({ requests: [] }),
    enabled: brandId !== null,
  });
}

export function useCreateWebsiteRequest() {
  return useMutation({
    mutationFn: async (_input: CreateWebsiteRequestInput): Promise<{ ticketId: string; ticketNumber: string }> => {
      throw new Error("Requests to the Mingla team aren’t switched on yet. Nothing was sent.");
    },
  });
}
