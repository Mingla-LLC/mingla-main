/**
 * issue #3827 [live event editor: one owner for location, buyer-aware reason]
 * — INDEPENDENT TESTER adversarial regression for the published-event diff.
 *
 * The implementor suite proves the repaired compare stops INVENTING changes
 * (the same value with its keys in another order). This file attacks the
 * opposite failure: a compare that became too forgiving and now HIDES a real
 * change, so the host edits something, Review changes shows nothing for it and
 * the server is never told.
 *
 *   GEO-*   the pin: key order, extra keys, -0, NaN, a number against the same
 *           digits as a string, a move far below anything a map could show,
 *           and every null/undefined pairing.
 *   HIDE-*  structured fields: an order-sensitive array nested inside an object
 *           whose keys were reordered; a number against a numeric string;
 *           null against a missing key against undefined; false, 0 and ""
 *           against null; two objects with the same NUMBER of keys but
 *           different keys; a key swapped for another holding the same value.
 *   SAME-*  what must stay "no change": key order at every depth at once, and
 *           undefined keys on either side.
 *   PATCH-* the patch the editor builds from the diff carries only what moved,
 *           so the save sends a pin (and with it a precision) only for a pin
 *           that moved, and an address only for an address that changed.
 *   REASON-* the reason guard at its boundaries when the reason is optional.
 *
 * FAILS-ON-REVERT: restore mingla-business/src/utils/liveEventAdapter.ts from
 * origin/main and GEO-1, SAME-1 and PATCH-1 go red (the pin and the reordered
 * structures read as changed); restore publishedEventEditGuards.ts and
 * REASON-1 goes red. The HIDE-* cases hold on both sides on purpose: they are
 * the guard that the new compare did not buy its tolerance by going blind.
 */

import { describe, expect, test } from "@jest/globals";

import {
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import {
  NO_BUYERS_EDIT_REASON,
  validateLiveEventFieldUpdate,
} from "../publishedEventEditGuards";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

type Geo = { lat: number; lng: number };

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "event-3827-t",
    serverEventId: "server-event-3827-t",
    brandId: "brand-1",
    brandSlug: "brand",
    eventSlug: "issue-3827-tester",
    status: "scheduled",
    publishedAt: "2026-06-01T12:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "event",
    name: "Issue 3827 night",
    description: "Doors at eight.",
    format: "in_person",
    category: null,
    whenMode: "single",
    date: "2026-07-01",
    doorsOpen: "20:00",
    endsAt: "23:00",
    timezone: "America/New_York",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Lantern Room",
    address: "61 Wythe Avenue, Brooklyn",
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaPosterUrl: null,
    coverMediaType: null,
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    currency: "USD",
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    orders: [],
    partyTypes: ["festival"],
    vibeTags: ["social"],
    musicGenres: [],
    city: "Brooklyn",
    locationGeo: { lat: 40.7222, lng: -73.9578 },
    pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpDiscoverable: false,
    rsvpContributionEnabled: false,
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
    createdAt: "2026-06-01T11:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...patch,
  }) as LiveEvent;

const ticket = (id: string, extra: Record<string, unknown> = {}): TicketStub =>
  ({
    id,
    name: "General",
    priceGbp: 12,
    isFree: false,
    capacity: 100,
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
    ...extra,
  }) as unknown as TicketStub;

/** The same value with every object's keys reversed, at every depth. */
const reverseKeys = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => reverseKeys(item)) as unknown as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item)]),
    ) as T;
  }
  return value;
};

const patchKeysWithGeo = (original: LiveEvent, geo: unknown): string[] =>
  Object.keys(
    editableDraftToPatch(original, {
      ...liveEventToEditableDraft(original),
      locationGeo: geo as Geo | null,
    }),
  );

describe("issue #3827 tester — the pin compare is exact about numbers and blind to shape", () => {
  test("GEO-1: key order, an extra key and a fresh object are not a move", () => {
    const original = liveEvent();
    expect(patchKeysWithGeo(original, { lng: -73.9578, lat: 40.7222 })).toEqual([]);
    // A picker that hands back more than the two numbers has not moved the pin.
    expect(
      patchKeysWithGeo(original, {
        lng: -73.9578,
        placeId: "abc",
        lat: 40.7222,
        precision: "exact",
      }),
    ).toEqual([]);
    // Loaded with the keys the other way round, edited the usual way.
    const loadedReversed = liveEvent({
      locationGeo: { lng: -73.9578, lat: 40.7222 } as Geo,
    });
    expect(patchKeysWithGeo(loadedReversed, { lat: 40.7222, lng: -73.9578 })).toEqual([]);
    expect(
      computeRichFieldDiffs(original, {
        ...liveEventToEditableDraft(original),
        locationGeo: { lng: -73.9578, lat: 40.7222 },
      }).map((diff) => diff.fieldKey),
    ).toEqual([]);
  });

  test("GEO-2: negative zero is the same place as zero", () => {
    const equator = liveEvent({ locationGeo: { lat: 0, lng: 0 } });
    expect(patchKeysWithGeo(equator, { lat: -0, lng: -0 })).toEqual([]);
  });

  test("GEO-3: the smallest real move is a move, on either axis", () => {
    const original = liveEvent();
    expect(patchKeysWithGeo(original, { lat: 40.7222001, lng: -73.9578 })).toEqual([
      "locationGeo",
    ]);
    expect(patchKeysWithGeo(original, { lat: 40.7222, lng: -73.9578001 })).toEqual([
      "locationGeo",
    ]);
    // Same two numbers, swapped: a different place entirely.
    expect(patchKeysWithGeo(original, { lat: -73.9578, lng: 40.7222 })).toEqual([
      "locationGeo",
    ]);
    // Sign flipped.
    expect(patchKeysWithGeo(original, { lat: -40.7222, lng: -73.9578 })).toEqual([
      "locationGeo",
    ]);
  });

  test("GEO-4: a pin that is not two finite numbers is never 'unchanged'", () => {
    const original = liveEvent();
    // The same digits as text are not the stored number: never silently equal.
    expect(patchKeysWithGeo(original, { lat: "40.7222", lng: "-73.9578" })).toEqual([
      "locationGeo",
    ]);
    // NaN equals nothing, itself included: a broken pin is surfaced, not hidden.
    expect(patchKeysWithGeo(original, { lat: Number.NaN, lng: -73.9578 })).toEqual([
      "locationGeo",
    ]);
    // A pin missing one coordinate is not the stored pin.
    expect(patchKeysWithGeo(original, { lat: 40.7222 })).toEqual(["locationGeo"]);
  });

  test("GEO-5: every pairing of 'no pin' is unchanged, and none hides a real pin", () => {
    for (const stored of [null, undefined]) {
      const original = liveEvent({ locationGeo: stored as unknown as Geo });
      expect(patchKeysWithGeo(original, null)).toEqual([]);
      expect(patchKeysWithGeo(original, undefined)).toEqual([]);
      expect(patchKeysWithGeo(original, { lat: 40.7222, lng: -73.9578 })).toEqual([
        "locationGeo",
      ]);
    }
    const withPin = liveEvent();
    const cleared = editableDraftToPatch(withPin, {
      ...liveEventToEditableDraft(withPin),
      locationGeo: null,
    });
    expect(Object.keys(cleared)).toEqual(["locationGeo"]);
    expect(cleared.locationGeo).toBeNull();
    // A pin at exactly 0,0 is a pin, not "none".
    expect(patchKeysWithGeo(liveEvent({ locationGeo: null }), { lat: 0, lng: 0 })).toEqual([
      "locationGeo",
    ]);
  });
});

describe("issue #3827 tester — the structural compare cannot hide a real change", () => {
  const structured = (): LiveEvent =>
    liveEvent({
      whenMode: "recurring",
      recurrenceRule: {
        preset: "weekly",
        byDays: ["MO", "FR"],
        termination: { kind: "count", count: 6 },
      } as unknown as LiveEvent["recurrenceRule"],
      multiDates: [
        { id: "d1", date: "2026-07-01", startTime: "20:00", endTime: "23:00" },
        { id: "d2", date: "2026-07-08", startTime: "20:00", endTime: "23:00" },
      ] as unknown as LiveEvent["multiDates"],
      tickets: [ticket("t1"), ticket("t2", { name: "VIP", displayOrder: 1 })],
      coverGallery: [
        { url: "https://cdn.example.test/3827/a.jpg", type: "image" },
        { url: "https://cdn.example.test/3827/b.jpg", type: "image" },
      ] as unknown as LiveEvent["coverGallery"],
      pricingSwitches: { passTax: true, passMinglaFee: null, passServiceFee: false },
    });

  const patchFor = (
    original: LiveEvent,
    change: (draft: DraftEvent) => Partial<DraftEvent>,
  ): string[] => {
    const base = liveEventToEditableDraft(original);
    return Object.keys(editableDraftToPatch(original, { ...base, ...change(base) }));
  };

  test("SAME-1: key order reversed at every depth of every structure at once is no change", () => {
    const original = structured();
    expect(
      patchFor(original, (base) => ({
        recurrenceRule: reverseKeys(base.recurrenceRule),
        multiDates: reverseKeys(base.multiDates),
        tickets: reverseKeys(base.tickets),
        coverGallery: reverseKeys(base.coverGallery),
        pricingSwitches: reverseKeys(base.pricingSwitches),
        locationGeo: reverseKeys(base.locationGeo),
      })),
    ).toEqual([]);
  });

  test("SAME-2: a key holding undefined is absent, on either side", () => {
    const original = structured();
    expect(
      patchFor(original, (base) => ({
        tickets: [
          { ...base.tickets[0], ghost: undefined } as unknown as TicketStub,
          base.tickets[1],
        ],
      })),
    ).toEqual([]);
    // The stored side carries the undefined key instead.
    const storedWithGhost = liveEvent({
      tickets: [ticket("t1", { ghost: undefined })],
    });
    expect(
      patchFor(storedWithGhost, () => ({ tickets: [ticket("t1")] })),
    ).toEqual([]);
  });

  test("HIDE-1: an order-sensitive array inside a key-reordered object is still a change", () => {
    const original = structured();
    expect(
      patchFor(original, (base) => {
        const rule = reverseKeys(base.recurrenceRule) as unknown as {
          byDays: string[];
        };
        return {
          recurrenceRule: {
            ...rule,
            byDays: [...rule.byDays].reverse(),
          } as unknown as DraftEvent["recurrenceRule"],
        };
      }),
    ).toEqual(["recurrenceRule"]);
    // Reordered photos, each with its own keys reversed too.
    expect(
      patchFor(original, (base) => ({
        coverGallery: [...(reverseKeys(base.coverGallery) ?? [])].reverse(),
      })),
    ).toEqual(["coverGallery"]);
    // One nested value changed three levels down, keys reversed around it.
    expect(
      patchFor(original, (base) => {
        const rule = reverseKeys(base.recurrenceRule) as unknown as {
          termination: { kind: string; count: number };
        };
        return {
          recurrenceRule: {
            ...rule,
            termination: { count: 7, kind: "count" },
          } as unknown as DraftEvent["recurrenceRule"],
        };
      }),
    ).toEqual(["recurrenceRule"]);
  });

  test("HIDE-2: a number is not the numeric string that prints the same", () => {
    const original = structured();
    expect(
      patchFor(original, (base) => ({
        tickets: [
          { ...base.tickets[0], priceGbp: "12" } as unknown as TicketStub,
          base.tickets[1],
        ],
      })),
    ).toEqual(["tickets"]);
    expect(
      patchFor(original, (base) => ({
        tickets: [
          { ...base.tickets[0], capacity: "100" } as unknown as TicketStub,
          base.tickets[1],
        ],
      })),
    ).toEqual(["tickets"]);
    // true is not "true", and 1 is not true.
    expect(
      patchFor(original, () => ({
        pricingSwitches: {
          passTax: "true",
          passMinglaFee: null,
          passServiceFee: false,
        } as unknown as DraftEvent["pricingSwitches"],
      })),
    ).toEqual(["pricingSwitches"]);
    expect(
      patchFor(original, () => ({
        pricingSwitches: {
          passTax: 1,
          passMinglaFee: null,
          passServiceFee: false,
        } as unknown as DraftEvent["pricingSwitches"],
      })),
    ).toEqual(["pricingSwitches"]);
  });

  test("HIDE-3: null, a missing key and the falsy values are all different things", () => {
    const original = structured();
    // null -> missing key.
    expect(
      patchFor(original, (base) => {
        const { password: _dropped, ...rest } = base.tickets[0] as unknown as Record<
          string,
          unknown
        >;
        return { tickets: [rest as unknown as TicketStub, base.tickets[1]] };
      }),
    ).toEqual(["tickets"]);
    // null -> undefined (JSON drops the key: the same as missing).
    expect(
      patchFor(original, (base) => ({
        tickets: [
          { ...base.tickets[0], password: undefined } as unknown as TicketStub,
          base.tickets[1],
        ],
      })),
    ).toEqual(["tickets"]);
    // null -> false, 0 and "" on a switch the host really did flip.
    for (const value of [false, 0, ""]) {
      expect(
        patchFor(original, () => ({
          pricingSwitches: {
            passTax: true,
            passMinglaFee: value,
            passServiceFee: false,
          } as unknown as DraftEvent["pricingSwitches"],
        })),
      ).toEqual(["pricingSwitches"]);
    }
    // false -> null.
    expect(
      patchFor(original, () => ({
        pricingSwitches: { passTax: true, passMinglaFee: null, passServiceFee: null },
      })),
    ).toEqual(["pricingSwitches"]);
    // An empty object is not null, and an empty array is not an empty object.
    expect(
      patchFor(liveEvent({ recurrenceRule: null }), () => ({
        recurrenceRule: {} as unknown as DraftEvent["recurrenceRule"],
      })),
    ).toEqual(["recurrenceRule"]);
    expect(
      patchFor(liveEvent({ multiDates: [] as unknown as LiveEvent["multiDates"] }), () => ({
        multiDates: {} as unknown as DraftEvent["multiDates"],
      })),
    ).toEqual(["multiDates"]);
  });

  test("HIDE-4: the same number of keys is not the same keys", () => {
    const original = liveEvent({
      tickets: [ticket("t1", { perk: "drink" })],
    });
    // One key renamed, same value, same key count.
    expect(
      patchFor(original, (base) => {
        const { perk: _perk, ...rest } = base.tickets[0] as unknown as Record<
          string,
          unknown
        >;
        return { tickets: [{ ...rest, bonus: "drink" } as unknown as TicketStub] };
      }),
    ).toEqual(["tickets"]);
    // A real key swapped for an undefined one plus a new one: the count of
    // DEFINED keys matches, the keys do not.
    expect(
      patchFor(original, (base) => ({
        tickets: [
          {
            ...base.tickets[0],
            perk: undefined,
            bonus: "drink",
          } as unknown as TicketStub,
        ],
      })),
    ).toEqual(["tickets"]);
    // An added element, a removed element, and an element that became null.
    const two = liveEvent({ tickets: [ticket("t1"), ticket("t2")] });
    expect(
      patchFor(two, (base) => ({ tickets: [...base.tickets, ticket("t3")] })),
    ).toEqual(["tickets"]);
    expect(patchFor(two, (base) => ({ tickets: [base.tickets[0]] }))).toEqual([
      "tickets",
    ]);
    expect(
      patchFor(two, (base) => ({
        tickets: [base.tickets[0], null as unknown as TicketStub],
      })),
    ).toEqual(["tickets"]);
  });

  test("HIDE-5: an array is not an object with the same indexes, and order inside nested arrays counts", () => {
    const original = liveEvent({
      multiDates: [
        { id: "d1", date: "2026-07-01", tags: ["a", "b"] },
      ] as unknown as LiveEvent["multiDates"],
    });
    expect(
      patchFor(original, () => ({
        multiDates: [
          { id: "d1", date: "2026-07-01", tags: ["b", "a"] },
        ] as unknown as DraftEvent["multiDates"],
      })),
    ).toEqual(["multiDates"]);
    expect(
      patchFor(original, () => ({
        multiDates: [
          { id: "d1", date: "2026-07-01", tags: { 0: "a", 1: "b" } },
        ] as unknown as DraftEvent["multiDates"],
      })),
    ).toEqual(["multiDates"]);
    expect(
      patchFor(original, () => ({
        multiDates: {
          0: { id: "d1", date: "2026-07-01", tags: ["a", "b"] },
        } as unknown as DraftEvent["multiDates"],
      })),
    ).toEqual(["multiDates"]);
  });
});

describe("issue #3827 tester — the patch carries only what moved", () => {
  test("PATCH-1: an untouched event with a pin and structures builds an empty patch and no diff rows", () => {
    const original = liveEvent({
      tickets: [ticket("t1")],
      locationGeo: { lng: -73.9578, lat: 40.7222 } as Geo,
    });
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      // What the wizard's Where step leaves behind when nothing was touched.
      locationGeo: { lat: 40.7222, lng: -73.9578 },
      tickets: reverseKeys(original.tickets),
    };
    expect(editableDraftToPatch(original, edited)).toEqual({});
    expect(computeRichFieldDiffs(original, edited)).toEqual([]);
  });

  test("PATCH-2: an address edit alone does not drag the pin along, and a pin move alone does not drag the address", () => {
    const original = liveEvent();
    const base = liveEventToEditableDraft(original);
    const addressOnly = editableDraftToPatch(original, {
      ...base,
      address: "250 Bedford Avenue, Brooklyn",
      locationGeo: { lng: -73.9578, lat: 40.7222 },
    });
    expect(Object.keys(addressOnly)).toEqual(["address"]);
    const pinOnly = editableDraftToPatch(original, {
      ...base,
      locationGeo: { lat: 40.7081, lng: -73.9571 },
    });
    expect(Object.keys(pinOnly)).toEqual(["locationGeo"]);
    const venueOnly = editableDraftToPatch(original, {
      ...base,
      venueName: "The Bedford Hall",
    });
    expect(Object.keys(venueOnly)).toEqual(["venueName"]);
  });
});

describe("issue #3827 tester — the reason guard when the reason is optional", () => {
  const event = liveEvent();
  const ctx = { soldCountByTier: {}, soldCountForEvent: 0 };
  const run = (reason: string, required?: boolean) =>
    required === undefined
      ? validateLiveEventFieldUpdate(event, { name: "New name" }, ctx as never, reason)
      : validateLiveEventFieldUpdate(
          event,
          { name: "New name" },
          ctx as never,
          reason,
          required,
        );

  test("REASON-1: optional means blank passes; every kind of blank is the same blank", () => {
    for (const blank of ["", "   ", "\n\n", "\t \r\n", "  "]) {
      const result = run(blank, false);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.trimmedReason).toBe("");
      // And the default is still "required".
      expect(run(blank)).toEqual({ ok: false, reason: "missing_edit_reason" });
      expect(run(blank, true)).toEqual({ ok: false, reason: "missing_edit_reason" });
    }
  });

  test("REASON-2: optional never means 'anything goes' for a reason that was typed", () => {
    for (const required of [true, false]) {
      expect(run("123456789", required)).toEqual({
        ok: false,
        reason: "invalid_edit_reason",
      });
      expect(run("  123456789  ", required)).toEqual({
        ok: false,
        reason: "invalid_edit_reason",
      });
      expect(run("x".repeat(201), required)).toEqual({
        ok: false,
        reason: "invalid_edit_reason",
      });
      const ten = run("  1234567890  ", required);
      expect(ten.ok).toBe(true);
      if (ten.ok) expect(ten.trimmedReason).toBe("1234567890");
      expect(run("x".repeat(200), required).ok).toBe(true);
    }
  });

  test("REASON-3: the words logged for a blank reason are a reason the strict check accepts", () => {
    expect(NO_BUYERS_EDIT_REASON).toBe("No buyers at time of edit; no reason given");
    expect(NO_BUYERS_EDIT_REASON.trim()).toBe(NO_BUYERS_EDIT_REASON);
    expect(NO_BUYERS_EDIT_REASON.length).toBeGreaterThanOrEqual(10);
    expect(NO_BUYERS_EDIT_REASON.length).toBeLessThanOrEqual(200);
    expect(run(NO_BUYERS_EDIT_REASON, true).ok).toBe(true);
  });
});
