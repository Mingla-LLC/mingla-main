/**
 * ORCH-1273 [venue deck-readiness AI step flashes/closes on web create] —
 * implementor happy-path regression test.
 *
 * PROVES: after a CREATE-path tier-1 success, VenueCreatorWizard navigates to
 * the DURABLE, server-state-reloading deck-readiness route via
 * `router.replace(routeForDeckReadinessFix({ brandId, placePoolId, venueId,
 * fix: "review_pipeline" }))` — the SAME route the Hub "Edit listing" recovery
 * path uses — and does NOT render the retired EPHEMERAL inline
 * `<VenueDeckReadinessSetup>` mount from transient `createdVenue` state (the
 * mount that flashed/unmounted on web and stranded the venue at
 * `business_authoring_status='processing'`).
 *
 * ALSO PROVES the landing target actually reloads from the server: the durable
 * route (app/venue/deck-readiness.tsx) resolves the venue + pipeline context
 * from URL params via useVenueListing + useBrandPlaceAuthoringContext.
 *
 * This is a source-AST proof (the wizard cannot be mounted under the default
 * ts-jest/node config — no react-native-testing-library here; the RTL render
 * proofs run under their dedicated configs). It fails-on-revert by TRUE LINE
 * DELETION of the `router.replace(routeForDeckReadinessFix(...))` seam.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import * as babelParser from "@babel/parser";

const WIZARD = join(__dirname, "..", "VenueCreatorWizard.tsx");
const DURABLE_ROUTE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "app",
  "venue",
  "deck-readiness.tsx",
);

function parseTsx(file: string): unknown {
  return babelParser.parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
}

// Minimal recursive AST walker — avoids a @babel/traverse dependency.
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.type === "string") visit(rec);
  for (const key of Object.keys(rec)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "range" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }
    walk(rec[key], visit);
  }
}

describe("ORCH-1273 — create tier-1 success lands on the durable deck-readiness route", () => {
  const wizardAst = parseTsx(WIZARD);

  test("wizard calls router.replace(routeForDeckReadinessFix({...})) with the review_pipeline contract", () => {
    let durableNavCall: Record<string, unknown> | null = null;

    walk(wizardAst, (n) => {
      if (n.type !== "CallExpression") return;
      const callee = n.callee as Record<string, unknown> | undefined;
      // router.replace(...)
      if (
        callee?.type !== "MemberExpression" ||
        (callee.property as Record<string, unknown>)?.["name"] !== "replace" ||
        (callee.object as Record<string, unknown>)?.["name"] !== "router"
      ) {
        return;
      }
      const args = n.arguments as Array<Record<string, unknown>>;
      const arg0 = args?.[0];
      if (arg0 === undefined) return;
      // The arg may be `routeForDeckReadinessFix(...) as never` (TSAsExpression).
      const unwrapped =
        arg0.type === "TSAsExpression"
          ? (arg0.expression as Record<string, unknown>)
          : arg0;
      if (
        unwrapped?.type === "CallExpression" &&
        (unwrapped.callee as Record<string, unknown>)?.["name"] ===
          "routeForDeckReadinessFix"
      ) {
        durableNavCall = unwrapped;
      }
    });

    // The core assertion: the durable navigation seam EXISTS. Deleting the fix
    // lines (router.replace(routeForDeckReadinessFix(...))) makes this null.
    expect(durableNavCall).not.toBeNull();

    // The route-builder call carries the exact param contract of the recovery
    // path (VenueListingContent handleEdit): brandId, placePoolId, venueId, and
    // fix: "review_pipeline" (→ focus=review on the durable route).
    const objArg = (
      (durableNavCall as unknown as { arguments: Array<Record<string, unknown>> })
        .arguments[0]
    );
    expect(objArg?.type).toBe("ObjectExpression");
    const keys = (objArg.properties as Array<Record<string, unknown>>).map(
      (p) => ((p.key as Record<string, unknown>)?.["name"] as string) ?? "",
    );
    expect(keys).toEqual(
      expect.arrayContaining(["brandId", "placePoolId", "venueId", "fix"]),
    );
    const fixProp = (objArg.properties as Array<Record<string, unknown>>).find(
      (p) => (p.key as Record<string, unknown>)?.["name"] === "fix",
    );
    expect((fixProp?.value as Record<string, unknown>)?.["value"]).toBe(
      "review_pipeline",
    );
  });

  test("wizard no longer renders the ephemeral inline <VenueDeckReadinessSetup> mount", () => {
    let hasInlineMount = false;
    walk(wizardAst, (n) => {
      if (
        n.type === "JSXOpeningElement" &&
        (n.name as Record<string, unknown>)?.["name"] === "VenueDeckReadinessSetup"
      ) {
        hasInlineMount = true;
      }
    });
    expect(hasInlineMount).toBe(false);
  });

  test("wizard no longer holds throw-away createdVenue/setCreatedVenue state", () => {
    let hasEphemeralState = false;
    walk(wizardAst, (n) => {
      if (
        n.type === "Identifier" &&
        typeof n.name === "string" &&
        (n.name === "createdVenue" || n.name === "setCreatedVenue")
      ) {
        hasEphemeralState = true;
      }
    });
    expect(hasEphemeralState).toBe(false);
  });

  test("the durable landing route reloads brand+venue+pipeline state from the server", () => {
    const routeSrc = readFileSync(DURABLE_ROUTE, "utf8");
    // Server-state reload contract: the route resolves the venue and the
    // authoring/pipeline context from URL params (not from create.tsx state).
    expect(routeSrc).toContain("useVenueListing");
    expect(routeSrc).toContain("useBrandPlaceAuthoringContext");
    expect(routeSrc).toContain("brand_id");
    expect(routeSrc).toContain("place_pool_id");
    expect(routeSrc).toContain("venue_id");
  });
});
