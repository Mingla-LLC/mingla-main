/**
 * issue #1014 — TESTER ADVERSARIAL suite: NULL-currency display glyph hunt.
 *
 * §9 angle (6): a published NULL-currency (free-only) event must NEVER render a
 * fabricated currency glyph anywhere. This suite attacks the shared CTA state
 * machine at runtime (pure module — real execution, not source reading) with
 * the fixtures the implementor's suites never build:
 *   - all-free NULL-currency ticket set → `free` CTA, no glyph;
 *   - the §9 angle (3) 0-priced NON-isFree ticket → the CTA machine takes the
 *     PAID branch (isFree-flag based) but the #1014 price===0 free-branch must
 *     still render "Free", never a formatted 0-amount with a symbol;
 *   - defensive: a (schema-impossible) paid ticket with null currency + null
 *     fallback must not fabricate a symbol.
 * Plus source-level tripwires on the two host render sites whose fabricated
 * fallbacks #1014 removed (PublicEventPage `?? "GBP"`/`?? "USD"`,
 * UpcomingListItem "No sales yet") — reading source as TEXT is the established
 * pattern in this repo for pinning host wiring without an RN mount.
 *
 * fails-on-revert: deleting the `if (price === 0) return "Free";` branch in
 * packages/offering-rendering/offeringCta.ts turns the 0-priced non-isFree
 * test red; restoring goes green (verified by true line deletion).
 *
 * CI: picked up by .github/workflows/issue-1014-free-publish-currency-tests.yml
 * (`npx jest issue_1014 …` pattern; packages/offering-rendering/** is in the
 * workflow's path filters).
 */

import * as fs from "fs";
import * as path from "path";
// Relative import on purpose: the node_modules symlink route is excluded by
// transformIgnorePatterns; the direct path is transformed by ts-jest.
import {
  resolveOfferingCta,
  type ResolveOfferingCtaInput,
} from "../../../../packages/offering-rendering/offeringCta";
import type { PublicTicketProps } from "../../../../packages/offering-rendering/types";

const CURRENCY_GLYPHS = /[£$€₦¥]|GBP|USD|EUR|NGN/;

const ticket = (over: Partial<PublicTicketProps>): PublicTicketProps => ({
  id: "t1",
  name: "Free entry",
  description: null,
  priceGbp: 0,
  priceAllInGbp: null,
  currency: null,
  isFree: true,
  isUnlimited: false,
  capacity: 50,
  visibility: "public" as PublicTicketProps["visibility"],
  passwordProtected: false,
  password: null,
  saleStartAt: null,
  saleEndAt: null,
  approvalRequired: false,
  waitlistEnabled: false,
  availableAt: "both" as PublicTicketProps["availableAt"],
  displayOrder: 0,
  ...over,
});

const cta = (tickets: PublicTicketProps[]): ReturnType<typeof resolveOfferingCta> =>
  resolveOfferingCta({
    variant: "published",
    bookable: true,
    tickets,
    currency: null,
  } satisfies ResolveOfferingCtaInput);

describe("issue #1014 §9(6) — NULL-currency event CTA never fabricates a glyph", () => {
  it("all-free NULL-currency tickets resolve the free CTA (no price string at all)", () => {
    const state = cta([ticket({})]);
    expect(state.kind).toBe("free");
    expect(JSON.stringify(state)).not.toMatch(CURRENCY_GLYPHS);
  });

  it("§9(3): a 0-priced NON-isFree NULL-currency ticket renders Free, never a formatted 0-amount", () => {
    // The CTA free-branch is isFree-FLAG based, so this fixture drives the
    // PAID branch — the #1014 `price === 0 → "Free"` guard is the only thing
    // between this ticket and `formatMoney(0, null)`.
    const state = cta([ticket({ isFree: false, priceGbp: 0 })]);
    expect(state.kind).toBe("buy");
    if (state.kind === "buy") {
      expect(state.price).toBe("Free");
    }
    expect(JSON.stringify(state)).not.toMatch(CURRENCY_GLYPHS);
  });

  it("defensive: a paid NULL-currency ticket with NULL fallback renders a bare amount, no symbol", () => {
    // Schema-impossible after #1014 (paid rows always carry currency) — the
    // defensive branch must render digits only, never fabricate a symbol.
    const state = cta([ticket({ isFree: false, priceGbp: 12.5 })]);
    expect(state.kind).toBe("buy");
    if (state.kind === "buy") {
      expect(state.price).toBe("12.50");
      expect(state.price).not.toMatch(CURRENCY_GLYPHS);
    }
  });

  it("mixed set: free NULL ticket + paid GBP ticket formats ONLY the paid tier's own currency", () => {
    const state = cta([
      ticket({}),
      ticket({ id: "t2", name: "VIP", isFree: false, priceGbp: 10, currency: "GBP" }),
    ]);
    expect(state.kind).toBe("buy");
    if (state.kind === "buy") {
      // The paid tier carries its own GBP — formatting it is CORRECT (the
      // ticket's real currency), and the NULL fallback must not corrupt it.
      expect(state.price).toContain("£");
    }
  });
});

describe("issue #1014 §9(6) — host render-site tripwires (source-level)", () => {
  const read = (rel: string): string =>
    fs.readFileSync(path.resolve(__dirname, rel), "utf8");

  it("PublicEventPage host adapter no longer fabricates GBP/USD for the shared page", () => {
    const src = read("../../components/event/PublicEventPage.tsx");
    expect(src).not.toContain('currency: event.currency ?? "GBP"');
    expect(src).not.toContain('settlementCurrency: event.currency ?? "USD"');
    expect(src).toContain("currency: event.currency ?? null");
    expect(src).toContain("settlementCurrency: event.currency ?? null");
  });

  it("UpcomingListItem renders honest words, not £0, when both currencies are null", () => {
    const src = read("../../components/home/UpcomingListItem.tsx");
    expect(src).toContain('"No sales yet"');
    expect(src).not.toContain('formatCurrencyRound(0, event.currency ?? currentBrandCurrency ?? "GBP")');
  });

  it("the shared RSVP body hides the chip-in panel instead of formatting fabricated USD", () => {
    const src = read("../../../../packages/offering-rendering/RsvpOfferingBody.tsx");
    expect(src).not.toContain('config.settlementCurrency ?? event.currency ?? "USD"');
    expect(src).toContain("chipCurrency !== null");
  });

  it("createTripDraft no longer fabricates USD on currency-less trip drafts", () => {
    // Scoped to the SPEC-allowlisted createTripDraft block: the draft-creation
    // fallback is `?? null` now. (Two `?? "USD"` fallbacks REMAIN in
    // updateTripPricing/createTripPricingTier further down the file — outside
    // the #1014 allowlist; reported as tester finding F-2, not pinned here.)
    const src = read("../../services/tripsService.ts");
    const start = src.indexOf("export async function createTripDraft");
    const end = src.indexOf("export async function", start + 1);
    expect(start).toBeGreaterThan(-1);
    const block = src
      .slice(start, end)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(block).not.toContain('?? "USD"');
    expect(block).toContain(
      '(brandCurrencyQuery.data?.default_currency as string | null) ?? null',
    );
  });
});
