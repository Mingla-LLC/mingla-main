import { buildDraftEvent, type TicketStub } from "../../store/draftEventStore";
import {
  buildTurnoutInput,
  stableStringify,
  turnoutInputHash,
  turnoutInputKey,
} from "../turnoutInput";

const day = (offset: number): string => {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "tier-1",
  name: "General",
  priceGbp: 25,
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
  ...overrides,
});

const eligibleDraft = () => ({
  ...buildDraftEvent("brand-1", "draft-1", "2026-08-13T00:00:00.000Z"),
  name: "Collector Preview",
  partyTypes: ["networking-event"],
  city: "Lagos",
  venueName: "Art Roost Gallery",
  date: day(20),
  doorsOpen: "18:00",
  currency: "NGN",
  tickets: [ticket()],
});

describe("#1008 canonical turnout input", () => {
  it("binds RSVP to free pricing and requires a finite capacity", () => {
    const draft = { ...eligibleDraft(), isRsvp: true, rsvpCapacity: 40 };
    const result = buildTurnoutInput({
      kind: "rsvp",
      draft,
      brandDefaultCurrency: "GBP",
    });
    expect(result).toMatchObject({
      ok: true,
      input: { ticket_price: 0, capacity: 40 },
    });

    const unlimited = buildTurnoutInput({
      kind: "rsvp",
      draft: { ...draft, rsvpCapacity: null },
      brandDefaultCurrency: "GBP",
    });
    expect(unlimited).toEqual({ ok: false, reason: "unlimited_capacity" });
  });

  it("uses all tiers for capacity but only enabled paid tiers for minimum price", () => {
    const draft = {
      ...eligibleDraft(),
      tickets: [
        ticket({
          id: "hidden",
          capacity: 40,
          priceGbp: 25,
          visibility: "public",
        }),
        ticket({
          id: "disabled",
          capacity: 10,
          priceGbp: 2,
          visibility: "disabled",
        }),
      ],
    };
    const result = buildTurnoutInput({
      kind: "event",
      draft,
      brandDefaultCurrency: "GBP",
    });
    expect(result).toMatchObject({
      ok: true,
      input: { ticket_price: 25, capacity: 50 },
    });
  });

  it("creates a stable full cache key and a deterministic 64-bit hash", () => {
    const result = buildTurnoutInput({
      kind: "event",
      draft: { ...eligibleDraft(), doorsOpen: "not-a-time" },
      brandDefaultCurrency: "GBP",
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.input).not.toHaveProperty("start_time");
    expect(turnoutInputKey(result.input)).toBe(
      stableStringify({ tool: "events", input: { ...result.input } }),
    );
    expect(turnoutInputHash(result.input)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("chooses the earliest future multi-date and blocks past-only drafts", () => {
    const base = eligibleDraft();
    const entry = (id: string, date: string) => ({
      id,
      date,
      startTime: "18:00",
      endTime: "21:00",
      overrides: {
        title: null,
        description: null,
        venueName: null,
        address: null,
        onlineUrl: null,
      },
    });
    const result = buildTurnoutInput({
      kind: "event",
      draft: {
        ...base,
        whenMode: "multi_date",
        multiDates: [entry("later", day(30)), entry("next", day(10))],
      },
      brandDefaultCurrency: "GBP",
    });
    expect(result).toMatchObject({ ok: true, input: { date: day(10) } });

    const past = buildTurnoutInput({
      kind: "event",
      draft: {
        ...base,
        whenMode: "multi_date",
        multiDates: [entry("past", day(-3))],
      },
      brandDefaultCurrency: "GBP",
    });
    expect(past).toEqual({ ok: false, reason: "missing_date" });
  });

  it("chooses the first upcoming recurring occurrence", () => {
    const result = buildTurnoutInput({
      kind: "event",
      draft: {
        ...eligibleDraft(),
        whenMode: "recurring",
        date: day(-1),
        recurrenceRule: {
          preset: "daily",
          termination: { kind: "count", count: 5 },
        },
      },
      brandDefaultCurrency: "GBP",
    });
    expect(result).toMatchObject({ ok: true, input: { date: day(0) } });
  });
});
