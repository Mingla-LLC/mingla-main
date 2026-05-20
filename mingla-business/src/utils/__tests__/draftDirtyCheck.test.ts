/**
 * draftDirtyCheck.test — ORCH-0893 [Eager server-draft on creator entry —
 * replace with client-id + lazy autosave (event + trip wizards)].
 *
 * Implementor happy-path regression test for the gate primitive
 * `isDraftDirty(draft)` used by `app/event/[id]/edit.tsx`'s
 * `handleAutosaveDraft` wrapper to decide whether a client-only
 * `d_<ts36>` draft should trigger a server-side `createServerDraft`
 * insert.
 *
 * Synthetic-draft fixture pattern matches the project convention in
 * `serverDraftEventMapper.test.ts`: type-only import of `DraftEvent`
 * keeps the test free of the Supabase / Expo Constants runtime chain
 * that breaks jest transforms (per `mingla-business/jest.config.cjs`).
 *
 * Fails-on-revert: revert `src/utils/draftDirtyCheck.ts` to a
 * "always returns true" stub (or remove any single field check) —
 * the corresponding case below should fail.
 *
 * Per SPEC §11.1 + §10 SC-3 + SC-5.
 */

import { describe, expect, test } from "@jest/globals";

import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { isDraftDirty } from "../draftDirtyCheck";

// Cold-default DraftEvent matching `DEFAULT_DRAFT_FIELDS` in
// `mingla-business/src/store/draftEventStore.ts` (post-ORCH-0824 +
// ORCH-0841 + ORCH-0877 endsAtUtc). Keeps the test free of the
// runtime `buildDraftEvent` import chain.
const defaultDraft = (overrides: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "d_test_orch_0893",
  brandId: "b_test_orch_0893",
  serverSlug: null,
  name: "",
  description: "",
  format: "in_person",
  whenMode: "single",
  date: null,
  doorsOpen: null,
  endsAt: null,
  endsAtUtc: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: null,
  address: null,
  city: null,
  locationGeo: null,
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 0,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: null,
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  tickets: [],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  lastStepReached: 0,
  status: "draft",
  clientRevision: 0,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  ...overrides,
});

const sampleTicket: TicketStub = {
  id: "t_test",
  name: "Standard",
  priceGbp: 10,
  capacity: 100,
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
};

describe("ORCH-0893 isDraftDirty — gate primitive for lazy server-insert", () => {
  test("pure cold-default draft returns false (no ghost server row)", () => {
    expect(isDraftDirty(defaultDraft())).toBe(false);
  });

  test("non-empty name flips to true", () => {
    expect(isDraftDirty(defaultDraft({ name: "My event" }))).toBe(true);
  });

  test("whitespace-only name stays false (trimmed)", () => {
    expect(isDraftDirty(defaultDraft({ name: "   " }))).toBe(false);
  });

  test("non-empty description flips to true", () => {
    expect(isDraftDirty(defaultDraft({ description: "Hello world" }))).toBe(true);
  });

  test("coverMediaUrl non-null flips to true", () => {
    expect(
      isDraftDirty(
        defaultDraft({ coverMediaUrl: "https://example.com/cover.jpg" }),
      ),
    ).toBe(true);
  });

  test("any ticket added flips to true", () => {
    expect(isDraftDirty(defaultDraft({ tickets: [sampleTicket] }))).toBe(true);
  });

  test("date set flips to true", () => {
    expect(isDraftDirty(defaultDraft({ date: "2026-06-15" }))).toBe(true);
  });

  test("doorsOpen set flips to true", () => {
    expect(isDraftDirty(defaultDraft({ doorsOpen: "19:30" }))).toBe(true);
  });

  test("endsAt set flips to true", () => {
    expect(isDraftDirty(defaultDraft({ endsAt: "23:00" }))).toBe(true);
  });

  test("venueName set flips to true", () => {
    expect(isDraftDirty(defaultDraft({ venueName: "The Spot" }))).toBe(true);
  });

  test("address set flips to true", () => {
    expect(isDraftDirty(defaultDraft({ address: "123 Main St" }))).toBe(true);
  });

  test("onlineUrl set flips to true", () => {
    expect(
      isDraftDirty(defaultDraft({ onlineUrl: "https://zoom.us/j/123" })),
    ).toBe(true);
  });

  test("lastStepReached > 0 flips to true", () => {
    expect(isDraftDirty(defaultDraft({ lastStepReached: 1 }))).toBe(true);
  });

  test("non-empty partyTypes flips to true", () => {
    expect(isDraftDirty(defaultDraft({ partyTypes: ["dinner"] }))).toBe(true);
  });

  test("non-empty vibeTags flips to true", () => {
    expect(isDraftDirty(defaultDraft({ vibeTags: ["chill"] }))).toBe(true);
  });

  test("non-empty musicGenres flips to true", () => {
    expect(isDraftDirty(defaultDraft({ musicGenres: ["jazz"] }))).toBe(true);
  });

  test("format change from in_person flips to true", () => {
    expect(isDraftDirty(defaultDraft({ format: "online" }))).toBe(true);
  });
});
