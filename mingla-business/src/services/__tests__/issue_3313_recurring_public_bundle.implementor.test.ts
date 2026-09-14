/**
 * issue #3313 — a recurring event's public page and checkout copy.
 *
 * WHAT BROKE. `detailFromDirectBundle` hard-coded `recurrence_rules: null`, and
 * the bundle never carried the rule, so a published recurring event's page
 * read "Recurring (incomplete)" and offered no night to pick.
 *
 * WHAT THIS PINS.
 *   - The bundle's `recurrenceRule` reaches the event, and the eyebrow names it
 *     over the REAL dates ("Every Tuesday · 3 dates").
 *   - A recurring event the server reports as a day-choice event
 *     (`isMultiDate: true`, #3313) resolves to the multi-date shape the day
 *     chooser mounts on, with its rule still attached.
 *   - A pre-#3313 bundle (no `recurrenceRule` key) degrades to no rule, never a
 *     crash or a fabricated one.
 *   - The new server refusal `event_date_choice_required` gets its own honest
 *     sentence instead of "please try again".
 *
 * FAILS ON REVERT: restore `recurrence_rules: null` and the first test fails;
 * drop the copy entry and the last test fails.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { getPublicEventById } from "../publicEventsService";
import {
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  freeCheckoutErrorMessage,
} from "../checkoutErrorCopy";
import { resolvePublicEventDateDisplay } from "../../utils/eventDateDisplay";

const EVENT_ID = "f49394a3-6734-4a94-be40-d9b8810215a9";

const bundle = (patch: Record<string, unknown>): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: "brand-3313",
  brandSlug: "jazz",
  eventSlug: "tuesday-night-jazz",
  name: "Tuesday Night Jazz",
  description: "",
  status: "scheduled",
  timezone: "America/New_York",
  masterStartAt: "2026-10-13T23:00:00.000Z",
  masterEndAt: "2026-10-14T03:00:00.000Z",
  tickets: [],
  brand: {
    id: "brand-3313",
    slug: "jazz",
    name: "Jazz",
    address: null,
    coverMediaUrl: null,
  },
  occurrences: [
    { id: "n1", startAt: "2026-10-13T23:00:00.000Z", endAt: "2026-10-14T03:00:00.000Z", timezone: "America/New_York", isMaster: true },
    { id: "n2", startAt: "2026-10-20T23:00:00.000Z", endAt: "2026-10-21T03:00:00.000Z", timezone: "America/New_York", isMaster: false },
    { id: "n3", startAt: "2026-10-27T23:00:00.000Z", endAt: "2026-10-28T03:00:00.000Z", timezone: "America/New_York", isMaster: false },
  ],
  isRecurring: true,
  multiDatePricingMode: "per_day",
  ...patch,
});

const read = async (payload: Record<string, unknown>) => {
  mockRpc.mockImplementation((name: unknown) => {
    if (name !== "pg_direct_event_checkout_bundle") {
      throw new Error(`Unexpected RPC ${String(name)}`);
    }
    return Promise.resolve({ data: payload, error: null });
  });
  const detail = await getPublicEventById(EVENT_ID);
  expect(mockFrom).not.toHaveBeenCalled();
  if (detail === null) throw new Error("bundle did not resolve");
  return detail;
};

describe("issue #3313 — the recurring rule reaches the public page", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("a recurring event with nights to choose carries its rule and reads 'Every Tuesday · 3 dates'", async () => {
    const detail = await read(
      bundle({
        isMultiDate: true,
        recurrenceRule: {
          preset: "weekly",
          byDay: "TU",
          termination: { kind: "count", count: 8 },
        },
      }),
    );
    expect(detail.event.whenMode).toBe("multi_date");
    expect(detail.event.recurrenceRule).toEqual({
      preset: "weekly",
      byDay: "TU",
      termination: { kind: "count", count: 8 },
    });
    const display = resolvePublicEventDateDisplay(detail.event, detail.occurrences);
    expect(display.dateSubline).toBe("Every Tuesday · 3 dates");
  });

  test("a pre-#3313 bundle (no rule key, not a day-choice event) degrades to no rule and real dates", async () => {
    const detail = await read(bundle({ isMultiDate: false }));
    expect(detail.event.whenMode).toBe("recurring");
    expect(detail.event.recurrenceRule).toBeNull();
    const display = resolvePublicEventDateDisplay(detail.event, detail.occurrences);
    expect(display.dateSubline).not.toBe("Recurring (incomplete)");
  });

  test("a malformed rule is ignored, never trusted", async () => {
    const detail = await read(bundle({ isMultiDate: true, recurrenceRule: ["weekly"] }));
    expect(detail.event.recurrenceRule).toBeNull();
  });
});

describe("issue #3313 — a checkout with no date gets an honest sentence", () => {
  test("the create-session refusal (409 detail) names the fix", () => {
    const error = Object.assign(new Error("checkout_session_failed"), {
      status: 409,
      code: "checkout_session_failed",
      detail: "event_date_choice_required",
    });
    const message = freeCheckoutErrorMessage(error);
    expect(message).not.toBe(FREE_CHECKOUT_FAILED_MESSAGE);
    expect(FREE_CHECKOUT_MESSAGES).toContain(message);
    expect(message).toMatch(/Choose which date/);
  });

  test("the edge's own 422 refusal maps to the same sentence", () => {
    const error = Object.assign(new Error("event_date_choice_required"), {
      status: 422,
      code: "event_date_choice_required",
    });
    expect(freeCheckoutErrorMessage(error)).toMatch(/Choose which date/);
  });
});
