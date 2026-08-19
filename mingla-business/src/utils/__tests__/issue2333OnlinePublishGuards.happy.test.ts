/**
 * issue #2333 [online-event-publish] — IMPLEMENTOR happy-path suite for S4.
 *
 * Covers SPEC §7 T-13, T-15, T-16, T-17 and T-18, plus the LOCKED copy pins for
 * S4a and the map-host deny for S4d.
 *
 * WHAT THIS EXISTS TO STOP, in one sentence each:
 *   S4a  `city_required` was the ONE server guard nothing on the client recognised, so
 *        it degraded to "Could not save this publish. Try again." and a paying customer
 *        retried an impossible publish for two days.
 *   S4b  that degradation was the DEFAULT for every unmapped guard — a class bug, not a
 *        one-off. Every future typed server guard is a silent dead end until the
 *        fallback stops inviting a retry.
 *   S4d  `validateWhere` accepted `https://maps.app.goo.gl/...` as a conferencing link
 *        because `isValidUrl` is a URL validator doing duty as a conferencing-link
 *        validator. That is how a physical exhibition ended up classified as online.
 *
 * fails-on-revert (proved by TRUE LINE DELETION, not comment-out):
 *   * delete the `s.includes("city_required")` arm from
 *     normalizeProviderNeutralPaidPublishGuardReason → the T-13 block goes red.
 *   * delete the `city_required` entry from PROVIDER_NEUTRAL_PAID_PUBLISH_COPY → the
 *     locked-copy block goes red.
 *   * delete the UNMAPPED_GUARD_TOKEN_SHAPE branch from describeUnmappedPublishGuard →
 *     the T-15 naming test goes red.
 *   * delete the `isMapLocationUrl` arm from validateWhere (draftEventValidation.ts) →
 *     the T-17 block goes red while T-18 stays green.
 *
 * CI: .github/workflows/issue-2333-online-event-publish.yml.
 */

import {
  describeUnmappedPublishGuard,
  normalizeProviderNeutralPaidPublishGuardReason,
  resolveProviderNeutralPaidPublishGuardCopy,
  detectPaidPublishGuardReason,
} from "../paidPublishGuards";
import { validateStep } from "../draftEventValidation";
import type { DraftEvent } from "../../store/draftEventStore";

// ── A minimal draft that is VALID on the Where step except for what each test
//    deliberately breaks. Only the Where-step fields matter; validateStep(2) reads
//    nothing else.
const whereDraft = (over: Partial<DraftEvent>): DraftEvent =>
  ({
    format: "online",
    venueName: null,
    address: null,
    city: null,
    onlineUrl: null,
    ...over,
  }) as unknown as DraftEvent;

const whereErrors = (over: Partial<DraftEvent>): string[] =>
  validateStep(2, whereDraft(over)).map((e) => e.message);

describe("issue #2333 S4a — city_required is a recognised guard (T-13)", () => {
  it("normalizes the bare RPC token", () => {
    expect(normalizeProviderNeutralPaidPublishGuardReason("city_required")).toBe(
      "city_required",
    );
  });

  it("normalizes it out of a decorated server message", () => {
    // The publish RAISE reaches the client through several wrappers; the detector
    // is a substring contract, exactly like the other guards.
    expect(
      normalizeProviderNeutralPaidPublishGuardReason(
        'FunctionsHttpError: {"message":"city_required"}',
      ),
    ).toBe("city_required");
    expect(
      normalizeProviderNeutralPaidPublishGuardReason(
        "error: city_required (SQLSTATE P0001) at business_publish_event_draft",
      ),
    ).toBe("city_required");
  });

  it("resolves to the LOCKED copy and the edit_where action", () => {
    const copy = resolveProviderNeutralPaidPublishGuardCopy("city_required");
    expect(copy).not.toBeNull();
    // Byte-pinned. Rewording is an orchestrator decision (SPEC §4 S4a, OQ-3).
    expect(copy).toEqual({
      reason: "city_required",
      title: "Add where it's happening",
      body: "We need a city or a venue address before this can go live. Open the Where step and pick the address from the suggestions.",
      actionLabel: "Open Where step",
      action: "edit_where",
    });
  });

  it("does NOT leak into the money-guard union", () => {
    // `PaidPublishGuardReason` documents itself as the MONEY guards. Edit paths call
    // detectPaidPublishGuardReason expecting a payment problem; a location guard
    // arriving there would route the host to Stripe onboarding for a missing city.
    expect(detectPaidPublishGuardReason("city_required")).toBeNull();
  });

  it("leaves the pre-existing guards untouched", () => {
    expect(
      normalizeProviderNeutralPaidPublishGuardReason("offering_date_past"),
    ).toBe("offering_date_past");
    expect(
      normalizeProviderNeutralPaidPublishGuardReason("stripe_charges_disabled"),
    ).toBe("payment_collection_unavailable");
    expect(
      normalizeProviderNeutralPaidPublishGuardReason("event_currency_required"),
    ).toBe("event_currency_required");
    expect(
      resolveProviderNeutralPaidPublishGuardCopy("offering_date_past")?.action,
    ).toBe("edit_date");
  });
});

describe("issue #2333 S4b — an unmapped guard never invites a retry (T-15, T-16)", () => {
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it("NAMES a recognisable snake_case guard token (T-15)", () => {
    const msg = describeUnmappedPublishGuard("some_new_guard");
    expect(msg).toBe(
      'We couldn\'t publish this yet — the server reported "some_new_guard". Contact support and quote that code.',
    );
  });

  it("logs every unmapped guard so an engineer has a trace (T-15)", () => {
    describeUnmappedPublishGuard("some_new_guard");
    expect(spy).toHaveBeenCalledWith("[#2333] unmapped publish guard", "some_new_guard");
  });

  it("NEVER says 'Try again' — the string that lied for two days", () => {
    const inputs = [
      "some_new_guard",
      "",
      null,
      undefined,
      '{"code":"P0001","message":"boom"}',
      "  ",
    ];
    for (const raw of inputs) {
      expect(describeUnmappedPublishGuard(raw)).not.toMatch(/try again/i);
      expect(describeUnmappedPublishGuard(raw)).not.toBe(
        "Could not save this publish. Try again.",
      );
    }
  });

  it("does NOT echo a hostile server string verbatim (T-16)", () => {
    // A PostgREST envelope, a stack fragment and markup are all things
    // `error.message` really can be. None may reach a toast.
    const hostile = [
      '{"code":"P0001","details":null,"hint":null,"message":"city_required"}',
      "at business_publish_event_draft (line 186) — PL/pgSQL function",
      "<script>alert(1)</script>",
      "A".repeat(4096),
      "Guard Failed With Spaces",
      "UPPER_CASE_TOKEN",
      "9_starts_with_a_digit",
      "ab", // shorter than the 3-char floor
    ];
    for (const raw of hostile) {
      const msg = describeUnmappedPublishGuard(raw);
      expect(msg).toBe(
        "We couldn't publish this yet. Nothing was lost — your draft is saved. Contact support if it keeps happening.",
      );
      expect(msg).not.toContain(raw);
    }
  });

  it("still logs the hostile input (the trace is unconditional)", () => {
    describeUnmappedPublishGuard("<script>alert(1)</script>");
    expect(spy).toHaveBeenCalledWith(
      "[#2333] unmapped publish guard",
      "<script>alert(1)</script>",
    );
  });

  it("trims before deciding, so a padded token is still named", () => {
    expect(describeUnmappedPublishGuard("  some_new_guard  ")).toContain(
      '"some_new_guard"',
    );
  });
});

describe("issue #2333 S4d — a map pin is not a joining link (T-17, T-18)", () => {
  const MAP_MSG =
    "That's a map location, not a joining link. If this event happens at a venue, go back to Step 1 and choose In person or Hybrid.";

  it("rejects the exact link the reporting customer pasted (T-17)", () => {
    expect(
      whereErrors({ onlineUrl: "https://maps.app.goo.gl/Qr8MotQCkTcSw7bp8?g_st=ic" }),
    ).toContain(MAP_MSG);
  });

  it("rejects the other known map hosts (T-17)", () => {
    const mapUrls = [
      "https://maps.app.goo.gl/abc",
      "https://www.google.com/maps/place/Somewhere",
      "https://google.co.uk/maps/@1,2,15z",
      "https://goo.gl/maps/xyz",
      "https://maps.google.com/?q=1,2",
      "https://maps.apple.com/?ll=1,2",
      "https://what3words.com/filled.count.soap",
      "https://w3w.co/filled.count.soap",
      "https://www.openstreetmap.org/#map=15/1/2",
      "https://waze.com/ul?ll=1,2",
      // lenient, no scheme — isValidUrl prepends https://, so the deny must too
      "maps.app.goo.gl/abc",
    ];
    for (const url of mapUrls) {
      expect(whereErrors({ onlineUrl: url })).toContain(MAP_MSG);
    }
  });

  it("still accepts every real conferencing link (T-18)", () => {
    // Seth's decision (OQ-2): deny known map hosts ONLY. Explicitly NOT an allow-list
    // of video providers — an allow-list silently rejects self-hosted and regional
    // tools we did not anticipate. The last two entries are exactly those.
    const goodUrls = [
      "https://zoom.us/j/123",
      "https://meet.google.com/abc-defg-hij",
      "meet.google.com/abc-defg-hij",
      "https://teams.microsoft.com/l/meetup-join/xyz",
      "zoom.us/j/123",
      "https://us02web.zoom.us/j/1",
      "https://whereby.com/mingla",
      "https://meet.jit.si/mingla-room",
      "https://video.mycompany.internal.example/room/7",
      "https://vc.tencent.com/room/9",
    ];
    for (const url of goodUrls) {
      expect(whereErrors({ onlineUrl: url })).toEqual([]);
    }
  });

  it("does not deny an innocent host that merely MENTIONS a map path", () => {
    // The deny is on the parsed hostname, never a substring of the raw string.
    expect(
      whereErrors({ onlineUrl: "https://meet.example.com/google.com/maps-review" }),
    ).toEqual([]);
    expect(whereErrors({ onlineUrl: "https://notgoogle.com/maps" })).toEqual([]);
    // google.com WITHOUT a /maps path is not a map link.
    expect(whereErrors({ onlineUrl: "https://google.com/meet/abc" })).toEqual([]);
  });

  it("keeps the pre-existing empty and malformed messages", () => {
    expect(whereErrors({ onlineUrl: null })).toContain(
      "Add the online conferencing link.",
    );
    expect(whereErrors({ onlineUrl: "notaurl" })).toContain(
      "Enter a valid link (e.g. https://zoom.us/j/123).",
    );
  });

  it("applies to the HYBRID branch too — it shares the online link field", () => {
    expect(
      whereErrors({
        format: "hybrid",
        venueName: "The Venue",
        address: "1 Main St, London",
        city: "London",
        onlineUrl: "https://maps.app.goo.gl/abc",
      }),
    ).toContain(MAP_MSG);
  });

  it("does not touch the IN_PERSON branch, which has no link field", () => {
    expect(
      whereErrors({
        format: "in_person",
        venueName: "The Venue",
        address: "1 Main St, London",
        city: "London",
        onlineUrl: "https://maps.app.goo.gl/abc",
      }),
    ).toEqual([]);
  });
});
