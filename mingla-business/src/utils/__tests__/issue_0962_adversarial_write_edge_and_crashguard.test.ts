// issue #962 [pre-bank-currency-degbp] — TESTER ADVERSARIAL (different angle
// from the implementor's R1). R1 only exercised the two canonical inputs:
// `currency: null` and `currency: "usd"`. This suite attacks the SEAM R1 left
// open — the BLANK / WHITESPACE / MIXED-CASE-WITH-SPACES edge inputs the trim
// logic in currencyCodeOrNull must classify correctly — and it independently
// re-proves that the ORCH-1152 Intl crash-guard (`normalizeCurrency`) was NOT
// weakened by the #962 fix.
//
// Attack matrix (all NEW vs R1):
//   1. WRITE-PATH EDGE INPUTS — `""`, `"   "` (whitespace-only), `"\t \n"` must
//      persist NULL (blank ⇒ unset) on BOTH draftToServerInsert AND
//      draftToServerUpdate, asserting BOTH the top-level events.currency column
//      AND the nested theme.business_draft.currency copy (the `:344` site — a
//      prior real bug was the theme copy diverging from the column). And
//      `" usd "` (lower-case, surrounded by spaces) must normalize to "USD".
//   2. REAL-CURRENCY NO-REGRESSION — "USD"/"NGN"/"EUR" must round-trip the EXACT
//      code through insert + update + hydrate (column + theme.business_draft),
//      proving the de-GBP fix did not null-out genuine currencies.
//   3. CRASH-GUARD INTACT — normalizeCurrency STILL returns "GBP" for blank
//      input, and formatCurrency/formatCurrencyRound STILL never throw on an
//      empty code (the RangeError guard the fix must not have removed).
//
// FAILS-ON-REVERT: revert serverDraftEventMapper.ts:344/633/673 to
// `normalizeCurrency(draft.currency)` → §1 blank-input assertions flip from
// null to "GBP" and FAIL. Revert currency.ts currencyCodeOrNull to return "GBP"
// on blank → same. Append-only; new file.

import { describe, expect, test } from "@jest/globals";

import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import {
  currencyCodeOrNull,
  formatCurrency,
  formatCurrencyRound,
  normalizeCurrency,
} from "../currency";
import {
  draftToServerInsert,
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../serverDraftEventMapper";

// --- Fixtures (self-contained; independent of the implementor's test file) ---

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-adv",
  name: "General",
  priceGbp: 20,
  capacity: 40,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...patch,
});

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "adv-0000-0000-0000-000000000962",
  brandId: "adv-brand-0000-0000-000000000962",
  serverSlug: "adversarial-supper",
  name: "Adversarial Supper",
  description: "Edge-input probe.",
  format: "in_person",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  whenMode: "single",
  date: "2026-09-01",
  doorsOpen: "18:30",
  endsAt: "22:00",
  endsAtUtc: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Studio",
  address: "1 Test Street",
  city: null,
  locationGeo: null,
  onlineUrl: null,
  hideAddressUntilTicket: false,
  coverHue: 200,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  tickets: [ticket()],
  visibility: "unlisted",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  isRsvp: false,
  rsvpCapacity: null,
  rsvpAllowPlusOnes: false,
  rsvpPlusOnesMax: 0,
  rsvpWaitlistEnabled: false,
  rsvpApprovalMode: "auto",
  rsvpDiscoverable: false,
  rsvpContributionEnabled: false,
  rsvpContributionSuggestedCents: null,
  rsvpContributionMinCents: null,
  lastStepReached: 5,
  status: "draft",
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:10:00.000Z",
  ...patch,
});

const rowFromPayload = (
  source: DraftEvent,
  theme: Record<string, unknown>,
  currency: string | null,
): ServerDraftEventRow => ({
  id: source.id,
  brand_id: source.brandId,
  created_by: "user-adv",
  title: source.name,
  description: source.description,
  slug: "draft-adv",
  location_text: "Studio",
  online_url: source.onlineUrl,
  cover_media_url: source.coverMediaUrl,
  cover_media_type: source.coverMediaType,
  cover_media_provider: source.coverMediaProvider ?? null,
  cover_media_source_url: source.coverMediaSourceUrl ?? null,
  cover_media_credit: source.coverMediaCredit ?? null,
  cover_media_credit_url: source.coverMediaCreditUrl ?? null,
  cover_media_alt: source.coverMediaAlt ?? null,
  currency,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  theme,
  visibility: "draft",
  status: "draft",
  timezone: source.timezone,
  created_at: source.createdAt,
  updated_at: source.updatedAt,
  published_at: null,
  deleted_at: null,
});

const themeCurrency = (theme: Record<string, unknown>): string | null =>
  (theme.business_draft as { currency: string | null }).currency;

describe("#962 adversarial — write-path BLANK/WHITESPACE inputs persist NULL (never GBP)", () => {
  // R1 tested only the literal `null`. These are the blank/whitespace variants
  // that the trim step in currencyCodeOrNull must fold to null — and which the
  // OLD normalizeCurrency would have fabricated into "GBP".
  const blanks: Array<[string, string]> = [
    ["empty string", ""],
    ["whitespace-only", "   "],
    ["tabs and newlines", "\t \n"],
  ];

  for (const [label, value] of blanks) {
    test(`insert: ${label} → NULL on column AND theme.business_draft`, () => {
      const payload = draftToServerInsert(
        draft({ currency: value }),
        "user-adv",
        "draft-blank-insert",
      );
      expect(payload.currency).toBeNull();
      expect(themeCurrency(payload.theme)).toBeNull();
      // Explicit anti-fabrication guard.
      expect(payload.currency).not.toBe("GBP");
      expect(themeCurrency(payload.theme)).not.toBe("GBP");
    });

    test(`update: ${label} → NULL on column AND theme.business_draft`, () => {
      const payload = draftToServerUpdate(draft({ currency: value }), {});
      expect(payload.currency).toBeNull();
      expect(themeCurrency(payload.theme)).toBeNull();
      expect(payload.currency).not.toBe("GBP");
      expect(themeCurrency(payload.theme)).not.toBe("GBP");
    });
  }

  test('lower-case-with-spaces " usd " normalizes to "USD" on insert AND update (column + theme)', () => {
    const insert = draftToServerInsert(
      draft({ currency: " usd " }),
      "user-adv",
      "draft-spaces-insert",
    );
    const update = draftToServerUpdate(draft({ currency: " usd " }), {});

    expect(insert.currency).toBe("USD");
    expect(themeCurrency(insert.theme)).toBe("USD");
    expect(update.currency).toBe("USD");
    expect(themeCurrency(update.theme)).toBe("USD");
  });
});

describe("#962 adversarial — REAL currencies round-trip EXACTLY (no de-GBP over-reach)", () => {
  // The critical no-regression guard: the fix must hide ONLY unset currencies,
  // never null-out a genuine one. R1 proved "usd" only; here NGN + EUR + USD,
  // through insert, update, AND hydrate (column + theme.business_draft).
  const codes = ["USD", "NGN", "EUR"];

  for (const code of codes) {
    test(`${code} survives insert → hydrate unchanged (column + theme)`, () => {
      const source = draft({ currency: code });
      const payload = draftToServerInsert(source, "user-adv", "draft-real-ins");
      const hydrated = serverRowToDraft(
        rowFromPayload(source, payload.theme, code),
      );

      expect(payload.currency).toBe(code);
      expect(themeCurrency(payload.theme)).toBe(code);
      expect(hydrated.currency).toBe(code);
    });

    test(`${code} survives update → hydrate unchanged (column + theme)`, () => {
      const source = draft({ currency: code });
      const payload = draftToServerUpdate(source, {});
      const hydrated = serverRowToDraft(
        rowFromPayload(source, payload.theme, code),
      );

      expect(payload.currency).toBe(code);
      expect(themeCurrency(payload.theme)).toBe(code);
      expect(hydrated.currency).toBe(code);
    });
  }

  test('a lower-case real code "ngn" is upper-cased, not dropped', () => {
    const payload = draftToServerInsert(
      draft({ currency: "ngn" }),
      "user-adv",
      "draft-lc",
    );
    expect(payload.currency).toBe("NGN");
    expect(themeCurrency(payload.theme)).toBe("NGN");
  });
});

describe("#962 adversarial — the ORCH-1152 crash-guard was NOT weakened", () => {
  // The whole #962 design rests on keeping normalizeCurrency byte-identical as
  // the Intl crash-guard while the WRITE path moved to currencyCodeOrNull. Prove
  // both halves are intact and distinct.
  test('normalizeCurrency STILL returns "GBP" for every blank input', () => {
    expect(normalizeCurrency("")).toBe("GBP");
    expect(normalizeCurrency("   ")).toBe("GBP");
    expect(normalizeCurrency("\t\n")).toBe("GBP");
    expect(normalizeCurrency(null)).toBe("GBP");
    expect(normalizeCurrency(undefined)).toBe("GBP");
  });

  test("normalizeCurrency still trims + upper-cases a real code", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
  });

  test("formatCurrency / formatCurrencyRound NEVER throw on an empty code (RangeError guard)", () => {
    expect(() => formatCurrency(0, "")).not.toThrow();
    expect(() => formatCurrency(1234.5, "   ")).not.toThrow();
    expect(() => formatCurrencyRound(0, "")).not.toThrow();
    expect(() => formatCurrencyRound(98765, "\t")).not.toThrow();
    // And the guarded output is the GBP-shaped safe fallback, not a crash.
    expect(formatCurrency(0, "")).toContain("£");
    expect(formatCurrencyRound(0, "")).toContain("£");
  });

  test("currencyCodeOrNull is the null-safe sibling — distinct from normalizeCurrency", () => {
    // Blank ⇒ null (write/display), whereas normalizeCurrency ⇒ "GBP" (crash-guard).
    expect(currencyCodeOrNull("")).toBeNull();
    expect(currencyCodeOrNull("   ")).toBeNull();
    expect(currencyCodeOrNull("\t\n")).toBeNull();
    expect(currencyCodeOrNull(null)).toBeNull();
    expect(currencyCodeOrNull(undefined)).toBeNull();
    // Real ⇒ trimmed + upper-cased code.
    expect(currencyCodeOrNull(" usd ")).toBe("USD");
    expect(currencyCodeOrNull("eur")).toBe("EUR");
    expect(currencyCodeOrNull("NGN")).toBe("NGN");
    // The two siblings genuinely diverge on blank input.
    expect(currencyCodeOrNull("")).not.toBe(normalizeCurrency(""));
  });
});
