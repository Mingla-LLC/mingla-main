/* eslint-disable import/first */
// MINGLA-INVARIANT: I-4453-WEBSITE-REQUEST-ONE-TICKET-PER-SEND | issue #4453 | Pressing Send again on the same website change request (same brand, site and words) reuses the first press's client request id, so the database files one ticket; a changed request gets a new id, and an id is never reused after a send succeeded.
 
/*
 * #4453 — Website workspace, "Ask the Mingla team": the Host data layer.
 *
 * Fails-on-revert: generate a fresh id on every mutation call → "a second press
 * reuses the id" goes red. Keep the id after success → "a new request after a
 * success gets a new id" goes red. Map status from the ticket alone → the
 * "ready" row goes red. Drop the brand filter → the list test goes red.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type RpcResult = { data: unknown; error: { message: string } | null };
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let mockRpcResult: (args: Record<string, unknown>) => RpcResult = () => ({ data: null, error: null });
const listCalls: Record<string, unknown>[] = [];
let mockListResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };

jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return mockRpcResult(args);
    },
    from: (table: string) => {
      const call: Record<string, unknown> = { table };
      const chain = {
        select: (columns: string) => { call.select = columns; return chain; },
        eq: (column: string, value: unknown) => { call.eq = [column, value]; return chain; },
        order: (column: string, options: unknown) => { call.order = [column, options]; return chain; },
        limit: async (count: number) => { call.limit = count; listCalls.push(call); return mockListResult; },
      };
      return chain;
    },
  },
}));

let mockNextId = 0;
jest.mock("../../services/brandSitesService", () => {
  class BrandSitesError extends Error {
    constructor(readonly code: string, message: string, readonly retryable: boolean) {
      super(message);
      this.name = "BrandSitesError";
    }
  }
  return {
    BrandSitesError,
    createBrandSiteOperationId: () => `00000000-0000-4000-8000-${String(++mockNextId).padStart(12, "0")}`,
  };
});

// One ref object per test, kept across "renders" of the hook.
let mockRef: { current: unknown } | null = null;
jest.mock("react", () => ({
  useRef: (initial: unknown) => (mockRef ??= { current: initial }),
}));

type MutationOptions = {
  mutationFn: (input: unknown) => Promise<unknown>;
  onSuccess?: (data: unknown, input: unknown) => void;
};
type QueryOptions = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; enabled: boolean; staleTime: number };
let lastMutation: MutationOptions | null = null;
let lastQuery: QueryOptions | null = null;
let mockQueryData: unknown = undefined;
const invalidated: (readonly unknown[])[] = [];
jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: QueryOptions) => { lastQuery = options; return { data: mockQueryData, isLoading: false, isError: false }; },
  useMutation: (options: MutationOptions) => {
    lastMutation = options;
    return {
      mutateAsync: async (input: unknown) => {
        const data = await options.mutationFn(input);
        options.onSuccess?.(data, input);
        return data;
      },
    };
  },
  useQueryClient: () => ({
    invalidateQueries: async ({ queryKey }: { queryKey: readonly unknown[] }) => { invalidated.push(queryKey); },
  }),
}));

import {
  WEBSITE_REQUEST_LIMITS,
  buildCreateWebsiteRequestArgs,
  createWebsiteRequest,
  listWebsiteRequests,
  toWebsiteRequest,
  useCreateWebsiteRequest,
  useWebsiteRequests,
  websiteRequestKeys,
  websiteRequestProblem,
  websiteRequestStatus,
} from "../teamRequests";
import { brandSiteKeys } from "../brandSiteKeys";

const BRAND = "44530000-0000-4000-8000-0000000000e1";
const SITE = "44530000-0000-4000-8000-0000000000f1";
const base = { brandId: BRAND, siteId: SITE, what: "Add a video background" };
const ok = (args: Record<string, unknown>): RpcResult => ({
  data: { ticket_id: args.p_client_request_id, ticket_number: 1042, replayed: false },
  error: null,
});

beforeEach(() => {
  rpcCalls.length = 0;
  listCalls.length = 0;
  invalidated.length = 0;
  mockRpcResult = ok;
  mockListResult = { data: [], error: null };
  mockRef = null;
  mockNextId = 0;
  mockQueryData = undefined;
  lastMutation = null;
  lastQuery = null;
});

describe("#4453 team requests: reading the list", () => {
  it("maps a request's status from its ticket and its ready time", () => {
    expect(websiteRequestStatus("new", null)).toBe("received");
    expect(websiteRequestStatus("open", null)).toBe("received");
    expect(websiteRequestStatus("pending", null)).toBe("received");
    expect(websiteRequestStatus("pending", "2026-11-19T10:00:00Z")).toBe("ready");
    // The owner replied after it was ready (the ticket reopened): it is still theirs to look at.
    expect(websiteRequestStatus("open", "2026-11-19T10:00:00Z")).toBe("ready");
    expect(websiteRequestStatus("resolved", "2026-11-19T10:00:00Z")).toBe("closed");
    expect(websiteRequestStatus("closed", null)).toBe("closed");
    expect(websiteRequestStatus(undefined, null)).toBe("received");
  });

  it("turns a row into the shape the workspace reads", () => {
    const row = {
      ticket_id: "t-1", what: "Add a video background", section_label: "Top of the page", page_path: "/",
      due_at: "2026-11-20T09:00:00Z", ready_at: null, created_at: "2026-11-19T09:00:00Z",
      ticket: { ticket_number: 1042, status: "new" },
    };
    expect(toWebsiteRequest(row)).toEqual({
      ticketId: "t-1", ticketNumber: 1042, what: "Add a video background", sectionId: null, sectionLabel: "Top of the page",
      pagePath: "/", status: "received", createdAt: "2026-11-19T09:00:00Z", dueAt: "2026-11-20T09:00:00Z", readyAt: null,
    });
    // An embedded one-row array and a missing ticket are both tolerated.
    expect(toWebsiteRequest({ ...row, ready_at: "2026-11-19T12:00:00Z", ticket: [{ ticket_number: 7, status: "pending" }] }))
      .toMatchObject({ ticketNumber: 7, status: "ready", readyAt: "2026-11-19T12:00:00Z" });
    expect(toWebsiteRequest({ ...row, ticket: null })).toMatchObject({ ticketNumber: null, status: "received" });
  });

  it("asks for this brand's requests only, newest first", async () => {
    mockListResult = {
      data: [{
        ticket_id: "t-2", what: "Warmer colours", section_label: null, page_path: null,
        due_at: "2026-11-20T09:00:00Z", ready_at: null, created_at: "2026-11-19T09:00:00Z",
        ticket: { ticket_number: 1043, status: "resolved" },
      }],
      error: null,
    };
    const requests = await listWebsiteRequests(BRAND);
    expect(requests).toEqual([expect.objectContaining({ ticketId: "t-2", status: "closed", sectionLabel: null, pagePath: null })]);
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toMatchObject({
      table: "support_website_requests",
      eq: ["brand_id", BRAND],
      order: ["created_at", { ascending: false }],
      limit: 50,
    });
    expect(String(listCalls[0].select)).toContain("ticket:support_tickets!inner(ticket_number, status)");
  });

  it("a failed read is an error the screen can retry, in plain words", async () => {
    mockListResult = { data: null, error: { message: "permission denied for table support_website_requests" } };
    await expect(listWebsiteRequests(BRAND)).rejects.toMatchObject({
      code: "REQUESTS_UNAVAILABLE", retryable: true,
      message: "Mingla could not load your requests to the team. Try again.",
    });
  });

  it("useWebsiteRequests returns { requests } under the Website key root and waits for a brand", () => {
    const empty = useWebsiteRequests(null);
    expect(empty.requests).toEqual([]);
    expect(lastQuery?.enabled).toBe(false);
    mockQueryData = [{ ticketId: "t-1" }];
    const loaded = useWebsiteRequests(BRAND);
    expect(loaded.requests).toEqual([{ ticketId: "t-1" }]);
    expect(lastQuery?.enabled).toBe(true);
    expect(lastQuery?.queryKey).toEqual(["brand-sites", BRAND, "team-requests"]);
    expect(websiteRequestKeys.byBrand(BRAND).slice(0, 1)).toEqual([...brandSiteKeys.all]);
    expect(useWebsiteRequests(BRAND, false).requests).toEqual([{ ticketId: "t-1" }]);
    expect(lastQuery?.enabled).toBe(false);
  });
});

describe("#4453 team requests: sending one", () => {
  it("builds the exact arguments of issue_4453_create_website_request", () => {
    expect(buildCreateWebsiteRequestArgs({
      ...base,
      what: "  Add a video background  ",
      where: { pagePath: " / ", sectionId: "sec_hero-1", sectionLabel: "  Top   of the page " },
      why: " Our launch film ",
      missingCapability: "Ari cannot add video",
      draftDigest: "sha256:abc",
    }, "id-1")).toEqual({
      p_client_request_id: "id-1",
      p_brand_id: BRAND,
      p_site_id: SITE,
      p_what: "Add a video background",
      p_where: { page_path: "/", section_id: "sec_hero-1", section_label: "Top of the page" },
      p_why: "Our launch film",
      p_missing_capability: "Ari cannot add video",
      p_draft_digest: "sha256:abc",
    });
    // Empty parts go as null / an empty object; a section without a page is dropped (the database refuses it).
    expect(buildCreateWebsiteRequestArgs({ ...base, where: { sectionId: "sec-1" }, why: "  ", missingCapability: null }, "id-2"))
      .toEqual({
        p_client_request_id: "id-2", p_brand_id: BRAND, p_site_id: SITE, p_what: "Add a video background",
        p_where: {}, p_why: null, p_missing_capability: null, p_draft_digest: null,
      });
    const long = buildCreateWebsiteRequestArgs({ ...base, where: { pagePath: "/", sectionLabel: "x".repeat(300) } }, "id-3");
    expect((long.p_where as { section_label: string }).section_label).toHaveLength(WEBSITE_REQUEST_LIMITS.sectionLabel);
  });

  it("says what is wrong before the round trip", async () => {
    expect(websiteRequestProblem(base)).toBeNull();
    expect(websiteRequestProblem({ ...base, what: "   " })).toBe("Say what you want changed.");
    expect(websiteRequestProblem({ ...base, what: "x".repeat(2001) })).toBe("Keep what you want under 2000 characters.");
    expect(websiteRequestProblem({ ...base, why: "x".repeat(2001) })).toBe("Keep the reason under 2000 characters.");
    expect(websiteRequestProblem({ ...base, missingCapability: "x".repeat(1001) })).toBe("Keep what Ari could not do under 1000 characters.");
    await expect(createWebsiteRequest({ ...base, what: "" }, "id-1")).rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns the ticket id and number, and says when it had already been sent", async () => {
    await expect(createWebsiteRequest(base, "id-1")).resolves.toEqual({ ticketId: "id-1", ticketNumber: 1042, alreadySent: false });
    expect(rpcCalls[0].fn).toBe("issue_4453_create_website_request");
    mockRpcResult = (args) => ({ data: { ticket_id: args.p_client_request_id, ticket_number: 1042, replayed: true }, error: null });
    await expect(createWebsiteRequest(base, "id-1")).resolves.toEqual({ ticketId: "id-1", ticketNumber: 1042, alreadySent: true });
  });

  it("turns refusals into plain words and never shows a database message", async () => {
    const cases: [string, string, boolean][] = [
      ["website_access_required", "You need access to this brand's website to ask for a change.", false],
      ["not_brand_member", "You need to be on this brand's team to ask for a change.", false],
      ["not_authenticated", "Sign in again to send this request.", false],
      ["request_id_taken", "This request could not be sent. Try again.", true],
      ["what_too_long", "Keep what you want under 2000 characters.", false],
      ["canceling statement due to statement timeout", "Your request was not sent. Check your connection and try again.", true],
    ];
    for (const [raw, message, retryable] of cases) {
      mockRpcResult = () => ({ data: null, error: { message: raw } });
      await expect(createWebsiteRequest(base, "id-1")).rejects.toMatchObject({ message, retryable });
    }
    mockRpcResult = () => ({ data: { ticket_number: 5 }, error: null });
    await expect(createWebsiteRequest(base, "id-1")).rejects.toMatchObject({ code: "REQUEST_NOT_SENT", retryable: true });
  });

  it("a second press after a dropped reply reuses the id, so the team gets one ticket", async () => {
    let attempts = 0;
    mockRpcResult = (args) => (++attempts === 1 ? { data: null, error: { message: "Failed to fetch" } } : ok(args));
    await expect(useCreateWebsiteRequest().mutateAsync(base)).rejects.toMatchObject({ code: "REQUEST_NOT_SENT" });
    // The screen re-renders and the owner presses Send again.
    const created = await useCreateWebsiteRequest().mutateAsync({ ...base });
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1].args.p_client_request_id).toBe(rpcCalls[0].args.p_client_request_id);
    expect(created).toMatchObject({ ticketId: rpcCalls[0].args.p_client_request_id });
    expect(invalidated).toEqual([["brand-sites", BRAND, "team-requests"]]);
  });

  it("a changed request gets a new id, and a new request after a success gets a new id", async () => {
    mockRpcResult = () => ({ data: null, error: { message: "Failed to fetch" } });
    await expect(useCreateWebsiteRequest().mutateAsync(base)).rejects.toBeTruthy();
    await expect(useCreateWebsiteRequest().mutateAsync({ ...base, what: "Add a photo gallery" })).rejects.toBeTruthy();
    expect(rpcCalls[1].args.p_client_request_id).not.toBe(rpcCalls[0].args.p_client_request_id);
    // Another brand with the same words is a different request too.
    await expect(useCreateWebsiteRequest().mutateAsync({ ...base, what: "Add a photo gallery", brandId: "other-brand" })).rejects.toBeTruthy();
    expect(rpcCalls[2].args.p_client_request_id).not.toBe(rpcCalls[1].args.p_client_request_id);

    mockRpcResult = ok;
    await useCreateWebsiteRequest().mutateAsync(base);
    await useCreateWebsiteRequest().mutateAsync(base);
    expect(rpcCalls[4].args.p_client_request_id).not.toBe(rpcCalls[3].args.p_client_request_id);
    expect(new Set(rpcCalls.map((call) => call.args.p_client_request_id)).size).toBe(5);
  });

  it("the hook hands react-query one mutation that takes the contract's input", () => {
    useCreateWebsiteRequest();
    expect(typeof lastMutation?.mutationFn).toBe("function");
    expect(typeof lastMutation?.onSuccess).toBe("function");
  });
});
