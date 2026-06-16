/**
 * ORCH-1138 Leg 3 [public experience page redesign] — happy-path regression.
 *
 * Source-string + behavioral assertions (the RN components can't mount under
 * ts-jest — the established ORCH-1138 pattern; sibling tripReserveFloatDock).
 * Covers SC-1 theming, SC-2 read-path, SC-3 adaptive Reserve, SC-4 verb, SC-5
 * single CTA (no split), SC-11 rule-9 (no fabricated fields), SC-12 wizard
 * byte-stable, and the byte-identical-checkout contract.
 *
 * fails-on-revert: deleting any asserted line / formula flips a case red.
 * Owner: mingla-implementor.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const serviceSrc = read("src/services/publicExperienceService.ts");
const previewSrc = read("src/components/experience/ExperiencePreview.tsx");
const routeSrc = read("app/exp/[brandSlug]/[experienceSlug].tsx");
const pickerSrc = read("src/components/experience/ExperienceReservePicker.tsx");
const checkoutSvcSrc = read("src/services/ticketCheckoutService.ts");

describe("ORCH-1138 Leg 3 — experience page redesign", () => {
  // ── SC-1 theming ──
  test("SC-1 the route resolves a brand palette (resolveTheme → createThemePalette)", () => {
    expect(routeSrc).toMatch(/resolveTheme\(\s*brand\.theme/);
    expect(routeSrc).toMatch(/createThemePalette\(theme\)/);
    expect(routeSrc).toMatch(/resolveOfferingSurface\(theme\)/);
  });

  test("SC-1 the FOUNDATION preview is NOT locked to the hardcoded dark page bg / warm accent", () => {
    // FoundationExperiencePreview themes everything off the resolved palette/surface.
    expect(previewSrc).toMatch(/FoundationExperiencePreview/);
    expect(previewSrc).toMatch(/offeringSurfaceStyles\(palette\)/);
    // the FOUNDATION render path uses palette.accent, never a hardcoded #0c0e12
    // page or accent.warm accent (those belong to the LEGACY wizard branch only).
    // slice the FOUNDATION component DEFINITION (not the dispatcher JSX) — from
    // its `const FoundationExperiencePreview: React.FC` decl to the LEGACY decl.
    const foundationBlock = previewSrc.slice(
      previewSrc.indexOf("const FoundationExperiencePreview"),
      previewSrc.indexOf("const LegacyExperiencePreview"),
    );
    expect(foundationBlock).toMatch(/palette\.accent/);
    expect(foundationBlock).not.toMatch(/#0c0e12/);
    expect(foundationBlock).not.toMatch(/accent\.warm/);
  });

  // ── SC-2 read-path ──
  test("SC-2 the service reads the real authored stop blurb + coords + vibe intents", () => {
    expect(serviceSrc).toMatch(/ai_description, lat, lng/); // widened SELECT
    expect(serviceSrc).toMatch(/description:\s*\n?\s*typeof s\.ai_description/);
    expect(serviceSrc).toMatch(/intents:\s*readIntents\(event\.experience_intents\)/);
  });

  test("SC-2 the preview renders real vibe chips + per-stop blurb + a stop-1 map (rule 9: only when present)", () => {
    expect(previewSrc).toMatch(/vibeChips/);
    expect(previewSrc).toMatch(/stop\.description/);
    // map block guarded on real coords (find the first stop with lat/lng).
    expect(previewSrc).toMatch(/s\.lat !== null && s\.lng !== null/);
    expect(previewSrc).toMatch(/buildStaticMapUrl/);
  });

  // ── SC-3 adaptive Reserve ──
  test("SC-3 Reserve is adaptive: >1/open-daily → picker; ===1 auto-select; 0/single → straight to cart", () => {
    expect(routeSrc).toMatch(/usesPicker/);
    expect(routeSrc).toMatch(/bookable\.length > 1/);
    expect(routeSrc).toMatch(/bookable\.length === 1/);
    // the ===1 path auto-selects that occurrence's eventDateId then goes to cart.
    expect(routeSrc).toMatch(/goToCart\(\{\s*eventDateId:\s*bookable\[0\]\.id/);
    // the 0/single path goes straight to cart with NO selection (no eventDateId).
    expect(routeSrc).toMatch(/goToCart\(\);\s*\/\/ single \/ no-date/);
  });

  test("SC-3 a picked slot adds eventDateId; the null path is byte-identical", () => {
    // the route threads the chosen occurrence as a route param only when present.
    expect(routeSrc).toMatch(/routeParams\.eventDateId = selection\.eventDateId/);
    // the checkout service forwards eventDateId ONLY when present (byte-identical null path).
    expect(checkoutSvcSrc).toMatch(
      /input\.eventDateId !== undefined && input\.eventDateId\.length > 0/,
    );
    expect(checkoutSvcSrc).toMatch(/\{ eventDateId: input\.eventDateId \}/);
  });

  // ── SC-4 verb ──
  test("SC-4 every Reserve affordance reads 'Reserve' (no 'Get my spot' divergence)", () => {
    expect(routeSrc).toMatch(/label:\s*"Reserve"/);
    expect(routeSrc).not.toMatch(/Get my spot/);
    expect(pickerSrc).toMatch(/Reserve →/);
  });

  // ── SC-5 single CTA, no split ──
  test("SC-5 the experience page renders ONE Reserve CTA — no pay-in-full/over-time split", () => {
    // the route reuses TripReserveBar but NEVER passes splitCtas (experiences have no plan).
    expect(routeSrc).toMatch(/<TripReserveBar/);
    expect(routeSrc).not.toMatch(/splitCtas=/);
  });

  // ── SC-11 rule 9 (no fabricated fields) ──
  test("SC-11 the experience preview renders NO inclusions block / refund ladder / per-stop price", () => {
    expect(previewSrc).not.toMatch(/What.?s included/);
    expect(previewSrc).not.toMatch(/Cancellation policy/);
    expect(previewSrc).not.toMatch(/RefundLadder/);
    expect(previewSrc).not.toMatch(/refund_pct/);
    // no per-stop price line (the buyer buys the ONE all-in ticket).
    expect(previewSrc).not.toMatch(/stop\.price/);
  });

  // ── SC-12 wizard byte-stable (LEGACY branch preserved) ──
  test("SC-12 the LEGACY (wizard) mode is preserved (palette-absent fallback)", () => {
    expect(previewSrc).toMatch(/LegacyExperiencePreview/);
    // FOUNDATION mode is entered ONLY when palette + theme + chrome handlers exist.
    expect(previewSrc).toMatch(/palette !== undefined &&\s*\n?\s*theme !== undefined/);
  });

  // ── open-daily (SC-6) any-time-in-window + party-size ──
  test("SC-6 open-daily picker offers date + time-within-window + party-size (= quantity, never new lines)", () => {
    expect(pickerSrc).toMatch(/mode === "open-daily"/);
    expect(pickerSrc).toMatch(/timeChoices/);
    expect(pickerSrc).toMatch(/windowMinutes/); // time bound to the occurrence window
    expect(pickerSrc).toMatch(/party/);
    // party-size maps to cart quantity (the route passes quantity to the checkout path).
    expect(routeSrc).toMatch(/routeParams\.quantity = String\(selection\.quantity\)/);
  });
});
