/**
 * ORCH-0877 — TESTER ADVERSARIAL regression test suite #3.
 *
 * Attacks T-ADV-05: Zustand v10 → v11 persist migrator. Legacy persisted
 * drafts from pre-ORCH-0877 builds have NO `endsAtUtc` field. On rehydrate
 * the migrator must:
 *   - Backfill `endsAtUtc` via smart-infer when all four inputs (date,
 *     doorsOpen, endsAt, timezone) are present.
 *   - Gracefully return `endsAtUtc: null` when ANY input is missing — no
 *     app-startup crash. Common real-world cases: incomplete drafts users
 *     never finished (date-only, no time picked yet).
 *   - Cross-midnight legacy drafts (Web-authored with endsAt < doorsOpen
 *     pre-fix) get the correct next-day UTC wrap, not a same-day instant.
 *
 * fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19.
 *   Pre-ORCH-0877:
 *     - `computeEndsAtUtcWithSmartInfer` export doesn't exist.
 *     - `DraftEvent.endsAtUtc` field doesn't exist; the persist version is
 *       10 (not 11) and the migrator block is absent.
 *   The test simulates the migrator's behavior by exercising the exact
 *   helper the migrator calls. On revert the import fails to resolve.
 *
 * DIFFERENT angle than implementor's happy-path:
 *   - Implementor's eventDateMath_smart_infer.test.ts covers the helper in
 *     isolation with simple UTC inputs.
 *   - This adversarial set probes the MIGRATOR contract: incomplete-input
 *     graceful-null, cross-midnight wrap for legacy Web-authored drafts,
 *     no-crash guarantee on every shape that could exist in production
 *     AsyncStorage on rehydrate.
 */

import type { DraftEvent } from "../draftEventStore";
import { computeEndsAtUtcWithSmartInfer } from "../../utils/eventDateMath";

// The migrator block from `draftEventStore.ts:745-762` is closure-private;
// we reconstruct its exact body here so the test is hermetic. Any divergence
// between this simulator and the production migrator is a P1 finding.
type V10Draft = Omit<DraftEvent, "endsAtUtc">;
function simulateV10ToV11Migrator(
  drafts: V10Draft[],
): { drafts: Array<V10Draft & { endsAtUtc: string | null }> } {
  return {
    drafts: drafts.map((draft) => ({
      ...draft,
      endsAtUtc: computeEndsAtUtcWithSmartInfer(
        draft.date,
        draft.doorsOpen,
        draft.endsAt,
        draft.timezone,
      ),
    })),
  };
}

const makeV10Draft = (
  overrides: Partial<V10Draft> = {},
): V10Draft => {
  // Minimal v10-shape draft. Most fields aren't relevant to the migrator;
  // we focus on (date, doorsOpen, endsAt, timezone).
  return {
    id: "draft_1",
    clientRevision: 0,
    serverEventId: null,
    serverSlug: null,
    brandId: "brand_1",
    name: "Test event",
    description: "",
    format: "in_person",
    category: null as never,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    city: null,
    locationGeo: null,
    whenMode: "single",
    date: "2026-05-18",
    doorsOpen: "22:00",
    endsAt: "02:00",
    timezone: "UTC",
    recurrenceRule: null,
    multiDates: null,
    venueName: null,
    address: null,
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    currency: null,
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    ...overrides,
  } as unknown as V10Draft;
};

describe("ORCH-0877 adversarial — DraftEvent v10→v11 persist migrator", () => {
  test("T-ADV-05a — cross-midnight legacy draft (Web-authored) backfills with next-day wrap", () => {
    // A Web-authored draft pre-ORCH-0877: doors 22:00, ends 02:00, no
    // endsAtUtc. The migrator must wrap to next-day UTC.
    const v10 = makeV10Draft({ doorsOpen: "22:00", endsAt: "02:00" });
    const result = simulateV10ToV11Migrator([v10]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].endsAtUtc).toBe("2026-05-19T02:00:00.000Z");
  });

  test("T-ADV-05b — same-day legacy draft backfills with same-day instant", () => {
    // Doors 18:00, ends 23:00 — no wrap.
    const v10 = makeV10Draft({ doorsOpen: "18:00", endsAt: "23:00" });
    const result = simulateV10ToV11Migrator([v10]);
    expect(result.drafts[0].endsAtUtc).toBe("2026-05-18T23:00:00.000Z");
  });

  test("T-ADV-05c — incomplete draft (no date) defaults endsAtUtc to null — NO CRASH", () => {
    const v10 = makeV10Draft({ date: null });
    const result = simulateV10ToV11Migrator([v10]);
    expect(result.drafts[0].endsAtUtc).toBeNull();
  });

  test("T-ADV-05d — incomplete draft (no endsAt) defaults endsAtUtc to null — NO CRASH", () => {
    const v10 = makeV10Draft({ endsAt: null });
    const result = simulateV10ToV11Migrator([v10]);
    expect(result.drafts[0].endsAtUtc).toBeNull();
  });

  test("T-ADV-05e — incomplete draft (no doorsOpen but endsAt set) returns the endsAt instant (no wrap)", () => {
    // computeEndsAtUtcWithSmartInfer returns the candidate when doorsOpen is
    // null (no smart-infer comparison possible). This is intentional —
    // draft is incomplete but the persisted endsAt time is still meaningful.
    const v10 = makeV10Draft({ doorsOpen: null, endsAt: "23:00" });
    const result = simulateV10ToV11Migrator([v10]);
    expect(result.drafts[0].endsAtUtc).toBe("2026-05-18T23:00:00.000Z");
  });

  test("T-ADV-05f — mixed batch (cross-midnight + same-day + incomplete) all backfill correctly without crash", () => {
    const drafts = [
      makeV10Draft({ id: "d1", doorsOpen: "22:00", endsAt: "02:00" }), // cross-midnight
      makeV10Draft({ id: "d2", doorsOpen: "18:00", endsAt: "23:00" }), // same-day
      makeV10Draft({ id: "d3", date: null }),                          // incomplete
      makeV10Draft({ id: "d4", endsAt: null }),                        // incomplete
    ];
    const result = simulateV10ToV11Migrator(drafts);
    expect(result.drafts).toHaveLength(4);
    expect(result.drafts[0].endsAtUtc).toBe("2026-05-19T02:00:00.000Z");
    expect(result.drafts[1].endsAtUtc).toBe("2026-05-18T23:00:00.000Z");
    expect(result.drafts[2].endsAtUtc).toBeNull();
    expect(result.drafts[3].endsAtUtc).toBeNull();
  });

  test("T-ADV-05g — empty drafts array survives migration", () => {
    const result = simulateV10ToV11Migrator([]);
    expect(result.drafts).toHaveLength(0);
  });

  test("T-ADV-05h — invalid timezone string falls back gracefully (helper returns null)", () => {
    const v10 = makeV10Draft({ timezone: "Not/A/Real/Timezone" });
    const result = simulateV10ToV11Migrator([v10]);
    // localWallClockToUtcInstant catches the RangeError and returns null.
    expect(result.drafts[0].endsAtUtc).toBeNull();
  });
});
