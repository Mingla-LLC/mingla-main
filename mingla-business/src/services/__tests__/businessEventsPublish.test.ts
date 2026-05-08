import { readFileSync } from "fs";
import path from "path";

import { describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { publishBusinessEventDraft } from "../businessEvents";
import type { DraftEvent } from "../../store/draftEventStore";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const baseDraft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "00000000-0000-4000-8000-000000000001",
  brandId: "00000000-0000-4000-8000-000000000002",
  serverSlug: "draft-nlhj",
  name: "Visa",
  description: "Free launch event.",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: "2026-06-01",
  doorsOpen: "18:00",
  endsAt: "22:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Main Hall",
  address: "1 High Street",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  tickets: [
    {
      id: "ticket-local",
      name: "The free",
      priceGbp: null,
      capacity: null,
      isFree: true,
      isUnlimited: true,
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
      availableAt: "online",
    },
  ],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  lastStepReached: 6,
  status: "draft",
  clientRevision: 7,
  createdAt: "2026-05-08T18:00:00.000Z",
  updatedAt: "2026-05-08T18:00:00.000Z",
  ...patch,
});

const rpcSuccess = (slug: string) => ({
  event: {
    id: "00000000-0000-4000-8000-000000000001",
    brand_id: "00000000-0000-4000-8000-000000000002",
    created_by: "00000000-0000-4000-8000-000000000003",
    title: "Visa",
    description: "Free launch event.",
    slug,
    location_text: "Main Hall · 1 High Street",
    online_url: null,
    is_online: false,
    is_recurring: false,
    is_multi_date: false,
    recurrence_rules: null,
    cover_media_url: null,
    cover_media_type: null,
    visibility: "public",
    status: "scheduled",
    published_at: "2026-05-08T18:30:00.000Z",
    timezone: "Europe/London",
    created_at: "2026-05-08T18:00:00.000Z",
    updated_at: "2026-05-08T18:30:00.000Z",
    theme: {
      coverHue: 25,
      business_event: {
        format: "in_person",
        requestedVisibility: "public",
        coverHue: 25,
        whenMode: "single",
        when: {
          date: "2026-06-01",
          doorsOpen: "18:00",
          endsAt: "22:00",
          timezone: "Europe/London",
        },
        location: {
          venueName: "Main Hall",
          address: "1 High Street",
        },
        settings: {},
      },
    },
  },
  brand: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "leggothis",
    name: "Leggo This",
  },
  tickets: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      event_id: "00000000-0000-4000-8000-000000000001",
      name: "The free",
      description: null,
      price_cents: 0,
      currency: "GBP",
      quantity_total: null,
      is_unlimited: true,
      is_free: true,
      sale_start_at: null,
      sale_end_at: null,
      min_purchase_qty: 1,
      max_purchase_qty: null,
      is_hidden: false,
      is_disabled: false,
      requires_approval: false,
      allow_transfers: true,
      password_protected: false,
      available_online: true,
      available_in_person: false,
      waitlist_enabled: false,
      display_order: 0,
    },
  ],
  client_revision: null,
});

describe("business event publish RPC adapter", () => {
  test("uses the atomic publish RPC and trusts the returned final slug", async () => {
    rpcMock.mockResolvedValueOnce({ data: rpcSuccess("visa"), error: null });

    const published = await publishBusinessEventDraft(baseDraft());

    expect(rpcMock).toHaveBeenCalledWith("business_publish_event_draft", {
      p_event_id: "00000000-0000-4000-8000-000000000001",
      p_draft_payload: expect.objectContaining({
        title: "Visa",
        visibility: "public",
      }),
      p_client_revision: 7,
    });
    expect(published.event.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(published.event.eventSlug).toBe("visa");
    expect(published.event.eventSlug).not.toMatch(/^draft-/);
    expect(published.event.status).toBe("scheduled");
    expect(published.tickets[0]).toMatchObject({
      name: "The free",
      priceGbp: null,
      isFree: true,
      availableAt: "online",
    });
  });

  test("rejects any RPC response that still returns a draft placeholder slug", async () => {
    rpcMock.mockResolvedValueOnce({
      data: rpcSuccess("draft-nlhj"),
      error: null,
    });

    await expect(publishBusinessEventDraft(baseDraft())).rejects.toThrow(
      "draft placeholder slug",
    );
  });

  test("migration allows only RPC-owned draft-to-published slug finalization", () => {
    const sql = repoFile(
      "../supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql",
    );

    expect(sql).toContain("business_publish_event_draft");
    expect(sql).toContain("current_setting('mingla.business_publish_event_draft', true) = 'on'");
    expect(sql).toContain("OLD.status = 'draft'");
    expect(sql).toContain("NEW.status IN ('scheduled', 'live')");
    expect(sql).toContain("NEW.published_at IS NOT NULL");
    expect(sql).toContain("IF v_base_slug = '' OR v_base_slug LIKE 'draft-%'");
  });
});
