// issue #3827 — private ticket links, TESTER ADVERSARIAL (executed behaviour).
//
// Every case here RUNS shipped code: the anonymous /g document handler, the
// host ticket badge, and the guest CSV export. The SQL contracts (hidden tiers,
// password retirement, pending capacity, unique group emails) are proven by
// running the real functions in the pg17 suites under supabase/migrations/__tests__.

jest.mock("../supabase", () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import { afterEach, describe, expect, jest, test } from "@jest/globals";

import type { TicketStub } from "../../store/draftEventStore";
import type { OrderRecord } from "../../store/orderStore";
import { serializeGuestsToCsv, type ExportGuestRow } from "../../utils/guestCsvExport";
import { formatTicketBadges } from "../../utils/ticketDisplay";

type Headers = Record<string, string>;
interface FakeResponse {
  statusCode: number;
  headers: Headers;
  body: string | null;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}
type DocumentHandler = (
  req: { method?: string; query: Record<string, unknown> },
  res: FakeResponse,
) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handleTicketLinkDocument } = require("../../../server/ticketLinkDocument") as {
  handleTicketLinkDocument: DocumentHandler;
};

const VALID_TOKEN = "Ab3_-Ab3_-Ab3_-Ab3_-Ab"; // 22 chars of the bearer alphabet

const fakeResponse = (): FakeResponse => {
  const res: FakeResponse = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader: (name, value) => {
      res.headers[name.toLowerCase()] = value;
    },
    end: (body) => {
      res.body = body ?? "";
    },
  };
  return res;
};

const mockPreview = (impl: () => Promise<Response>) =>
  jest.spyOn(globalThis, "fetch").mockImplementation(impl);

const okJson = (payload: unknown) => async (): Promise<Response> =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

const run = async (method: string, token: unknown): Promise<FakeResponse> => {
  const res = fakeResponse();
  await handleTicketLinkDocument({ method, query: { token } }, res);
  return res;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("issue #3827 /g anonymous document — executed handler", () => {
  test("every response is non-indexable, non-referring and never cached, even a refusal", async () => {
    mockPreview(okJson({ state: "not_found" }));
    for (const [method, token] of [["GET", VALID_TOKEN], ["GET", "short"], ["POST", VALID_TOKEN]] as const) {
      const res = await run(method, token);
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["cache-control"]).toBe("private, no-store, max-age=0, must-revalidate");
      expect(res.headers["vercel-cdn-cache-control"]).toBe("no-store");
      expect(res.headers["cdn-cache-control"]).toBe("no-store");
    }
  });

  test("a malformed token is a generic 404 and never reaches the preview service", async () => {
    const fetchMock = mockPreview(okJson({ state: "active", eventTitle: "Leak" }));
    for (const token of ["", "a".repeat(21), "a".repeat(23), "a".repeat(21) + "/", ["x"], undefined]) {
      const res = await run("GET", token);
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain("Private invitation");
      expect(res.body).not.toContain("Leak");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("only GET and HEAD are served; HEAD has no body", async () => {
    mockPreview(okJson({ state: "not_found" }));
    const post = await run("POST", VALID_TOKEN);
    expect(post.statusCode).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    const head = await run("HEAD", VALID_TOKEN);
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
  });

  test("hostile event text is escaped and a non-https image is dropped", async () => {
    mockPreview(okJson({
      state: "active",
      kind: "guest_list",
      eventTitle: "<script>alert(1)</script>",
      brandName: "\"Brand\" & co",
      ogImageUrl: "http://insecure.example/x.png",
    }));
    const res = await run("GET", VALID_TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script>alert(1)</script>");
    expect(res.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(res.body).toContain("&quot;Brand&quot; &amp; co invited you to join the guest list");
    expect(res.body).not.toContain("og:image");
    expect(res.body).toContain('name="twitter:card" content="summary"');
  });

  test("an inactive link or a preview outage shows nothing about the event", async () => {
    mockPreview(okJson({ state: "revoked", eventTitle: "Secret party", brandName: "Hidden brand" }));
    const revoked = await run("GET", VALID_TOKEN);
    expect(revoked.body).not.toContain("Secret party");
    expect(revoked.body).not.toContain("Hidden brand");

    mockPreview(async () => { throw new Error("upstream down"); });
    const outage = await run("GET", VALID_TOKEN);
    expect(outage.statusCode).toBe(200);
    expect(outage.body).toContain("Private invitation | Mingla");
  });

  test("a paid link describes ticket access, not a guest list", async () => {
    mockPreview(okJson({ state: "active", kind: "private_ticket", eventTitle: "Gala", brandName: "Host" }));
    const res = await run("GET", VALID_TOKEN);
    expect(res.body).toContain("Host shared private ticket access for Gala.");
    expect(res.body).not.toContain("guest list");
  });
});

describe("issue #3827 host surfaces — executed helpers", () => {
  test("a hidden tier promises private-link access", () => {
    const hidden = { visibility: "hidden" } as TicketStub;
    const labels = formatTicketBadges(hidden).map((badge) => badge.label);
    expect(labels).toContain("Hidden — private link only");
    expect(labels).not.toContain("Hidden — direct link only");
  });

  test("the guest CSV carries Via link for a link-issued comp, blank otherwise, and stays rectangular", () => {
    const base: OrderRecord = {
      id: "comp-link",
      eventId: "event-1",
      brandId: "brand-1",
      buyer: { name: "Link Guest", email: "guest@example.com", phone: "+15555550123", marketingOptIn: true },
      lines: [{
        ticketTypeId: "tt-gl",
        ticketNameAtPurchase: "Guest list",
        unitPriceGbpAtPurchase: 0,
        unitPriceAtPurchase: 0,
        isFreeAtPurchase: true,
        quantity: 1,
        refundedQuantity: 0,
        refundedAmountGbp: 0,
        refundedAmount: 0,
      }],
      ticketDays: [{ ticketId: "t-1", ticketTypeId: "tt-gl", eventDateIds: [], status: "valid", usedAt: null }],
      totalGbpAtPurchase: 0,
      totalAtPurchase: 0,
      totalCents: 0,
      currency: "GBP",
      paymentMethod: "free",
      paidAt: "2026-10-20T10:00:00.000Z",
      status: "paid",
      refundedAmountGbp: 0,
      refundedAmount: 0,
      refunds: [],
      cancelledAt: null,
      source: "comp",
      lastSeenEventUpdatedAt: "2026-10-20T10:00:00.000Z",
      viaLinkLabel: "DJ Kaycee, invites",
    };
    const rows: ExportGuestRow[] = [
      { kind: "order", id: base.id, order: base, sortKey: "1" },
      { kind: "order", id: "comp-plain", order: { ...base, id: "comp-plain", viaLinkLabel: null }, sortKey: "2" },
    ];
    const lines = serializeGuestsToCsv(rows).split("\n").filter((l) => l.length > 0);
    const header = lines[0].split(",");
    const via = header.indexOf("Via link");
    expect(via).toBeGreaterThan(-1);
    expect(lines[1]).toContain("\"DJ Kaycee, invites\"");
    expect(lines[2]).not.toContain("DJ Kaycee");
    const unquotedCells = (line: string): string[] => line.replace(/"[^"]*"/g, "Q").split(",");
    expect(unquotedCells(lines[1])).toHaveLength(header.length);
    expect(unquotedCells(lines[2])).toHaveLength(header.length);
    expect(unquotedCells(lines[1])[via]).toBe("Q");
    expect(unquotedCells(lines[2])[via]).toBe("");
  });
});
