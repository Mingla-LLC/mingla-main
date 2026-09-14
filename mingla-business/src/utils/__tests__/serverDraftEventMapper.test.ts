// ORCH-0962 [pre-bank currency de-GBP] — the currency assertions in this file
// were inverted (prior `.toBe("GBP")` → `.toBeNull()`) because they encoded the
// BUG behavior: the draft write path used to fabricate "GBP" for a pre-bank brand
// that genuinely has no currency (`brands.default_currency = NULL`, migration
// 0769 "NULL means not set; do not imply GBP"). The mapper now persists NULL via
// `currencyCodeOrNull`, so the correct expectation is null. The explicit
// `draft({ currency: "usd" })` round-trip test is UNCHANGED — a SET currency must
// still round-trip verbatim. Sanctioned test correction:
// [TEST-MOD-APPROVED ORCH-0962]
import { describe, expect, test } from "@jest/globals";

import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { validatePublish } from "../draftEventValidation";
import {
  draftToServerInsert,
  draftToServerUpdate,
  publishedVisibilityForDraft,
  serverRowToDraft,
  type ServerDraftEventRow,
  type ServerDraftEventUpdate,
} from "../serverDraftEventMapper";

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-1",
  name: "General",
  priceGbp: 12,
  capacity: 30,
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
  id: "f1ba5ee0-6a6b-4bb8-8a4c-7a89ea8b46d2",
  brandId: "64cb8e35-5b53-4633-8780-d7769bead244",
  serverSlug: "friday-supper-1a2b",
  name: "Friday Supper",
  description: "A proper supper club.",
  format: "hybrid",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  whenMode: "multi_date",
  date: null,
  doorsOpen: "18:30",
  endsAt: "22:00",
  endsAtUtc: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: [
    {
      id: "md-1",
      date: "2026-06-01",
      startTime: "18:30",
      endTime: "22:00",
      overrides: {
        title: "Night one",
        description: null,
        venueName: "Studio",
        address: null,
        onlineUrl: null,
      },
    },
    {
      id: "md-2",
      date: "2026-06-02",
      startTime: "18:30",
      endTime: "22:00",
      overrides: {
        title: null,
        description: "Second night",
        venueName: null,
        address: "1 Test Street",
        onlineUrl: null,
      },
    },
  ],
  venueName: "Studio",
  address: "1 Test Street",
  city: null,
  locationGeo: null,
  onlineUrl: "https://example.com/live",
  hideAddressUntilTicket: true,
  coverHue: 180,
  coverMediaUrl: "https://cdn.example.com/event-cover.gif",
  coverMediaType: "gif",
  coverMediaProvider: "giphy",
  coverMediaSourceUrl: "https://giphy.com/gifs/event-cover",
  coverMediaCredit: "GIPHY",
  coverMediaCreditUrl: "https://giphy.com",
  coverMediaAlt: "Dancing cover GIF",
  tickets: [ticket()],
  visibility: "unlisted",
  requireApproval: true,
  allowTransfers: false,
  hideRemainingCount: true,
  passwordProtected: false,
  privateGuestList: true,
  inPersonPaymentsEnabled: true,
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
  createdAt: "2026-05-08T08:00:00.000Z",
  updatedAt: "2026-05-08T08:10:00.000Z",
  ...patch,
});

const rowFromPayload = (
  source: DraftEvent,
  theme: Record<string, unknown>,
  currency: string | null = source.currency ?? null,
): ServerDraftEventRow => ({
  id: source.id,
  brand_id: source.brandId,
  created_by: "user-1",
  title: source.name.trim().length > 0 ? source.name : "Untitled draft",
  description: source.description,
  slug: "draft-abcd",
  location_text: "Studio · 1 Test Street",
  online_url: source.onlineUrl,
  cover_media_url: source.coverMediaUrl,
  cover_media_type: source.coverMediaType,
  cover_media_provider: source.coverMediaProvider ?? null,
  cover_media_source_url: source.coverMediaSourceUrl ?? null,
  cover_media_credit: source.coverMediaCredit ?? null,
  cover_media_credit_url: source.coverMediaCreditUrl ?? null,
  cover_media_alt: source.coverMediaAlt ?? null,
  currency,
  is_online: source.format === "online",
  is_recurring: source.whenMode === "recurring",
  is_multi_date: source.whenMode === "multi_date",
  recurrence_rules: source.recurrenceRule,
  theme,
  visibility: "draft",
  status: "draft",
  timezone: source.timezone,
  created_at: source.createdAt,
  updated_at: source.updatedAt,
  published_at: null,
  deleted_at: null,
});

describe("serverDraftEventMapper", () => {
  test("round-trips draft fields through events.theme.business_draft", () => {
    const source = draft();
    const payload = draftToServerInsert(source, "user-1", "draft-abcd");
    const hydrated = serverRowToDraft(rowFromPayload(source, payload.theme));

    expect(payload.status).toBe("draft");
    expect(payload.visibility).toBe("draft");
    expect(payload.title).toBe("Friday Supper");
    expect(hydrated.serverSlug).toBe("draft-abcd");
    expect(hydrated.whenMode).toBe("multi_date");
    expect(hydrated.multiDates?.[1]?.overrides.description).toBe("Second night");
    expect(hydrated.lastStepReached).toBe(5);
    expect(hydrated.visibility).toBe("unlisted");
    expect(hydrated.privateGuestList).toBe(true);
    expect(payload.cover_media_url).toBe(source.coverMediaUrl);
    expect(payload.cover_media_type).toBe("gif");
    expect(payload.cover_media_provider).toBe("giphy");
    expect(payload.cover_media_source_url).toBe("https://giphy.com/gifs/event-cover");
    expect(payload.cover_media_credit).toBe("GIPHY");
    expect(payload.cover_media_credit_url).toBe("https://giphy.com");
    expect(payload.cover_media_alt).toBe("Dancing cover GIF");
    expect(payload.currency).toBeNull();
    expect(hydrated.coverMediaUrl).toBe(source.coverMediaUrl);
    expect(hydrated.coverMediaType).toBe("gif");
    expect(hydrated.coverMediaProvider).toBe("giphy");
    expect(hydrated.coverMediaSourceUrl).toBe("https://giphy.com/gifs/event-cover");
    expect(hydrated.coverMediaCredit).toBe("GIPHY");
    expect(hydrated.coverMediaCreditUrl).toBe("https://giphy.com");
    expect(hydrated.coverMediaAlt).toBe("Dancing cover GIF");
    expect(hydrated.currency).toBeNull();
  });

  test("persists null-currency inserts and server draft JSON as null", () => {
    const source = draft({ currency: null });
    const payload = draftToServerInsert(source, "user-1", "draft-currency");
    const businessDraft = payload.theme.business_draft as {
      currency: string | null;
    };

    // #962 — a pre-bank brand has NO currency; the write path must persist
    // NULL, never manufacture GBP (migration 0769 "NULL means not set").
    expect(payload.currency).toBeNull();
    expect(businessDraft.currency).toBeNull();
  });

  test("persists null-currency updates as null while preserving uploaded cover media", () => {
    const source = draft({
      coverMediaType: "video",
      coverMediaUrl: "https://cdn.example.com/cover.mov",
      currency: null,
    });
    const payload = draftToServerUpdate(source, {});
    const businessDraft = payload.theme.business_draft as {
      currency: string | null;
    };

    // #962 — null persists as null on the update leg too.
    expect(payload.currency).toBeNull();
    expect(payload.cover_media_url).toBe("https://cdn.example.com/cover.mov");
    expect(payload.cover_media_type).toBe("video");
    expect(businessDraft.currency).toBeNull();
  });

  test("preserves explicit event currency through update and hydration", () => {
    const source = draft({ currency: "usd" });
    const payload = draftToServerUpdate(source, {});
    const hydrated = serverRowToDraft(rowFromPayload(source, payload.theme, "USD"));

    expect(payload.currency).toBe("USD");
    expect((payload.theme.business_draft as { currency: string }).currency).toBe(
      "USD",
    );
    expect(hydrated.currency).toBe("USD");
  });

  test("hydrates null cover media and keeps hue fallback", () => {
    const source = draft({ coverMediaUrl: null, coverMediaType: null });
    const payload = draftToServerUpdate(source, {});
    const hydrated = serverRowToDraft(rowFromPayload(source, payload.theme));

    expect(payload.cover_media_url).toBeNull();
    expect(payload.cover_media_type).toBeNull();
    expect(payload.cover_media_provider).toBeNull();
    expect(payload.cover_media_source_url).toBeNull();
    expect(payload.cover_media_credit).toBeNull();
    expect(payload.cover_media_credit_url).toBeNull();
    expect(payload.cover_media_alt).toBeNull();
    expect(hydrated.coverHue).toBe(180);
    expect(hydrated.coverMediaUrl).toBeNull();
    expect(hydrated.coverMediaType).toBeNull();
    expect(hydrated.coverMediaProvider).toBeNull();
  });

  test("uses a non-empty fallback title for blank drafts", () => {
    const payload = draftToServerInsert(
      draft({ name: "", description: "" }),
      "user-1",
      "draft-wxyz",
    );

    expect(payload.title).toBe("Untitled draft");
    expect(payload.slug).toBe("draft-wxyz");
    expect(payload.description).toBeNull();
  });

  test("preserves unknown theme keys while updating business draft", () => {
    const source = draft({ coverHue: 220 });
    const payload = draftToServerUpdate(source, {
      existingFlag: true,
      business_draft: { legacyLocalDraftId: "d_old" },
    });

    expect(payload.theme.existingFlag).toBe(true);
    expect(
      (payload.theme.business_draft as { legacyLocalDraftId: string })
        .legacyLocalDraftId,
    ).toBe("d_old");
    expect(payload.theme.coverHue).toBe(220);
  });

  test("never stores plaintext ticket passwords in server draft JSON", () => {
    const source = draft({
      tickets: [
        ticket({
          passwordProtected: true,
          password: "secret-pass",
        }),
      ],
    });
    const payload = draftToServerInsert(source, "user-1", "draft-pass");
    const payloadText = JSON.stringify(payload.theme);
    const hydrated = serverRowToDraft(rowFromPayload(source, payload.theme));

    expect(payloadText).not.toContain("secret-pass");
    expect(hydrated.tickets[0].password).toBeNull();
    expect(hydrated.tickets[0].passwordConfigured).toBe(true);
  });

  test("accepts recovered configured password tickets during publish validation", () => {
    // The base fixture defaults to whenMode "multi_date" with fixed 2026-06
    // dates + empty partyTypes; both now trip validatePublish (ORCH-0824 made
    // partyTypes required; the fixed dates are in the past). This test is about
    // the password-ticket branch, so make the draft otherwise-valid: a
    // non-empty party type and a dynamically-future single date.
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const source = draft({
      partyTypes: ["birthday-party"],
      whenMode: "single",
      date: future,
      multiDates: null,
      city: "London",
      locationGeo: { lat: 51.5, lng: -0.12 },
      tickets: [
        ticket({
          passwordProtected: true,
          password: null,
          passwordConfigured: true,
        }),
      ],
    });

    expect(validatePublish(source, "active")).toEqual([]);
  });

  test("maps UI visibility and avoids DB-only lifecycle drift", () => {
    expect(publishedVisibilityForDraft("public")).toBe("public");
    expect(publishedVisibilityForDraft("unlisted")).toBe("hidden");
    expect(publishedVisibilityForDraft("private")).toBe("private");
  });

  // ---------------------------------------------------------------------------
  // #1026 [chip-in-draft-persist] — RSVP "chip in" host-controls must survive a
  // draft round-trip. They are WRITTEN into theme.business_draft
  // (buildBusinessDraftPayload `:378-380`) and MUST be READ BACK in
  // serverRowToDraft. Before the fix, serverRowToDraft omitted the three reads
  // and the `serverDraftEventMapper.ts:870` `as DraftEvent` cast hid the
  // omission from the compiler — so the autosave echo overwrote chip-in with
  // undefined ~700ms after the host set it, and a wiped draft published OFF
  // (lost host revenue). Guards I-PROPOSED-1026-DRAFT-CHIPIN-ROUNDTRIP and
  // I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE. Append-only.
  // ---------------------------------------------------------------------------

  // T-1 (happy, fails-on-revert): chip-in-ON survives save → reload/autosave-echo
  // through the REAL builders (draftToServerUpdate → serverRowToDraft).
  test("#1026 — chip-in survives a real save→reload/autosave round-trip", () => {
    const source = draft({
      isRsvp: true,
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 2500,
      rsvpContributionMinCents: 500,
    });
    const payload = draftToServerUpdate(source, {});

    // Write leg: the trio must land in theme.business_draft.
    const businessDraft = payload.theme.business_draft as {
      rsvpContributionEnabled: unknown;
      rsvpContributionSuggestedCents: unknown;
      rsvpContributionMinCents: unknown;
    };
    expect(businessDraft.rsvpContributionEnabled).toBe(true);
    expect(businessDraft.rsvpContributionSuggestedCents).toBe(2500);
    expect(businessDraft.rsvpContributionMinCents).toBe(500);

    // Read leg (the fix): serverRowToDraft must read the trio back off the blob.
    const hydrated = serverRowToDraft(rowFromPayload(source, payload.theme));
    expect(hydrated.rsvpContributionEnabled).toBe(true);
    expect(hydrated.rsvpContributionSuggestedCents).toBe(2500);
    expect(hydrated.rsvpContributionMinCents).toBe(500);
  });

  // T-2 (edge/legacy): a pre-ORCH-1291 blob without the three chip-in keys must
  // hydrate to false/null/null — NEVER undefined (undefined would be dropped by
  // JSON.stringify on the next autosave and re-wipe the DB).
  test("#1026 — legacy blob without chip-in keys hydrates to false/null (not undefined)", () => {
    const source = draft({ isRsvp: true });
    const payload = draftToServerUpdate(source, {});
    const businessDraft = payload.theme.business_draft as Record<string, unknown>;
    delete businessDraft.rsvpContributionEnabled;
    delete businessDraft.rsvpContributionSuggestedCents;
    delete businessDraft.rsvpContributionMinCents;

    const hydrated = serverRowToDraft(rowFromPayload(source, payload.theme));

    expect(hydrated.rsvpContributionEnabled).toBe(false);
    expect(hydrated.rsvpContributionSuggestedCents).toBeNull();
    expect(hydrated.rsvpContributionMinCents).toBeNull();
    // Must be real values, present as own-properties — never undefined.
    expect(hydrated.rsvpContributionEnabled).not.toBeUndefined();
    expect(hydrated.rsvpContributionSuggestedCents).not.toBeUndefined();
    expect(hydrated.rsvpContributionMinCents).not.toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(hydrated, "rsvpContributionEnabled"),
    ).toBe(true);
  });

  // T-3 (insert/lazy-promote path): chip-in survives the draftToServerInsert leg
  // (a fresh d_* draft promoted to a server row), not just the update leg.
  test("#1026 — chip-in survives the lazy-promote/insert path", () => {
    const source = draft({
      isRsvp: true,
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 3000,
      rsvpContributionMinCents: 1000,
    });
    const payload = draftToServerInsert(source, "user-1", "draft-chipin");
    const hydrated = serverRowToDraft(rowFromPayload(source, payload.theme));

    expect(hydrated.rsvpContributionEnabled).toBe(true);
    expect(hydrated.rsvpContributionSuggestedCents).toBe(3000);
    expect(hydrated.rsvpContributionMinCents).toBe(1000);
  });

  // T-4 (type / compile-completeness gate for
  // I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE): serverRowToDraft closes with
  // `} satisfies DraftEvent;` (was `as DraftEvent`). `satisfies` makes any
  // omitted required DraftEvent field — including the chip-in trio — a hard
  // `tsc` error (SC-4: `npm run typecheck` reddens if Edit A is reverted under
  // `satisfies`). The type gate lives in `npm run typecheck`; this test adds a
  // runtime completeness assertion so the whole trio must materialize as real
  // values (undefined would slip through the OLD `as` cast but fails here too).
  test("#1026 — serverRowToDraft returns a materially-complete chip-in trio", () => {
    const source = draft({
      isRsvp: true,
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 2500,
      rsvpContributionMinCents: 500,
    });
    const hydrated = serverRowToDraft(
      rowFromPayload(source, draftToServerInsert(source, "user-1", "draft-t4").theme),
    );

    // Type-level: the mapper is annotated `: DraftEvent` and closed with
    // `satisfies DraftEvent`; this assignment documents the completeness contract.
    const complete: DraftEvent = hydrated;

    const chipInKeys: (keyof DraftEvent)[] = [
      "rsvpContributionEnabled",
      "rsvpContributionSuggestedCents",
      "rsvpContributionMinCents",
    ];
    for (const key of chipInKeys) {
      expect(complete[key]).not.toBeUndefined();
    }
    expect(complete.rsvpContributionEnabled).toBe(true);
    expect(complete.rsvpContributionSuggestedCents).toBe(2500);
    expect(complete.rsvpContributionMinCents).toBe(500);
  });

  // ---------------------------------------------------------------------------
  // #962 [pre-bank-currency-degbp] R1 — write-path round-trip persists NULL, not
  // a fabricated "GBP". A pre-bank brand genuinely has default_currency = NULL
  // (migration 0769 "NULL means not set; do not imply GBP"). The mapper is the
  // ONLY thing that used to override eventDrafts.resolveDraftCurrencyForSave's
  // correct null, stamping normalizeCurrency() → "GBP" onto both the top-level
  // events.currency column AND theme.business_draft.currency — making the GBP
  // sticky in the DB. This guards the fix at serverDraftEventMapper.ts:344/633/
  // 673 (currencyCodeOrNull, not normalizeCurrency). Append-only.
  //
  // FAILS-ON-REVERT (true line-deletion, proven in the implementation report):
  //   revert any of :344/:633/:673 to normalizeCurrency(draft.currency) →
  //   the null assertions below become "GBP" and FAIL.
  // ---------------------------------------------------------------------------
  test("#962 R1 — a null-currency draft persists NULL on insert (column + theme.business_draft)", () => {
    const source = draft({ currency: null });
    const payload = draftToServerInsert(source, "user-1", "draft-962-insert");
    const businessDraft = payload.theme.business_draft as {
      currency: string | null;
    };

    // Top-level events.currency column → NULL.
    expect(payload.currency).toBeNull();
    // theme.business_draft.currency (the buildBusinessDraftPayload leg) → null.
    expect(businessDraft.currency).toBeNull();
    // Never the fabricated fallback.
    expect(payload.currency).not.toBe("GBP");
    expect(businessDraft.currency).not.toBe("GBP");
  });

  test("#962 R1 — a null-currency draft persists NULL on update (column + theme.business_draft)", () => {
    const source = draft({ currency: null });
    const payload = draftToServerUpdate(source, {});
    const businessDraft = payload.theme.business_draft as {
      currency: string | null;
    };

    expect(payload.currency).toBeNull();
    expect(businessDraft.currency).toBeNull();
    expect(payload.currency).not.toBe("GBP");
    expect(businessDraft.currency).not.toBe("GBP");
  });

  test("#962 R1 — a REAL currency still round-trips unchanged through both write legs", () => {
    // The other half of the contract: honoring a set currency is NOT weakened.
    const source = draft({ currency: "usd" });
    const insert = draftToServerInsert(source, "user-1", "draft-962-set");
    const update = draftToServerUpdate(source, {});

    expect(insert.currency).toBe("USD");
    expect((insert.theme.business_draft as { currency: string | null }).currency).toBe(
      "USD",
    );
    expect(update.currency).toBe("USD");
    expect((update.theme.business_draft as { currency: string | null }).currency).toBe(
      "USD",
    );
  });
});

// ---------------------------------------------------------------------------
// #3287 [multi-day pricing snap-back] — the organiser's "One price for all days"
// choice (DraftEvent.multiDatePricingMode) must survive the draft save
// round-trip. Before the fix, buildBusinessDraftPayload never WROTE it into
// theme.business_draft and serverRowToDraft never READ it back, so the ~700ms
// autosave echo wholesale-replaced the local draft with a copy that lacked it
// and the control snapped back to "Per day". The field is OPTIONAL on
// DraftEvent, so `satisfies DraftEvent` (the #1026 guard) could not see the
// omission — the key-parity record below closes that hole for optional keys.
// Guards I-PROPOSED-3287-DRAFT-PRICING-MODE-ROUNDTRIP and
// I-PROPOSED-3287-DRAFT-MAPPER-KEY-PARITY. Append-only.
//
// FAILS-ON-REVERT (proven in the #3287 implementation record):
//   remove the write leg (buildBusinessDraftPayload) → T-1..T-5 FAIL (+ store T-7)
//   remove the read leg  (serverRowToDraft)          → T-1..T-6 FAIL (+ store T-7)
//   add a DraftEvent key without classifying it      → TS1360, file fails to compile
//   leave a key DraftEvent no longer has             → TS2353, file fails to compile
// ---------------------------------------------------------------------------

type DraftKeyClass = "roundtrip" | "server-derived" | "excluded";

// EVERY top-level DraftEvent key, optional ones included, classified exactly
// once. `satisfies Record<keyof DraftEvent, …>` makes an unclassified new key a
// type error (missing property) and a key removed from DraftEvent a type error
// (excess property). ts-jest type-checks this file inside the required
// `mingla-business jest (full suite)` gate, so either one turns CI red.
const DRAFT_EVENT_KEY_CLASS = {
  // Server-derived: produced by the row / RPC, not by the organiser's input.
  id: "server-derived",
  serverSlug: "server-derived",
  endsAtUtc: "server-derived",
  status: "server-derived",
  createdAt: "server-derived",
  updatedAt: "server-derived",
  // Excluded: event wizard never sets it; round-trip gap recorded as #3287 D-2.
  coordinatePrecision: "excluded",
  // Round-trip: must come back from the server copy equal to what was saved.
  brandId: "roundtrip",
  name: "roundtrip",
  description: "roundtrip",
  format: "roundtrip",
  partyTypes: "roundtrip",
  vibeTags: "roundtrip",
  musicGenres: "roundtrip",
  whenMode: "roundtrip",
  date: "roundtrip",
  doorsOpen: "roundtrip",
  endsAt: "roundtrip",
  timezone: "roundtrip",
  recurrenceRule: "roundtrip",
  multiDates: "roundtrip",
  multiDatePricingMode: "roundtrip",
  venueName: "roundtrip",
  address: "roundtrip",
  city: "roundtrip",
  locationGeo: "roundtrip",
  onlineUrl: "roundtrip",
  hideAddressUntilTicket: "roundtrip",
  coverHue: "roundtrip",
  coverMediaUrl: "roundtrip",
  coverMediaPosterUrl: "roundtrip",
  coverMediaType: "roundtrip",
  coverMediaProvider: "roundtrip",
  coverMediaSourceUrl: "roundtrip",
  coverMediaCredit: "roundtrip",
  coverMediaCreditUrl: "roundtrip",
  coverMediaAlt: "roundtrip",
  coverGallery: "roundtrip",
  currency: "roundtrip",
  tickets: "roundtrip",
  pricingSwitches: "roundtrip",
  visibility: "roundtrip",
  requireApproval: "roundtrip",
  allowTransfers: "roundtrip",
  hideRemainingCount: "roundtrip",
  passwordProtected: "roundtrip",
  themeOverrides: "roundtrip",
  privateGuestList: "roundtrip",
  isRsvp: "roundtrip",
  rsvpCapacity: "roundtrip",
  rsvpAllowPlusOnes: "roundtrip",
  rsvpPlusOnesMax: "roundtrip",
  rsvpWaitlistEnabled: "roundtrip",
  rsvpApprovalMode: "roundtrip",
  rsvpDiscoverable: "roundtrip",
  rsvpContributionEnabled: "roundtrip",
  rsvpContributionSuggestedCents: "roundtrip",
  rsvpContributionMinCents: "roundtrip",
  inPersonPaymentsEnabled: "roundtrip",
  lastStepReached: "roundtrip",
  clientRevision: "roundtrip",
} satisfies Record<keyof DraftEvent, DraftKeyClass>;

// The server row exactly as the live business_update_event_draft stores it: every
// column of the real update payload, plus the theme blob after a JSON wire hop
// (JSON.stringify drops undefined — the very thing the write leg must not rely on).
// rowFromPayload() above carries only the blob-backed fields, so the key-parity
// round-trip needs this faithful row to avoid false failures on column-backed keys.
const rowFromServerUpdate = (
  source: DraftEvent,
  payload: ServerDraftEventUpdate,
): ServerDraftEventRow => ({
  ...payload,
  theme: JSON.parse(JSON.stringify(payload.theme)) as Record<string, unknown>,
  id: source.id,
  brand_id: source.brandId,
  created_by: "user-1",
  slug: "draft-3287",
  created_at: source.createdAt,
  updated_at: source.updatedAt,
  published_at: null,
  deleted_at: null,
});

const blobPricingMode = (theme: Record<string, unknown>): unknown =>
  (theme.business_draft as Record<string, unknown>).multiDatePricingMode;

describe("#3287 — multi-day pricing choice survives the draft save round-trip", () => {
  // T-1 (happy, fails-on-revert of EITHER leg): all_days survives save → echo.
  test("T-1 all_days is written into business_draft and read back from the server copy", () => {
    const source = draft({ multiDatePricingMode: "all_days" });
    const payload = draftToServerUpdate(source, {});

    // Write leg: the choice lands in the blob the RPC stores verbatim.
    expect(blobPricingMode(payload.theme)).toBe("all_days");

    // Read leg: the server copy that replaces the local draft still carries it.
    const hydrated = serverRowToDraft(rowFromServerUpdate(source, payload));
    expect(hydrated.multiDatePricingMode).toBe("all_days");
  });

  // T-2 (both directions): switching back to per_day also survives.
  test("T-2 per_day round-trips as a concrete value in both directions", () => {
    const source = draft({ multiDatePricingMode: "per_day" });
    const payload = draftToServerUpdate(source, {});

    expect(blobPricingMode(payload.theme)).toBe("per_day");
    const hydrated = serverRowToDraft(rowFromServerUpdate(source, payload));
    expect(hydrated.multiDatePricingMode).toBe("per_day");
  });

  // T-3 (legacy / edge): pre-#3287 blobs never carried the key, and pre-#2160
  // local drafts carry undefined. Neither may surface undefined.
  test("T-3 a legacy blob without the key reads per_day, and an absent local value writes per_day", () => {
    const source = draft({ multiDatePricingMode: "all_days" });
    const payload = draftToServerUpdate(source, {});
    delete (payload.theme.business_draft as Record<string, unknown>)
      .multiDatePricingMode;

    const hydrated = serverRowToDraft(rowFromServerUpdate(source, payload));
    expect(hydrated.multiDatePricingMode).toBe("per_day");
    expect(hydrated.multiDatePricingMode).not.toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(hydrated, "multiDatePricingMode"),
    ).toBe(true);

    // A pre-#2160 persisted local draft has no value at all: the write leg still
    // emits a concrete per_day that survives JSON serialization.
    const legacyLocal = draft();
    delete legacyLocal.multiDatePricingMode;
    const legacyPayload = draftToServerUpdate(legacyLocal, {});
    const wire = JSON.parse(JSON.stringify(legacyPayload.theme)) as Record<
      string,
      unknown
    >;
    expect(blobPricingMode(wire)).toBe("per_day");
  });

  // T-4 (insert / lazy-promote path): the first save of a local-only d_* draft.
  test("T-4 all_days survives the draftToServerInsert (promote) leg", () => {
    const source = draft({ multiDatePricingMode: "all_days" });
    const insert = draftToServerInsert(source, "user-1", "draft-x");

    expect(blobPricingMode(insert.theme)).toBe("all_days");
    const hydrated = serverRowToDraft(rowFromPayload(source, insert.theme));
    expect(hydrated.multiDatePricingMode).toBe("all_days");
  });

  // T-5 (structural): every "roundtrip" key survives a faithful save → echo.
  test("T-5 every round-trip DraftEvent key survives the server copy (key parity)", () => {
    const source: DraftEvent = draft({
      // Deliberately non-default values, so a dropped read that falls back to a
      // default cannot pass by coincidence.
      name: "Wythe Weekender Parity",
      description: "Every field set on purpose.",
      format: "hybrid",
      partyTypes: ["club-night"],
      vibeTags: ["energetic"],
      musicGenres: ["house"],
      whenMode: "multi_date",
      date: "2026-10-02",
      doorsOpen: "21:00",
      endsAt: "03:00",
      endsAtUtc: "2026-10-03T07:00:00.000Z",
      timezone: "America/New_York",
      recurrenceRule: {
        preset: "weekly",
        byDay: "FR",
        termination: { kind: "count", count: 4 },
      },
      multiDatePricingMode: "all_days",
      venueName: "Lantern Room",
      address: "1 Wythe Avenue",
      city: "Brooklyn",
      locationGeo: { lat: 40.72, lng: -73.96 },
      coordinatePrecision: "approximate",
      onlineUrl: "https://example.com/stream",
      hideAddressUntilTicket: false,
      coverHue: 300,
      coverMediaUrl: "https://cdn.example.com/cover.gif",
      coverMediaPosterUrl: "https://cdn.example.com/cover-poster.jpg",
      coverMediaType: "gif",
      coverMediaProvider: "giphy",
      coverMediaSourceUrl: "https://giphy.com/gifs/cover",
      coverMediaCredit: "GIPHY",
      coverMediaCreditUrl: "https://giphy.com",
      coverMediaAlt: "Weekend cover",
      coverGallery: [{ url: "https://cdn.example.com/gallery-1.jpg", type: "image" }],
      currency: "USD",
      tickets: [
        ticket({
          id: "ticket-weekend",
          name: "Weekend pass",
          priceGbp: 40,
          currency: "USD",
          capacity: 120,
          visibility: "hidden",
          displayOrder: 0,
          approvalRequired: true,
          passwordConfigured: false,
          waitlistEnabled: true,
          minPurchaseQty: 2,
          maxPurchaseQty: 6,
          allowTransfers: false,
          description: "Valid every day",
          saleStartAt: "2026-09-20T12:00:00.000Z",
          saleEndAt: "2026-10-01T12:00:00.000Z",
          availableAt: "online",
        }),
      ],
      pricingSwitches: { passTax: true, passMinglaFee: false, passServiceFee: true },
      visibility: "private",
      requireApproval: true,
      allowTransfers: false,
      hideRemainingCount: true,
      passwordProtected: true,
      themeOverrides: { color: "#2563eb", font: "poppins", animation: "confetti" },
      privateGuestList: true,
      isRsvp: true,
      rsvpCapacity: 80,
      rsvpAllowPlusOnes: true,
      rsvpPlusOnesMax: 2,
      rsvpWaitlistEnabled: true,
      rsvpApprovalMode: "manual",
      rsvpDiscoverable: true,
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 2500,
      rsvpContributionMinCents: 500,
      inPersonPaymentsEnabled: true,
      lastStepReached: 4,
      clientRevision: 95,
    });

    const classified = Object.keys(DRAFT_EVENT_KEY_CLASS).sort();
    const roundtripKeys = (
      Object.keys(DRAFT_EVENT_KEY_CLASS) as (keyof DraftEvent)[]
    ).filter((key) => DRAFT_EVENT_KEY_CLASS[key] === "roundtrip");

    // Denominator guard: the fixture sets EVERY classified key (a zero-key
    // comparison would pass vacuously), and there is a real set to compare.
    expect(Object.keys(source).sort()).toEqual(classified);
    for (const key of roundtripKeys) {
      expect({ key, value: source[key] }).not.toEqual({ key, value: undefined });
    }
    expect(roundtripKeys.length).toBeGreaterThanOrEqual(50);

    const payload = draftToServerUpdate(source, {});
    const hydrated = serverRowToDraft(rowFromServerUpdate(source, payload));

    for (const key of roundtripKeys) {
      // Wrapped with the key name so a failure says WHICH field was dropped.
      expect({
        key,
        ownProperty: Object.prototype.hasOwnProperty.call(hydrated, key),
        value: hydrated[key],
      }).toEqual({ key, ownProperty: true, value: source[key] });
    }
  });

  // T-6 (garbage): a corrupt blob value can never produce a third state.
  test("T-6 corrupt blob values hydrate to per_day", () => {
    const source = draft({ multiDatePricingMode: "all_days" });
    for (const corrupt of ["weekly", "ALL_DAYS", 42, null, {}, true]) {
      const payload = draftToServerUpdate(source, {});
      (payload.theme.business_draft as Record<string, unknown>).multiDatePricingMode =
        corrupt;
      const hydrated = serverRowToDraft(rowFromServerUpdate(source, payload));
      expect({ corrupt, mode: hydrated.multiDatePricingMode }).toEqual({
        corrupt,
        mode: "per_day",
      });
    }
  });
});
