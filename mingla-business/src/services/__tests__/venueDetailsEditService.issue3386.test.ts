/* eslint-disable import/first */
/**
 * #3386 — the host write paths, the admin decision helpers, the notification
 * landing, and the guarantee that guest surfaces never read pending values.
 *
 *   S-*  service: RPC names and arguments; refusals keep their server code
 *   N-*  admin decision helpers (supabase/functions/admin-review-venue-claim/
 *        venueDetailsChangeReview.ts — pure, so proven here: the Business jest
 *        suite is the one universal lane, and its roots stop at src)
 *   L-*  the decision notification lands on the venue's Settings
 *   G-*  guests: no public read path names a pending (`details_change_*`)
 *        column; only the #3386 host/admin files do
 *   A-*  admin panel contract: decides through the audited edge action with
 *        the request id on screen, never by writing the venue row
 */

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: jest.fn(() => ({
      update: () => ({ eq: () => ({ then: (cb: () => void) => cb() }) }),
    })),
  },
}));
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-123" }) },
}));
jest.mock("../mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import {
  VenueDetailsEditError,
  identityPatchToRpcArgs,
  mapVenueDetailsRow,
  submitVenueDetailsChangeRequest,
  updateVenueContact,
  updateVenueIdentityInReview,
  venueDetailsEditErrorCopy,
  withdrawVenueDetailsChangeRequest,
  type VenueDetailsRow,
} from "../venueDetailsEditService";
import {
  parseBusinessDeepLink,
  resolveBusinessNavTarget,
} from "../businessNotificationRouting";
import {
  VENUE_DETAILS_CHANGE_NOTIFICATION_TYPE,
  VENUE_DETAILS_CHANGE_REVIEW_ACTION,
  normalizeVenueDetailsChangeReviewBody,
  readVenueDetailsChangeDecision,
  venueDetailsChangeDecisionCopy,
  venueDetailsChangeDeepLink,
  venueDetailsChangeIdempotencyKey,
  venueDetailsChangeRecipients,
} from "../../../../supabase/functions/admin-review-venue-claim/venueDetailsChangeReview";

const REPO = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

const VENUE = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  mockRpc.mockReset();
});

// ── S ──────────────────────────────────────────────────────────────────────
describe("S — host write paths", () => {
  test("S-1 contact saves E.164 + country through biz_update_venue_contact", async () => {
    mockRpc.mockImplementation(() => Promise.resolve({ data: { ok: true }, error: null }));
    await updateVenueContact({
      venueId: VENUE,
      phoneE164: "+2348031234567",
      phoneCountryIso: "NG",
      email: "hello@venue.example",
    });
    expect(mockRpc).toHaveBeenCalledWith("biz_update_venue_contact", {
      p_venue_id: VENUE,
      p_contact_phone: "+2348031234567",
      p_contact_phone_country_iso: "NG",
      p_contact_email: "hello@venue.example",
    });
  });

  test("S-2 clearing the phone never sends a stale country", async () => {
    mockRpc.mockImplementation(() => Promise.resolve({ data: { ok: true }, error: null }));
    await updateVenueContact({ venueId: VENUE, phoneE164: null, phoneCountryIso: "NG", email: "a@b.co" });
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_venue_id: VENUE,
      p_contact_phone: "",
      p_contact_phone_country_iso: "",
      p_contact_email: "a@b.co",
    });
  });

  test("S-3 an unchanged address sends NULL for every address argument (keeps the pin)", () => {
    expect(identityPatchToRpcArgs(VENUE, { name: "New" })).toEqual({
      p_venue_id: VENUE,
      p_name: "New",
      p_venue_category: null,
      p_address: null,
      p_city: null,
      p_country_code: null,
      p_lat: null,
      p_lng: null,
      p_coordinate_precision: null,
    });
  });

  test("S-4 a moved address sends its pin and precision together", () => {
    expect(
      identityPatchToRpcArgs(VENUE, {
        address: {
          address: "20 Admiralty Way",
          city: null,
          countryCode: "NG",
          lat: 6.43,
          lng: 3.42,
          coordinatePrecision: "approximate",
        },
      }),
    ).toEqual({
      p_venue_id: VENUE,
      p_name: null,
      p_venue_category: null,
      p_address: "20 Admiralty Way",
      p_city: "",
      p_country_code: "NG",
      p_lat: 6.43,
      p_lng: 3.42,
      p_coordinate_precision: "approximate",
    });
  });

  test("S-5 in review and live use different RPCs", async () => {
    mockRpc.mockImplementation((name: unknown) =>
      Promise.resolve({
        data:
          name === "biz_submit_venue_details_change_request"
            ? { ok: true, request_id: REQUEST, replaced: true }
            : { ok: true, changed: true },
        error: null,
      }),
    );
    await expect(updateVenueIdentityInReview(VENUE, { name: "A" })).resolves.toEqual({ changed: true });
    await expect(submitVenueDetailsChangeRequest(VENUE, { name: "B" })).resolves.toEqual({
      requestId: REQUEST,
      replaced: true,
    });
    await withdrawVenueDetailsChangeRequest(VENUE, REQUEST);
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual([
      "biz_update_venue_identity_in_review",
      "biz_submit_venue_details_change_request",
      "biz_withdraw_venue_details_change_request",
    ]);
    expect(mockRpc.mock.calls[2][1]).toEqual({ p_venue_id: VENUE, p_request_id: REQUEST });
  });

  test("S-6 a server refusal keeps its code and reads as plain English", async () => {
    mockRpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: "phone_country_mismatch", code: "22023" } }),
    );
    const error = await updateVenueContact({
      venueId: VENUE,
      phoneE164: "+448031234567",
      phoneCountryIso: "NG",
      email: null,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueDetailsEditError);
    expect((error as VenueDetailsEditError).code).toBe("phone_country_mismatch");
    expect((error as Error).message).toMatch(/doesn't match the country/);
    expect(venueDetailsEditErrorCopy("something_new")).toMatch(/Couldn't save/);
  });

  test("S-7 the row maps a pending request with its address only when the pin is whole", () => {
    const row: VenueDetailsRow = {
      id: VENUE,
      brand_id: "brand",
      name: "Live Lounge",
      venue_category: "restaurant",
      address: "2 Live Street",
      city: "Lagos",
      country_code: "NG",
      lat: 6.5,
      lng: 3.35,
      coordinate_precision: "exact",
      contact_phone: "+2348031234567",
      contact_phone_country_iso: "NG",
      contact_email: null,
      claim_status: "verified",
      details_change_request_id: REQUEST,
      details_change_status: "pending",
      details_change_name: "Live Lounge Rooftop",
      details_change_venue_category: null,
      details_change_address: "20 Admiralty Way",
      details_change_city: "Lagos",
      details_change_country_code: "NG",
      details_change_lat: 6.43,
      details_change_lng: 3.42,
      details_change_coordinate_precision: "approximate",
      details_change_requested_at: "2026-09-15T10:00:00Z",
      details_change_reviewed_at: null,
      details_change_rejection_reason: null,
    };
    const mapped = mapVenueDetailsRow(row);
    expect(mapped.changeRequest?.address?.lat).toBe(6.43);
    expect(mapped.changeRequest?.name).toBe("Live Lounge Rooftop");
    expect(mapVenueDetailsRow({ ...row, details_change_coordinate_precision: null }).changeRequest?.address).toBeNull();
    expect(mapVenueDetailsRow({ ...row, details_change_request_id: null, details_change_status: null }).changeRequest).toBeNull();
  });
});

// ── N ──────────────────────────────────────────────────────────────────────
describe("N — admin decision helpers", () => {
  test("N-1 the body needs a venue, the exact request, a decision, and a reason to reject", () => {
    expect(normalizeVenueDetailsChangeReviewBody({ action: VENUE_DETAILS_CHANGE_REVIEW_ACTION, venue_id: VENUE, request_id: REQUEST, decision: "approve", rejection_reason: "ignored" })).toEqual({
      ok: true,
      venueId: VENUE,
      requestId: REQUEST,
      decision: "approve",
      reason: null,
    });
    expect(normalizeVenueDetailsChangeReviewBody({ venue_id: VENUE, request_id: REQUEST, decision: "reject", rejection_reason: "  " })).toEqual({ ok: false, error: "rejection_reason_required" });
    expect(normalizeVenueDetailsChangeReviewBody({ venue_id: VENUE, decision: "approve" })).toEqual({ ok: false, error: "request_id_required" });
    expect(normalizeVenueDetailsChangeReviewBody({ venue_id: "nope", request_id: REQUEST, decision: "approve" })).toEqual({ ok: false, error: "venue_id_required" });
    expect(normalizeVenueDetailsChangeReviewBody({ venue_id: VENUE, request_id: REQUEST, decision: "apply" })).toEqual({ ok: false, error: "invalid_decision" });
    expect(normalizeVenueDetailsChangeReviewBody(null)).toEqual({ ok: false, error: "invalid_body" });
  });

  test("N-2 nothing is notified unless the RPC reports a complete decision", () => {
    expect(readVenueDetailsChangeDecision({ ok: false, code: "request_not_current" })).toEqual({ ok: false, code: "request_not_current" });
    expect(readVenueDetailsChangeDecision({ ok: true, decision: "approved" })).toEqual({ ok: false, code: "invalid_result" });
    expect(readVenueDetailsChangeDecision("ok")).toEqual({ ok: false, code: "invalid_result" });
    expect(
      readVenueDetailsChangeDecision({
        ok: true,
        noop: false,
        decision: "rejected",
        venue_id: VENUE,
        brand_id: "brand",
        request_id: REQUEST,
        requested_by: MANAGER,
        venue_name: " Live Lounge ",
        rejection_reason: " Sign says otherwise. ",
      }),
    ).toEqual({
      ok: true,
      noop: false,
      decision: "rejected",
      venueId: VENUE,
      brandId: "brand",
      requestId: REQUEST,
      requestedBy: MANAGER,
      venueName: "Live Lounge",
      rejectionReason: "Sign says otherwise.",
    });
  });

  test("N-3 the host is told plainly, with the reason on a rejection", () => {
    expect(venueDetailsChangeDecisionCopy("approved", "Live Lounge", null)).toEqual({
      title: "Venue details updated",
      body: "Mingla approved your changes. Live Lounge now shows the new details.",
    });
    expect(venueDetailsChangeDecisionCopy("rejected", "Live Lounge", "Sign says otherwise.").body).toBe(
      "Mingla didn't approve the changes to Live Lounge: Sign says otherwise.",
    );
    expect(venueDetailsChangeDecisionCopy("rejected", "Live Lounge", "x".repeat(400)).body.length).toBeLessThan(220);
  });

  test("N-4 owner and requester are each notified once, idempotently, on the Settings link", () => {
    expect(venueDetailsChangeRecipients(OWNER, MANAGER)).toEqual([OWNER, MANAGER]);
    expect(venueDetailsChangeRecipients(OWNER, OWNER)).toEqual([OWNER]);
    expect(venueDetailsChangeRecipients(null, "not-a-uuid")).toEqual([]);
    expect(venueDetailsChangeIdempotencyKey(REQUEST, "approved", OWNER)).toBe(
      `${VENUE_DETAILS_CHANGE_NOTIFICATION_TYPE}:${REQUEST}:approved:${OWNER}`,
    );
    expect(venueDetailsChangeDeepLink(VENUE)).toBe(`mingla-business://venue/${VENUE}/settings`);
  });

  test("N-5 the edge function wires the helpers to the audited RPC and notify-dispatch", () => {
    const edge = read("supabase/functions/admin-review-venue-claim/index.ts");
    const branch = edge.slice(
      edge.indexOf("if (rawAction === VENUE_DETAILS_CHANGE_REVIEW_ACTION)"),
      edge.indexOf('if (rawAction === "add_feedback")'),
    );
    expect(branch.length).toBeGreaterThan(0);
    // The admin gate runs before any action branch.
    expect(edge.indexOf('if (isAdmin !== true) return json({ error: "Forbidden" }, 403);')).toBeLessThan(
      edge.indexOf("if (rawAction === VENUE_DETAILS_CHANGE_REVIEW_ACTION)"),
    );
    expect(branch).toContain('userClient.rpc(\n        "admin_review_venue_details_change"');
    expect(branch).toContain("readVenueDetailsChangeDecision(decisionRes)");
    expect(branch).toContain("if (!receipt.noop)");
    expect(branch).toContain("dispatchNotification({");
    expect(branch).toContain("type: VENUE_DETAILS_CHANGE_NOTIFICATION_TYPE");
    // The RPC writes admin_audit_log itself; the wrapper must not add a second row.
    expect(stripComments(branch)).not.toContain("admin_audit_log");
  });
});

// ── L ──────────────────────────────────────────────────────────────────────
describe("L — the decision lands on venue Settings", () => {
  test("L-1 the settings deep link opens the Settings module", () => {
    expect(parseBusinessDeepLink(venueDetailsChangeDeepLink("ven-1"))).toBe(
      "/venue/ven-1?module=settings",
    );
    expect(parseBusinessDeepLink("mingla-business://venue/ven-1/orders")).toBe("/venue/ven-1?module=orders");
    expect(parseBusinessDeepLink("mingla-business://venue/ven-1")).toBe("/venue/ven-1");
  });

  test("L-2 a push without its link still reaches Settings, never the account tab", () => {
    expect(
      resolveBusinessNavTarget({ type: VENUE_DETAILS_CHANGE_NOTIFICATION_TYPE, venueId: "ven-2" }),
    ).toBe("/venue/ven-2?module=settings");
    expect(
      resolveBusinessNavTarget({ type: VENUE_DETAILS_CHANGE_NOTIFICATION_TYPE, relatedId: "ven-3" }),
    ).toBe("/venue/ven-3?module=settings");
  });
});

// ── G ──────────────────────────────────────────────────────────────────────
/** A pending column name; `\b` keeps the notification type name out of it. */
const PENDING_COLUMN = /\bdetails_change_/;

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/--.*$/gm, "");

describe("G — guests keep the live values until Mingla approves", () => {
  const PUBLIC_READ_PATHS = [
    "mingla-business/src/services/publicEventsService.ts",
    "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
    "mingla-business/server/socialPreview.js",
    "app-mobile/src/services/publicVenueService.ts",
    "app-mobile/src/hooks/useBrandBySlug.ts",
    "supabase/functions/_shared/contentShare.ts",
    "supabase/functions/venue-reservation-create/index.ts",
    "supabase/functions/venue-qr-sheet/index.ts",
  ];

  test("G-1 no guest read path names a pending column", () => {
    for (const rel of PUBLIC_READ_PATHS) {
      const src = stripComments(read(rel));
      // A missing or empty target must not pass vacuously.
      expect(src.length).toBeGreaterThan(200);
      expect({ rel, pending: PENDING_COLUMN.test(src) }).toEqual({ rel, pending: false });
    }
  });

  test("G-2 only the #3386 host and admin files read pending columns", () => {
    const ALLOWED = new Set([
      "mingla-business/src/services/venueDetailsEditService.ts",
      "mingla-admin/src/services/adminVenueDetailsChangeService.js",
      "mingla-admin/src/components/claims/VenueDetailsChangeRequestsPanel.jsx",
    ]);
    const ROOTS = [
      "mingla-business/src",
      "mingla-business/app",
      "mingla-business/server",
      "app-mobile/src",
      "app-mobile/app",
      "packages",
      "mingla-admin/src",
      "supabase/functions",
    ];
    const SKIP_DIRS = new Set(["node_modules", "__tests__", "dist", ".expo", "build"]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      const abs = path.join(REPO, dir);
      if (!fs.existsSync(abs)) return;
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
        const rel = path.join(dir, entry.name);
        const src = fs.readFileSync(path.join(REPO, rel), "utf8");
        if (src.includes("details_change_") && !ALLOWED.has(rel)) {
          if (PENDING_COLUMN.test(stripComments(src))) offenders.push(rel);
        }
      }
    };
    for (const root of ROOTS) walk(root);
    expect(offenders).toEqual([]);
  });

  test("G-3 the public venue read model is the verified-only view, never the table", () => {
    const src = stripComments(read("mingla-business/src/services/publicEventsService.ts"));
    expect(src).toContain("venue_public_view");
  });
});

// ── A ──────────────────────────────────────────────────────────────────────
describe("A — admin decides through the audited edge action", () => {
  const service = read("mingla-admin/src/services/adminVenueDetailsChangeService.js");
  const panel = read("mingla-admin/src/components/claims/VenueDetailsChangeRequestsPanel.jsx");
  const page = read("mingla-admin/src/pages/ClaimsPage.jsx");

  test("A-1 the decision carries the request id on screen and goes through the edge function", () => {
    expect(service).toContain('action: "review_details_change"');
    expect(service).toContain("request_id: requestId");
    expect(service).toContain('"admin-review-venue-claim"');
    expect(panel).toContain("requestId: request.details_change_request_id");
    // Never writes the venue row or calls the RPC around the notification.
    expect(stripComments(service)).not.toMatch(/\.update\s*\(/);
    expect(stripComments(service)).not.toMatch(/\.rpc\s*\(/);
  });

  test("A-2 a reject needs a reason; the list is the pending queue only", () => {
    expect(panel).toContain('venueDetailsChangeFailureCopy("rejection_reason_required")');
    expect(service).toContain('.eq("details_change_status", "pending")');
  });

  test("A-3 Venue claims has a Detail changes tab next to the claim tabs", () => {
    expect(page).toContain('{ id: "changes", label: "Detail changes" }');
    expect(page).toContain("<VenueDetailsChangeRequestsPanel");
    // The claim review modal and its pinned approve path are untouched.
    expect(page).toContain("await reviewClaim(venueId, action, opts)");
  });
});
