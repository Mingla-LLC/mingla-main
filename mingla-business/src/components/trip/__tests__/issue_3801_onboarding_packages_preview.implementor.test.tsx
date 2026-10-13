/**
 * Issue #3801 — the trip preview lists EVERY package, in the order the host
 * authored them.
 *
 * THE BUG. The legacy `TripPreview` layout (the wizard's Review step) read
 * `trip.pricingTiers[0]` and rendered that one package. A host with Shared,
 * Private and Couple packages saw one of the three, and which one changed
 * between reloads because the read behind it had no order.
 *
 * THE FIX. The layout maps over `trip.pricingTiers`. (The reads are ordered by
 * `ticket_types.display_order`; that half is proven in
 * `services/__tests__/issue_3801_onboarding_capacity_sum.implementor.test.ts`.)
 *
 * HOW THIS PROVES IT. The REAL `TripPreview` source is compiled with the
 * TypeScript compiler and mounted against an explicit module boundary (the
 * #3439 / #1780 compiled-creator pattern); an unknown import throws.
 *
 * Fails on revert: restore `const tier = trip.pricingTiers[0]` and the single
 * `{tier !== undefined ? …}` card -> red (one row instead of three).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  unmount: () => void;
}
// CI installs the renderer but not a separate @types package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const PREVIEW_FILE = path.resolve(__dirname, "..", "TripPreview.tsx");

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};
const nothing = (): null => null;

const BOUNDARY: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  designSystem: () => designSystem,
  // The suite-wide mapping: REAL pure helpers, stubbed RN components.
  "@mingla/offering-rendering": () => jest.requireActual("@mingla/offering-rendering"),
  "@mingla/offering-rendering/currencyGlyph": () =>
    jest.requireActual("@mingla/offering-rendering/currencyGlyph"),
  EventCoverMedia: () => ({ EventCoverMedia: nothing }),
  Icon: () => ({ Icon: nothing }),
  CollapsibleDescription: () => ({ CollapsibleDescription: leaf("CollapsibleDescription") }),
};

function loadPreview(): React.ComponentType<Record<string, unknown>> {
  const output = ts.transpileModule(fs.readFileSync(PREVIEW_FILE, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const key = specifier.split("/").pop() as string;
    const supply = BOUNDARY[specifier] ?? BOUNDARY[key];
    if (supply !== undefined) return supply();
    throw new Error(`Unclassified TripPreview boundary: ${specifier}`);
  };
  const module = {
    exports: {} as Record<string, React.ComponentType<Record<string, unknown>>>,
  };
  new Function("require", "module", "exports", output)(
    boundaryRequire,
    module,
    module.exports,
  );
  return module.exports.TripPreview;
}

const EVENT_ID = "38010000-0000-4000-8000-0000000000d1";

const tier = (
  id: string,
  ticketTypeId: string,
  tierName: string,
  priceCents: number,
  quantityTotal: number,
): Record<string, unknown> => ({
  id,
  eventId: EVENT_ID,
  ticketTypeId,
  tierName,
  tierMetadata: {},
  priceCents,
  currency: "USD",
  quantityTotal,
  ticketsRemaining: null,
  isUnlimited: false,
  installmentSchedule: null,
  description: null,
});

const tripWith = (pricingTiers: Record<string, unknown>[]): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: "brand-3801",
  brandSlug: "casa-lenta",
  title: "Lagos long weekend",
  description: null,
  slug: "lagos-long-weekend",
  status: "draft",
  visibility: "draft",
  publishedAt: null,
  timezone: "UTC",
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  businessTrip: {
    startAt: "2026-11-12T00:00:00.000Z",
    endAt: "2026-11-16T23:59:59.000Z",
    destinationPlaceId: null,
    destinationLocationText: "Lagos, Nigeria",
    destinationLat: null,
    destinationLng: null,
    departurePlaceId: null,
    departureLocationText: null,
    departureLat: null,
    departureLng: null,
    capacity: 11,
  },
  days: [],
  inclusions: [],
  pricingTiers,
  refundPolicy: null,
  bookingDeadline: null,
  ticketsSoldCount: 0,
});

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

async function mountPreview(trip: Record<string, unknown>): Promise<Renderer> {
  const TripPreview = loadPreview();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <TripPreview
        trip={trip}
        brand={{ id: "brand-3801", slug: "casa-lenta", name: "Casa Lenta" }}
      />,
    );
  });
  mounted.push(tree);
  return tree;
}

const textOf = (node: TestInstance): string =>
  node
    .findAll((n) => n.type === "Text")
    .map((n) => {
      const children = n.props.children;
      return Array.isArray(children) ? children.join("") : String(children ?? "");
    })
    .join(" | ");

const packageRows = (tree: Renderer): TestInstance[] =>
  tree.root.findAll(
    (node) =>
      node.type === "View" &&
      typeof node.props.testID === "string" &&
      node.props.testID.startsWith("trip-preview-package-"),
  );

describe("#3801 — the preview lists every package in authored order", () => {
  test("three packages render three rows: Shared, Private, Couple", async () => {
    const tree = await mountPreview(
      tripWith([
        tier("tier-c", "tt-shared", "Shared", 120000, 8),
        tier("tier-b", "tt-private", "Private", 180000, 2),
        tier("tier-a", "tt-couple", "Couple", 300000, 1),
      ]),
    );
    const rows = packageRows(tree);
    expect(rows.map((row) => row.props.testID)).toEqual([
      "trip-preview-package-tt-shared",
      "trip-preview-package-tt-private",
      "trip-preview-package-tt-couple",
    ]);
    const text = rows.map(textOf);
    expect(text[0]).toContain("Shared");
    expect(text[0]).toContain("1,200");
    expect(text[1]).toContain("Private");
    expect(text[1]).toContain("1,800");
    expect(text[2]).toContain("Couple");
    expect(text[2]).toContain("3,000");
  });

  test("the preview follows the order it is given, whatever it is", async () => {
    const tree = await mountPreview(
      tripWith([
        tier("tier-a", "tt-couple", "Couple", 300000, 1),
        tier("tier-c", "tt-shared", "Shared", 120000, 8),
      ]),
    );
    expect(packageRows(tree).map((row) => row.props.testID)).toEqual([
      "trip-preview-package-tt-couple",
      "trip-preview-package-tt-shared",
    ]);
  });

  test("a trip with no package shows no pricing card, not an empty one", async () => {
    const tree = await mountPreview(tripWith([]));
    expect(packageRows(tree)).toHaveLength(0);
    expect(
      tree.root.findAll((node) => node.props.testID === "trip-preview-packages"),
    ).toHaveLength(0);
  });

  test("the total shown is the trip total, 11 travelers", async () => {
    const tree = await mountPreview(
      tripWith([
        tier("tier-c", "tt-shared", "Shared", 120000, 8),
        tier("tier-b", "tt-private", "Private", 180000, 2),
        tier("tier-a", "tt-couple", "Couple", 300000, 1),
      ]),
    );
    expect(textOf(tree.root)).toContain("11 travelers max");
  });
});
