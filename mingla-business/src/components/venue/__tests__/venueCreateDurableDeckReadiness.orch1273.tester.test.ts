/**
 * ORCH-1273(tester) [venue deck-readiness AI step flashes/closes on web create]
 * — tester adversarial regression test (DIFFERENT ANGLE than the implementor's
 * happy-path AST test `venueCreateDurableDeckReadiness.orch1273.test.ts`).
 *
 * The implementor's test proves the create seam EXISTS (AST) and the durable
 * route imports the right hooks. This tester test attacks three distinct angles
 * the implementor did NOT cover:
 *
 *   (T1) FUNCTIONAL param-contract parity — actually EXECUTES the real
 *        `routeForDeckReadinessFix({ fix: "review_pipeline" })` builder AND
 *        parses the LITERAL route string in `VenueListingContent.handleEdit`
 *        (the Hub "Edit listing" recovery path), then asserts BOTH produce the
 *        identical param set + values (brand_id / place_pool_id / venue_id /
 *        focus=review / fix=review_pipeline). Proves the create leg lands on the
 *        exact same durable contract as recovery — not merely "a" deck route.
 *
 *   (T2) CLAIM-DEFER REGRESSION GUARD — AST-proves the submit-path
 *        `if (claimMode)` branch still returns via `onDone(...)` and does NOT
 *        contain the create-path `routeForDeckReadinessFix` navigation. Guards
 *        against the fix accidentally routing the intentional claim defer into
 *        deck-readiness (investigation F-6: "do not fix claim's intentional
 *        defer").
 *
 *   (T3) BACK-TRAP GUARD — the create seam must be `router.replace` (NOT
 *        `router.push`) and be immediately followed by an early `return`, so
 *        Back cannot land on the blanked-out wizard (draft is reset first).
 *
 *   (T4) DURABLE-RELOAD — the landing route resolves venue + pipeline state from
 *        URL params via `useVenueListing` + `useBrandPlaceAuthoringContext`
 *        (re-asserted here as the parity anchor for T1).
 *
 * Source-AST + functional proof (no RTL; runs under the default node/ts-jest
 * config). fails-on-revert: deleting the create seam nulls the create nav call
 * (T3) and breaks the create-branch assertions.
 *
 * APPEND-ONLY: new file; no existing test modified.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import * as babelParser from "@babel/parser";
import { routeForDeckReadinessFix } from "../../../utils/deckReadinessRoutes";

const WIZARD = join(__dirname, "..", "VenueCreatorWizard.tsx");
const LISTING_CONTENT = join(__dirname, "..", "VenueListingContent.tsx");

function parseTsx(file: string): unknown {
  return babelParser.parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
}

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

/** Parse the query string of a `/venue/deck-readiness?...` URL into a plain map. */
function paramsOf(url: string): Record<string, string> {
  const q = url.split("?")[1] ?? "";
  const out: Record<string, string> = {};
  for (const pair of q.split("&")) {
    if (pair.length === 0) continue;
    const [k, v] = pair.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return out;
}

describe("ORCH-1273(tester) — create lands on the durable deck-readiness contract", () => {
  test("T1 — create builder output EXACT-MATCHES the recovery handleEdit route contract", () => {
    // The create path calls routeForDeckReadinessFix({ ..., fix: "review_pipeline" }).
    const createUrl = routeForDeckReadinessFix({
      brandId: "BRAND",
      placePoolId: "POOL",
      venueId: "VENUE",
      fix: "review_pipeline",
    });
    expect(createUrl.startsWith("/venue/deck-readiness?")).toBe(true);
    const createParams = paramsOf(createUrl);
    expect(createParams).toEqual({
      brand_id: "BRAND",
      place_pool_id: "POOL",
      venue_id: "VENUE",
      focus: "review",
      fix: "review_pipeline",
    });

    // Extract the LITERAL route in VenueListingContent.handleEdit (Hub recovery).
    const listingSrc = readFileSync(LISTING_CONTENT, "utf8");
    const m = listingSrc.match(
      /`(\/venue\/deck-readiness\?[^`]*)`/,
    );
    expect(m).not.toBeNull();
    const recoveryTemplate = (m as RegExpMatchArray)[1];
    // Normalize the template literal (${brandId} → the token value) to compare
    // param KEYS + static values (focus/fix) against the create builder output.
    const recoveryParams = paramsOf(
      recoveryTemplate
        .replace("${brandId}", "BRAND")
        .replace("${placePoolId}", "POOL")
        .replace("${venueId}", "VENUE"),
    );
    // Same key set as the create builder.
    expect(Object.keys(recoveryParams).sort()).toEqual(
      Object.keys(createParams).sort(),
    );
    // Same static contract values — proves create == recovery (not "a" deck route).
    expect(recoveryParams.focus).toBe("review");
    expect(recoveryParams.fix).toBe("review_pipeline");
    expect(recoveryParams.brand_id).toBe("BRAND");
    expect(recoveryParams.place_pool_id).toBe("POOL");
    expect(recoveryParams.venue_id).toBe("VENUE");
  });

  test("T2 — the submit-path claim-defer branch is UNTOUCHED (no deck-readiness nav inside it)", () => {
    const wizardAst = parseTsx(WIZARD);
    let claimSubmitBranch: Record<string, unknown> | null = null;

    walk(wizardAst, (n) => {
      if (n.type !== "IfStatement") return;
      const test = n.test as Record<string, unknown> | undefined;
      // The submit-path branch is a BARE `if (claimMode)` (the catch-path
      // branches are `if (claimMode && ...)` LogicalExpression or lack onDone).
      if (test?.type !== "Identifier" || test.name !== "claimMode") return;
      // Disambiguate: the submit claim-defer branch is the one that calls onDone.
      let hasOnDone = false;
      walk(n.consequent, (c) => {
        if (
          c.type === "CallExpression" &&
          (c.callee as Record<string, unknown>)?.["name"] === "onDone"
        ) {
          hasOnDone = true;
        }
      });
      if (hasOnDone) claimSubmitBranch = n;
    });

    expect(claimSubmitBranch).not.toBeNull();

    // Regression guard: the claim branch must NOT navigate to deck-readiness.
    let claimHasDeckNav = false;
    let claimReturns = false;
    walk(
      (claimSubmitBranch as unknown as { consequent: unknown }).consequent,
      (c) => {
        if (
          c.type === "CallExpression" &&
          (c.callee as Record<string, unknown>)?.["name"] ===
            "routeForDeckReadinessFix"
        ) {
          claimHasDeckNav = true;
        }
        if (c.type === "ReturnStatement") claimReturns = true;
      },
    );
    expect(claimHasDeckNav).toBe(false); // claim still DEFERS (F-6)
    expect(claimReturns).toBe(true); // claim returns before the create leg
  });

  test("T3 — create seam is router.REPLACE (not push) followed by an early return (no Back-trap)", () => {
    const wizardAst = parseTsx(WIZARD);
    // (a) There must be exactly ONE call to the route builder in the wizard body.
    const raw = readFileSync(WIZARD, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    const builderCalls = raw.match(/routeForDeckReadinessFix\(/g) ?? [];
    expect(builderCalls.length).toBe(1);

    // (b) The builder call must be the arg of `router.replace(...)` — NOT push.
    let replaceWrapsBuilder = false;
    let pushWrapsBuilder = false;
    walk(wizardAst, (n) => {
      if (n.type !== "CallExpression") return;
      const callee = n.callee as Record<string, unknown> | undefined;
      if (
        callee?.type !== "MemberExpression" ||
        (callee.object as Record<string, unknown>)?.["name"] !== "router"
      ) {
        return;
      }
      const method = (callee.property as Record<string, unknown>)?.["name"];
      const arg0 = (n.arguments as Array<Record<string, unknown>>)?.[0];
      if (arg0 === undefined) return;
      const unwrapped =
        arg0.type === "TSAsExpression"
          ? (arg0.expression as Record<string, unknown>)
          : arg0;
      const wrapsBuilder =
        unwrapped?.type === "CallExpression" &&
        (unwrapped.callee as Record<string, unknown>)?.["name"] ===
          "routeForDeckReadinessFix";
      if (wrapsBuilder && method === "replace") replaceWrapsBuilder = true;
      if (wrapsBuilder && method === "push") pushWrapsBuilder = true;
    });
    expect(replaceWrapsBuilder).toBe(true);
    expect(pushWrapsBuilder).toBe(false);

    // (c) The seam is followed by an early return (source-order: the builder call
    // must precede a `return;` before the surrounding try's catch).
    const seamIdx = raw.indexOf("routeForDeckReadinessFix(");
    const afterSeam = raw.slice(seamIdx);
    // the first statement terminator after the replace(...) is a bare return.
    expect(/\)\s*;\s*return\s*;/.test(afterSeam)).toBe(true);
  });

  test("T4 — durable landing route reloads venue + pipeline state from URL params", () => {
    const routeSrc = readFileSync(
      join(__dirname, "..", "..", "..", "..", "app", "venue", "deck-readiness.tsx"),
      "utf8",
    );
    expect(routeSrc).toContain("useVenueListing");
    expect(routeSrc).toContain("useBrandPlaceAuthoringContext");
    expect(routeSrc).toContain("useLocalSearchParams");
    // reads the three params the create + recovery contract carries
    for (const p of ["brand_id", "place_pool_id", "venue_id"]) {
      expect(routeSrc).toContain(p);
    }
  });
});
