/**
 * issue #3827 — a published RSVP opened at /event/<id> lands on its /rsvp
 * equivalent (implementor proof).
 *
 *   T-1  rsvpTwinRoute maps the three ticketed screens to their RSVP twins and
 *        leaves every non-RSVP (and a missing id) alone
 *   T-2  the enquiry card's "Open booking" (context rsvp) opens the RSVP
 *        console, and "Open offering" for an RSVP opens the RSVP dashboard
 *   T-3  the gift push for an RSVP opens the RSVP dashboard even when its deep
 *        link names /event
 *   T-4  /event/<id> and /event/<id>/edit?mode=edit-published hand an RSVP over
 *        (the guest list is rendered in
 *        app/event/[id]/guests/__tests__/guests.issue_3827_rsvp_redirect…)
 *
 * Fails on revert: drop rsvpTwinRoute (T-1), the rsvp branches in
 * brandEnquiryDisplay (T-2) or businessNotificationRouting (T-3), or the
 * hand-over in either route (T-4).
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-1" }) },
}));

import { rsvpTwinRoute } from "../routeForEventRow";
import { brandEnquiryContextOpen } from "../brandEnquiryDisplay";
import type { BrandEnquiryContext } from "../../services/brandEnquiriesService";
import { resolveBusinessNavTarget } from "../../services/businessNotificationRouting";

const ID = "11111111-1111-4111-8111-111111111111";

describe("T-1 rsvpTwinRoute", () => {
  test("an RSVP maps each ticketed screen to its RSVP twin", () => {
    const rsvp = { event_type: "rsvp" };
    expect(rsvpTwinRoute(rsvp, ID, "detail")).toBe(`/rsvp/${ID}`);
    expect(rsvpTwinRoute(rsvp, ID, "edit-published")).toBe(
      `/rsvp/${ID}/edit?mode=edit-published`,
    );
    expect(rsvpTwinRoute(rsvp, ID, "guests")).toBe(`/rsvp/${ID}/guests`);
  });

  test("anything that is not an RSVP, or has no id, stays where it is", () => {
    for (const t of ["event", "trip", "experience", undefined]) {
      expect(rsvpTwinRoute({ event_type: t }, ID, "detail")).toBeNull();
    }
    expect(rsvpTwinRoute(null, ID, "guests")).toBeNull();
    expect(rsvpTwinRoute({ event_type: "rsvp" }, null, "detail")).toBeNull();
    expect(rsvpTwinRoute({ event_type: "rsvp" }, "", "detail")).toBeNull();
  });
});

describe("T-2 the enquiry context card", () => {
  const ctx = (patch: Partial<BrandEnquiryContext>): BrandEnquiryContext =>
    ({ kind: "none", ...patch }) as BrandEnquiryContext;

  test("Open booking for an RSVP opens the RSVP guest console", () => {
    expect(brandEnquiryContextOpen(ctx({ kind: "rsvp", event_id: ID }))).toEqual({
      label: "Open booking",
      route: `/rsvp/${ID}/guests`,
    });
  });

  test("Open offering for an RSVP opens the RSVP dashboard; an event still opens /event", () => {
    expect(
      brandEnquiryContextOpen(ctx({ kind: "offering", id: ID, offering_kind: "rsvp" }))?.route,
    ).toBe(`/rsvp/${ID}`);
    expect(
      brandEnquiryContextOpen(ctx({ kind: "offering", id: ID, offering_kind: "event" }))?.route,
    ).toBe(`/event/${ID}`);
    expect(
      brandEnquiryContextOpen(ctx({ kind: "offering", id: ID, offering_kind: "stay" })),
    ).toBeNull();
  });
});

describe("T-3 the RSVP gift push", () => {
  test("opens /rsvp/<id>, even with a deep link that names /event", () => {
    expect(
      resolveBusinessNavTarget({
        type: "business.rsvp_contribution_received",
        event_id: ID,
        deepLink: `mingla-business://event/${ID}`,
      }),
    ).toBe(`/rsvp/${ID}`);
    expect(
      resolveBusinessNavTarget({ type: "business.rsvp_contribution_received", eventId: ID }),
    ).toBe(`/rsvp/${ID}`);
  });

  test("a ticketed push is unchanged", () => {
    expect(resolveBusinessNavTarget({ type: "business.order_paid", eventId: ID })).toBe(
      `/event/${ID}`,
    );
  });
});

describe("T-4 the ticketed routes hand an RSVP over", () => {
  const read = (rel: string): string =>
    readFileSync(join(__dirname, "..", "..", "..", "app", "event", "[id]", rel), "utf8");

  test("/event/<id> replaces to the RSVP dashboard and draws nothing meanwhile", () => {
    const src = read("index.tsx");
    expect(src).toMatch(
      /const rsvpRoute = rsvpTwinRoute\(resolvedLiveEvent, id, "detail"\);\s*if \(rsvpRoute !== null\) router\.replace\(rsvpRoute as never\);/,
    );
    expect(src).toContain('if (event === null || rsvpTwinRoute(event, id, "detail") !== null) {');
  });

  test("/event/<id>/edit?mode=edit-published replaces to the RSVP editor, keeping returnTo", () => {
    const src = read("edit.tsx");
    expect(src).toMatch(
      /const rsvpEditRoute = isEditPublished\s*\?\s*rsvpTwinRoute\(resolvedLiveEvent, idParam, "edit-published"\)/,
    );
    expect(src).toMatch(
      /router\.replace\(\s*\(setupReturn \? withReturnTo\(rsvpEditRoute, setupReturn\) : rsvpEditRoute\) as never,?\s*\);/,
    );
    // The ticketed published editor is never mounted for an RSVP.
    expect(src).toContain("if (resolvedLiveEvent === null || rsvpEditRoute !== null) {");
  });
});
