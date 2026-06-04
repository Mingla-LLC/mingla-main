/**
 * META-ORCH-1059 [experiences-business-parity] Pass 1 — implementor regression
 * test for the shared, kind-configurable offering primitives.
 *
 * Covers:
 *   ITEM 2 — shared list-card per-kind metric + status + revenue (via the pure
 *            tripToOfferingModel / experienceToOfferingModel mappers).
 *   ITEM 3 — shared manage sheet's per-kind action builder (route/label per kind,
 *            rows dropped when a handler is absent — no dead taps).
 *   ITEM 1 — trip + experience dashboards pad by insets.bottom (source assertion).
 *   Adoption — ExperienceListCard renders the shared OfferingListCard.
 *
 * Fails-on-revert: reverting any of the three items flips the matching
 * assertions below (verified via stash-revert in the implementation report).
 *
 * Pure-logic blocks import + execute the config/builder/mappers (no RN deps).
 * Source-assertion blocks pin the dashboard inset + experiences adoption.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import {
  formatOfferingMetric,
  offeringKindConfig,
} from "../offeringKind";
import { buildOfferingManageActions } from "../offeringManageActions";
import {
  experienceToOfferingModel,
  tripToOfferingModel,
} from "../offeringCardModels";

const APP_ROOT = join(__dirname, "..", "..", "..", "..", "app");
const readApp = (rel: string): string =>
  readFileSync(join(APP_ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// ITEM 2 — per-kind metric noun (the "lens")
// ---------------------------------------------------------------------------
describe("META-ORCH-1059 ITEM 2 — per-kind headcount metric", () => {
  test("events read as attendees, trips as travelers, experiences as spots sold", () => {
    expect(formatOfferingMetric("event", 3)).toBe("3 attendees");
    expect(formatOfferingMetric("event", 1)).toBe("1 attendee");
    expect(formatOfferingMetric("trip", 3)).toBe("3 travelers");
    expect(formatOfferingMetric("trip", 1)).toBe("1 traveler");
    expect(formatOfferingMetric("experience", 3)).toBe("3 spots sold");
    expect(formatOfferingMetric("experience", 1)).toBe("1 spot sold");
  });

  test("per-kind config carries the route prefixes (no hardcoded paths in the card)", () => {
    expect(offeringKindConfig("event").publicPathPrefix).toBe("/e");
    expect(offeringKindConfig("trip").publicPathPrefix).toBe("/t");
    expect(offeringKindConfig("experience").publicPathPrefix).toBe("/exp");
    expect(offeringKindConfig("trip").metricPlural).toBe("travelers");
    expect(offeringKindConfig("experience").metricPlural).toBe("spots");
  });
});

// ---------------------------------------------------------------------------
// ITEM 2 — per-kind card model mappers
// ---------------------------------------------------------------------------
describe("META-ORCH-1059 ITEM 2 — card model mappers", () => {
  test("tripToOfferingModel maps travelers metric + revenue + status", () => {
    const model = tripToOfferingModel({
      id: "ev_trip1",
      brandId: "b1",
      brandSlug: "acme",
      title: "Bali Retreat",
      description: null,
      slug: "bali",
      status: "scheduled",
      visibility: "public",
      publishedAt: null,
      timezone: "UTC",
      coverMediaUrl: null,
      coverMediaType: null,
      businessTrip: {
        startAt: "2999-01-01T00:00:00Z",
        endAt: "2999-01-05T00:00:00Z",
        destinationLocationText: "Bali",
      },
      days: [],
      pricingTiers: [],
      inclusions: [],
      createdAt: "",
      updatedAt: "",
      refundPolicy: null,
      bookingDeadline: null,
      bookingsClosed: false,
      bookingsClosedAt: null,
      ticketsSoldCount: 4,
      revenueCents: 120000,
      revenueCurrency: "USD",
    } as unknown as Parameters<typeof tripToOfferingModel>[0]);
    expect(model.status).toBe("upcoming");
    expect(model.metricLabel).toBe("4 travelers");
    expect(model.revenueLabel).not.toBeNull();
    expect(model.subline).toContain("Bali");
  });

  test("tripToOfferingModel: draft hides metric; zero revenue hides money", () => {
    const model = tripToOfferingModel({
      id: "ev_trip2",
      title: "Draft Trip",
      slug: "d",
      status: "draft",
      businessTrip: { startAt: null, endAt: null, destinationLocationText: null },
      coverMediaUrl: null,
      coverMediaType: null,
      ticketsSoldCount: 0,
      revenueCents: 0,
      revenueCurrency: null,
    } as unknown as Parameters<typeof tripToOfferingModel>[0]);
    expect(model.status).toBe("draft");
    expect(model.metricLabel).toBeNull();
    expect(model.revenueLabel).toBeNull();
  });

  test("experienceToOfferingModel maps spots-sold metric + revenue + status", () => {
    const model = experienceToOfferingModel({
      id: "ev_exp1",
      brandId: "b1",
      title: "Wine Tasting",
      description: null,
      slug: "wine",
      status: "live",
      visibility: "public",
      createdAt: "",
      intentTags: [],
      priceMinCents: null,
      priceMaxCents: null,
      currency: "GBP",
      capacityMin: null,
      capacityMax: null,
      suggestedTimeOfDay: null,
      coverMediaUrl: null,
      coverMediaType: null,
      dateSubline: "Fri · The Cellar",
      priceLabel: "£25",
      spotsSold: 7,
      revenueCents: 17500,
      revenueCurrency: "GBP",
    });
    expect(model.status).toBe("live");
    expect(model.metricLabel).toBe("7 spots sold");
    expect(model.revenueLabel).not.toBeNull();
    expect(model.subline).toBe("Fri · The Cellar");
  });
});

// ---------------------------------------------------------------------------
// ITEM 3 — shared manage sheet action builder
// ---------------------------------------------------------------------------
describe("META-ORCH-1059 ITEM 3 — buildOfferingManageActions per kind", () => {
  const noop = (): void => {};

  test("trip: full set Edit · View public · Orders · Share · Cancel, labels per kind", () => {
    const actions = buildOfferingManageActions(
      "trip",
      {
        onEdit: noop,
        onViewPublic: noop,
        onOrders: noop,
        onShare: noop,
        onCancel: noop,
      },
      noop,
    );
    const keys = actions.map((a) => a.key);
    expect(keys).toEqual([
      "edit",
      "view-public",
      "orders",
      "share",
      "cancel",
    ]);
    expect(actions.find((a) => a.key === "edit")!.label).toBe("Edit trip");
    expect(actions.find((a) => a.key === "cancel")!.label).toBe("Cancel trip");
    expect(actions.find((a) => a.key === "cancel")!.tone).toBe("danger");
  });

  test("experience: absent handlers drop their rows (no dead taps)", () => {
    const actions = buildOfferingManageActions(
      "experience",
      {
        onEdit: noop,
        // no onViewPublic / onOrders / onDuplicate
        onShare: noop,
        onCancel: noop,
      },
      noop,
    );
    const keys = actions.map((a) => a.key);
    expect(keys).toContain("edit");
    expect(keys).toContain("share");
    expect(keys).toContain("cancel");
    expect(keys).not.toContain("view-public");
    expect(keys).not.toContain("orders");
    expect(keys).not.toContain("duplicate");
    expect(actions.find((a) => a.key === "edit")!.label).toBe("Edit experience");
  });

  test("each action closes the sheet before running its handler (modal-collision guard)", () => {
    const order: string[] = [];
    const actions = buildOfferingManageActions(
      "trip",
      { onEdit: () => order.push("handler") },
      () => order.push("close"),
    );
    actions[0].onPress();
    expect(order).toEqual(["close", "handler"]);
  });
});

// ---------------------------------------------------------------------------
// ITEM 1 — trip + experience dashboards clear the bottom bar
// ---------------------------------------------------------------------------
describe("META-ORCH-1059 ITEM 1 — bottom safe-area inset on dashboards", () => {
  test("trip dashboard pads its scroll by insets.bottom", () => {
    const src = readApp("trip/[id]/index.tsx");
    expect(src).toMatch(/useSafeAreaInsets/);
    expect(src).toMatch(/paddingBottom:\s*insets\.bottom\s*\+\s*spacing\.xl/);
  });

  test("experience dashboard pads its scroll by insets.bottom", () => {
    const src = readApp("experience/[id]/index.tsx");
    expect(src).toMatch(/useSafeAreaInsets/);
    expect(src).toMatch(/paddingBottom:\s*insets\.bottom\s*\+\s*spacing\.xl/);
  });
});

// ---------------------------------------------------------------------------
// Adoption — experiences list uses the shared card; dashboards open shared sheet
// ---------------------------------------------------------------------------
describe("META-ORCH-1059 — shared-primitive adoption", () => {
  test("ExperienceListCard renders the shared OfferingListCard", () => {
    const SRC_ROOT = join(__dirname, "..", "..", "..");
    const src = readFileSync(
      join(SRC_ROOT, "components/experience/ExperienceListCard.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<OfferingListCard/);
    expect(src).toMatch(/kind="experience"/);
  });

  test("experience dashboard opens the shared OfferingManageSheet", () => {
    const src = readApp("experience/[id]/index.tsx");
    expect(src).toMatch(/<OfferingManageSheet/);
    expect(src).toMatch(/buildOfferingManageActions/);
  });

  test("trip + experience Hub lists pass onManageOpen (3-dot opens shared sheet)", () => {
    expect(readApp("(tabs)/hub/trips.tsx")).toMatch(/<OfferingManageSheet/);
    expect(readApp("(tabs)/hub/experiences.tsx")).toMatch(/<OfferingManageSheet/);
  });
});
