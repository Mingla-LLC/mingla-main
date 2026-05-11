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
  category: "food",
  whenMode: "multi_date",
  date: null,
  doorsOpen: "18:30",
  endsAt: "22:00",
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
  lastStepReached: 5,
  status: "draft",
  createdAt: "2026-05-08T08:00:00.000Z",
  updatedAt: "2026-05-08T08:10:00.000Z",
  ...patch,
});

const rowFromPayload = (
  source: DraftEvent,
  theme: Record<string, unknown>,
  currency: string | null = source.currency ?? "GBP",
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
    expect(payload.currency).toBe("GBP");
    expect(hydrated.coverMediaUrl).toBe(source.coverMediaUrl);
    expect(hydrated.coverMediaType).toBe("gif");
    expect(hydrated.coverMediaProvider).toBe("giphy");
    expect(hydrated.coverMediaSourceUrl).toBe("https://giphy.com/gifs/event-cover");
    expect(hydrated.coverMediaCredit).toBe("GIPHY");
    expect(hydrated.coverMediaCreditUrl).toBe("https://giphy.com");
    expect(hydrated.coverMediaAlt).toBe("Dancing cover GIF");
    expect(hydrated.currency).toBe("GBP");
  });

  test("normalizes null-currency inserts and server draft JSON to GBP", () => {
    const source = draft({ currency: null });
    const payload = draftToServerInsert(source, "user-1", "draft-currency");
    const businessDraft = payload.theme.business_draft as { currency: string };

    expect(payload.currency).toBe("GBP");
    expect(businessDraft.currency).toBe("GBP");
  });

  test("normalizes null-currency updates while preserving uploaded cover media", () => {
    const source = draft({
      coverMediaType: "video",
      coverMediaUrl: "https://cdn.example.com/cover.mov",
      currency: null,
    });
    const payload = draftToServerUpdate(source, {});
    const businessDraft = payload.theme.business_draft as { currency: string };

    expect(payload.currency).toBe("GBP");
    expect(payload.cover_media_url).toBe("https://cdn.example.com/cover.mov");
    expect(payload.cover_media_type).toBe("video");
    expect(businessDraft.currency).toBe("GBP");
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
    const source = draft({
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
});
