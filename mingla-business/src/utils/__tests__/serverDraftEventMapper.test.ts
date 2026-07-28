import { describe, expect, test } from "@jest/globals";

import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { validatePublish } from "../draftEventValidation";
import {
  draftToServerInsert,
  draftToServerUpdate,
  publishedVisibilityForDraft,
  serverRowToDraft,
  type ServerDraftEventRow,
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
