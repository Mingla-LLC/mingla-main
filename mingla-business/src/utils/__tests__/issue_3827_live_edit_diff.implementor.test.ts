/**
 * issue #3827 [live event editor: one owner for location, buyer-aware reason]
 * — implementor happy-path regression for the non-rendering client half.
 *
 * WHAT THIS FILE PINS
 *   DIFF-*   the published-event diff no longer invents changes. The pin is
 *            compared by lat and lng, and every structured field
 *            (recurrenceRule, multiDates, tickets, coverGallery,
 *            pricingSwitches, themeOverrides) is compared structurally, so the
 *            same value with its keys in another order is not a change. Array
 *            order is still a change.
 *   RSVP-*   both RSVP edit payload builders send the structured
 *            `location: { venueName, address }` beside `location_text`.
 *   LABEL-*  the TypeScript label composer (`locationTextForDraft`, reached
 *            through the builders) agrees with the SQL composer
 *            `business_event_location_label` on ONE table. The table lives in
 *            the pg17 suite; this file reads it from there, so the two suites
 *            cannot drift apart without one of them going red.
 *   GUARD-*  `validateLiveEventFieldUpdate` takes `reasonRequired`: blank
 *            passes only when it is false, and a typed reason is still held to
 *            10..200 characters.
 *
 * FAILS-ON-REVERT: restore liveEventAdapter.ts, serverDraftEventMapper.ts or
 * publishedEventEditGuards.ts from origin/main and DIFF-*, RSVP-* or GUARD-*
 * goes red respectively. LABEL-* fails if either composer changes its rule.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { beforeAll, describe, expect, test } from "@jest/globals";

import {
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import {
  buildRsvpUpdatePayload,
  buildRsvpUpdatePayloadDiff,
} from "../serverDraftEventMapper";
import {
  NO_BUYERS_EDIT_REASON,
  validateLiveEventFieldUpdate,
} from "../publishedEventEditGuards";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "event-3827",
    serverEventId: "server-event-3827",
    brandId: "brand-1",
    brandSlug: "brand",
    eventSlug: "issue-3827-night",
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
    // The full loaded shape, so an untouched edit state diffs to nothing.
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

/** The same object with its keys in the opposite order, recursively. */
const reverseKeys = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => reverseKeys(item)) as unknown as T;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(
      entries.map(([key, item]) => [key, reverseKeys(item)]),
    ) as T;
  }
  return value;
};

const ticket = (id: string, name: string): TicketStub =>
  ({
    id,
    name,
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
  }) as unknown as TicketStub;

describe("issue #3827 — the published-event diff does not invent changes", () => {
  test("DIFF-1: the same pin with its keys in another order is not a change", () => {
    const original = liveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      locationGeo: { lng: -73.9578, lat: 40.7222 },
    };
    // The fixture really does differ by key order only.
    expect(JSON.stringify(edited.locationGeo)).not.toBe(
      JSON.stringify(original.locationGeo),
    );
    const patch = editableDraftToPatch(original, edited);
    expect(patch.locationGeo).toBeUndefined();
    expect(Object.keys(patch)).toEqual([]);
    expect(
      computeRichFieldDiffs(original, edited).map((diff) => diff.fieldKey),
    ).toEqual([]);
  });

  test("DIFF-2: a pin that moved, appeared or was cleared is a change", () => {
    const original = liveEvent();
    const moved: DraftEvent = {
      ...liveEventToEditableDraft(original),
      locationGeo: { lat: 40.7081, lng: -73.9571 },
    };
    expect(editableDraftToPatch(original, moved).locationGeo).toEqual({
      lat: 40.7081,
      lng: -73.9571,
    });

    const cleared: DraftEvent = {
      ...liveEventToEditableDraft(original),
      locationGeo: null,
    };
    expect(editableDraftToPatch(original, cleared)).toHaveProperty(
      "locationGeo",
      null,
    );

    const noPin = liveEvent({ locationGeo: null });
    const appeared: DraftEvent = {
      ...liveEventToEditableDraft(noPin),
      locationGeo: { lat: 40.7222, lng: -73.9578 },
    };
    expect(editableDraftToPatch(noPin, appeared).locationGeo).toEqual({
      lat: 40.7222,
      lng: -73.9578,
    });

    // Null-safe: no pin on either side is not a change, whichever way the
    // loaded event spells "none".
    const legacy = liveEvent({ locationGeo: undefined });
    const untouched: DraftEvent = liveEventToEditableDraft(legacy);
    expect(editableDraftToPatch(legacy, untouched).locationGeo).toBeUndefined();
  });

  test("DIFF-3: structured fields with reordered keys are not changes", () => {
    const original = liveEvent({
      whenMode: "recurring",
      recurrenceRule: {
        preset: "weekly",
        byDay: "FR",
        termination: { kind: "count", count: 6 },
      } as unknown as LiveEvent["recurrenceRule"],
      multiDates: [
        { id: "d1", date: "2026-07-01", startTime: "20:00", endTime: "23:00" },
        { id: "d2", date: "2026-07-08", startTime: "20:00", endTime: "23:00" },
      ] as unknown as LiveEvent["multiDates"],
      tickets: [ticket("t1", "General"), ticket("t2", "VIP")],
      coverGallery: [
        { url: "https://cdn.example.test/3827/a.jpg", type: "image" },
        { url: "https://cdn.example.test/3827/b.jpg", type: "image" },
      ] as unknown as LiveEvent["coverGallery"],
      pricingSwitches: { passTax: true, passMinglaFee: null, passServiceFee: false },
      themeOverrides: {
        color: "ember",
        font: "grotesk",
        animation: null,
      } as unknown as LiveEvent["themeOverrides"],
    });
    const base = liveEventToEditableDraft(original);
    const edited: DraftEvent = {
      ...base,
      recurrenceRule: reverseKeys(base.recurrenceRule),
      multiDates: reverseKeys(base.multiDates),
      tickets: reverseKeys(base.tickets),
      coverGallery: reverseKeys(base.coverGallery),
      pricingSwitches: reverseKeys(base.pricingSwitches),
      themeOverrides: reverseKeys(base.themeOverrides),
    };
    // The fixture really does differ by key order, field by field.
    for (const key of [
      "recurrenceRule",
      "multiDates",
      "tickets",
      "coverGallery",
      "pricingSwitches",
      "themeOverrides",
    ] as const) {
      expect(JSON.stringify(edited[key])).not.toBe(JSON.stringify(base[key]));
    }

    expect(Object.keys(editableDraftToPatch(original, edited))).toEqual([]);
    expect(
      computeRichFieldDiffs(original, edited).map((diff) => diff.fieldKey),
    ).toEqual([]);
  });

  test("DIFF-4: array order is still a change, and so is a changed value", () => {
    const original = liveEvent({
      tickets: [ticket("t1", "General"), ticket("t2", "VIP")],
      multiDates: [
        { id: "d1", date: "2026-07-01", startTime: "20:00", endTime: "23:00" },
        { id: "d2", date: "2026-07-08", startTime: "20:00", endTime: "23:00" },
      ] as unknown as LiveEvent["multiDates"],
      pricingSwitches: { passTax: true, passMinglaFee: null, passServiceFee: false },
    });
    const base = liveEventToEditableDraft(original);

    const reordered: DraftEvent = {
      ...base,
      tickets: [...base.tickets].reverse(),
      multiDates: [...(base.multiDates ?? [])].reverse(),
    };
    const reorderedPatch = editableDraftToPatch(original, reordered);
    expect(reorderedPatch.tickets?.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(reorderedPatch.multiDates).toBeDefined();

    const renamed: DraftEvent = {
      ...base,
      tickets: [{ ...base.tickets[0], name: "Early bird" }, base.tickets[1]],
      pricingSwitches: { passTax: false, passMinglaFee: null, passServiceFee: false },
    };
    const renamedPatch = editableDraftToPatch(original, renamed);
    expect(renamedPatch.tickets?.[0].name).toBe("Early bird");
    expect(renamedPatch.pricingSwitches).toEqual({
      passTax: false,
      passMinglaFee: null,
      passServiceFee: false,
    });

    // An extra key with a real value is a change; one holding undefined is not.
    const withUndefinedKey: DraftEvent = {
      ...base,
      tickets: [
        { ...base.tickets[0], futureField: undefined } as unknown as TicketStub,
        base.tickets[1],
      ],
    };
    expect(editableDraftToPatch(original, withUndefinedKey).tickets).toBeUndefined();
    const withExtraKey: DraftEvent = {
      ...base,
      tickets: [
        { ...base.tickets[0], futureField: "x" } as unknown as TicketStub,
        base.tickets[1],
      ],
    };
    expect(editableDraftToPatch(original, withExtraKey).tickets).toBeDefined();
  });
});

describe("issue #3827 — the RSVP edit payload carries the structured location", () => {
  const rsvp = liveEvent({ event_type: "rsvp" } as Partial<LiveEvent>);

  test("RSVP-1: the diff builder sends both halves beside the label", () => {
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(rsvp),
      venueName: "The Bedford Hall",
      address: "250 Bedford Avenue, Brooklyn",
    };
    const payload = buildRsvpUpdatePayloadDiff(rsvp, edited);
    expect(payload.location).toEqual({
      venueName: "The Bedford Hall",
      address: "250 Bedford Avenue, Brooklyn",
    });
    expect(payload.location_text).toBe(
      "The Bedford Hall · 250 Bedford Avenue, Brooklyn",
    );
  });

  test("RSVP-2: the diff builder sends the halves on an unrelated edit too", () => {
    // `location_text` is an always-on key, so `location` must be as well:
    // the server derives the label from `location` whenever it is present.
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(rsvp),
      name: "Issue 3827 night, renamed",
    };
    const payload = buildRsvpUpdatePayloadDiff(rsvp, edited);
    expect(payload.location).toEqual({
      venueName: "Lantern Room",
      address: "61 Wythe Avenue, Brooklyn",
    });
  });

  test("RSVP-3: the full-state builder sends them, and a cleared half is null", () => {
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(rsvp),
      venueName: null,
    };
    const payload = buildRsvpUpdatePayload(edited);
    expect(payload.location).toEqual({
      venueName: null,
      address: "61 Wythe Avenue, Brooklyn",
    });
    expect(payload.location_text).toBe("61 Wythe Avenue, Brooklyn");
  });
});

// ── LABEL parity ────────────────────────────────────────────────────────────

interface LabelCase {
  name: string;
  venue: string | null;
  address: string | null;
  expected: string | null;
}

const SQL_SUITE = path.resolve(
  __dirname,
  "../../../../supabase/migrations/__tests__/issue_3827_live_edit_location_one_owner.implementor.happy.pg17.test.sql",
);

const readSharedLabelCases = async (): Promise<{
  sql: string;
  cases: LabelCase[];
}> => {
  const sql = await fs.promises.readFile(SQL_SUITE, "utf8");
  const first = sql.indexOf("$cases$");
  const last = sql.lastIndexOf("$cases$");
  if (first === -1 || last === first) {
    throw new Error(
      "issue #3827: the shared label table is no longer between two $cases$ markers in the pg17 suite",
    );
  }
  return {
    sql,
    cases: JSON.parse(sql.slice(first + "$cases$".length, last)) as LabelCase[],
  };
};

describe("issue #3827 — one label rule, in TypeScript and in SQL", () => {
  let cases: LabelCase[] = [];
  let sql = "";
  beforeAll(async () => {
    const shared = await readSharedLabelCases();
    cases = shared.cases;
    sql = shared.sql;
  });

  test("LABEL-1: the shared table was read whole and is used by the SQL suite", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    // The same rows are run through the SQL composer in H-06.
    expect(sql).toContain("pg_temp.issue_3827_label_cases()");
    expect(sql).toContain(
      "public.business_event_location_label(c ->> 'venue', c ->> 'address')",
    );
    // The cases that separate a real composer from a naive one are present.
    const names = cases.map((c) => c.name);
    expect(names).toContain("venue of a no-break space");
    expect(names).toContain("halves are joined as stored, not trimmed");
    expect(names).toContain("a zero-width space is not blank");
    expect(names).toContain("neither");
  });

  test("LABEL-2: every row composes to the same label in TypeScript as in SQL", () => {
    // One row per case, by name, so a failure says which case broke.
    const composed = cases.map((labelCase) => {
      const draft: DraftEvent = {
        ...liveEventToEditableDraft(liveEvent()),
        venueName: labelCase.venue,
        address: labelCase.address,
      };
      // `locationTextForDraft` is the composer; both builders call it.
      return {
        name: labelCase.name,
        full: buildRsvpUpdatePayload(draft).location_text,
        diff: buildRsvpUpdatePayloadDiff(liveEvent(), draft).location_text,
      };
    });
    expect(composed).toEqual(
      cases.map((labelCase) => ({
        name: labelCase.name,
        full: labelCase.expected,
        diff: labelCase.expected,
      })),
    );
    expect(composed).toHaveLength(cases.length);
  });
});

describe("issue #3827 — the reason is required only when it is owed", () => {
  const event = liveEvent();
  const context = { soldCountByTier: {}, soldCountForEvent: 0 };
  const patch = { name: "Issue 3827 night, renamed" };

  test("GUARD-1: by default a blank reason is refused, exactly as before", () => {
    expect(validateLiveEventFieldUpdate(event, patch, context, "   ")).toEqual({
      ok: false,
      reason: "missing_edit_reason",
    });
    expect(validateLiveEventFieldUpdate(event, patch, context, "", true)).toEqual({
      ok: false,
      reason: "missing_edit_reason",
    });
  });

  test("GUARD-2: with reasonRequired false a blank reason passes as an empty string", () => {
    expect(
      validateLiveEventFieldUpdate(event, patch, context, "  ", false),
    ).toEqual({ ok: true, trimmedReason: "" });
  });

  test("GUARD-3: a typed reason is held to 10..200 characters either way", () => {
    for (const required of [true, false]) {
      expect(
        validateLiveEventFieldUpdate(event, patch, context, "too short", required),
      ).toEqual({ ok: false, reason: "invalid_edit_reason" });
      expect(
        validateLiveEventFieldUpdate(event, patch, context, "x".repeat(201), required),
      ).toEqual({ ok: false, reason: "invalid_edit_reason" });
      expect(
        validateLiveEventFieldUpdate(
          event,
          patch,
          context,
          "  Fixing a typo in the name  ",
          required,
        ),
      ).toEqual({ ok: true, trimmedReason: "Fixing a typo in the name" });
    }
  });

  test("GUARD-4: the local log's no-buyers reason is the server's, and passes the default check", async () => {
    // business_resolve_edit_reason records exactly these words.
    expect(NO_BUYERS_EDIT_REASON).toBe("No buyers at time of edit; no reason given");
    const migration = await fs.promises.readFile(
      path.resolve(
        __dirname,
        "../../../../supabase/migrations/20270828003827_issue_3827_live_edit_location_one_owner.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(`RETURN '${NO_BUYERS_EDIT_REASON}';`);
    expect(
      validateLiveEventFieldUpdate(event, patch, context, NO_BUYERS_EDIT_REASON),
    ).toEqual({ ok: true, trimmedReason: NO_BUYERS_EDIT_REASON });
  });

  test("GUARD-5: the other refusals still run when the reason is optional", () => {
    expect(
      validateLiveEventFieldUpdate(null, patch, context, "", false),
    ).toEqual({ ok: false, reason: "event_not_found" });
  });
});
