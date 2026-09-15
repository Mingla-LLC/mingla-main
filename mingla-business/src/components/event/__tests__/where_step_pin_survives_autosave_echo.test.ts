/**
 * Where step — a picked address keeps its map pin through the autosave echo.
 *
 * THE BUG (RSVP wizard, iOS production build): pick "61 Wythe Avenue, Brooklyn,
 * New York 11249, United States", the static map preview renders, and about a
 * second later it falls back to "Pick an address to preview the map" while the
 * address label stays. It looked like a blur on the next tap. It was the
 * autosave:
 *
 *   pick → updateDraft({ address, city, locationGeo, coordinatePrecision })
 *   → 700 ms → business_update_rsvp_graph, whose draft branch never wrote
 *     events.location_geo → the response row carries location_geo NULL
 *   → serverRowToDraft read ONLY that column → locationGeo: null
 *   → upsertServerDraft REPLACES the local draft wholesale
 *   → CreatorStep3Where: buildStaticMapUrl({ lat: null, lng: null }) → empty map
 *   → the next autosave saves the blank, and publish ships no pin.
 *
 * The address survived because it rides theme.business_draft; city survived
 * because that owner does write the city column. coordinatePrecision was lost
 * on EVERY event draft (ticketed too): nothing wrote or read it.
 *
 * These cases run the REAL mapper and the REAL store, with the server rows built
 * from the REAL write leg (draftToServerUpdate) exactly as each owner stores
 * them, so the write and read legs meet on the same blob.
 *
 * FAILS-ON-REVERT:
 *   - read leg (serverRowToDraft blob fallback) → E-1, E-4, E-6 fail
 *     (measured: locationGeo comes back null).
 *   - precision write/read legs → E-2, E-3, E-4 assert coordinatePrecision
 *     survives; without either leg it reads null.
 *   - publish payload keys (businessEvents.ts) → P-1 asserts them directly.
 *   - RSVP edit diff (buildRsvpUpdatePayloadDiff) → R-1 asserts the keys.
 * The server half is pinned by
 * supabase/migrations/__tests__/rsvp_where_step_keeps_the_pin.test.sql.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

// The store imports convertDraftToLiveEvent; stub it so importing the store in
// the node/ts-jest env is side-effect-free.
jest.mock("../../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

const rpcMock = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";
import type { LiveEvent } from "../../../store/liveEventStore";
import {
  buildRsvpUpdatePayloadDiff,
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../../../utils/serverDraftEventMapper";
import { liveEventToEditableDraft } from "../../../utils/liveEventAdapter";
import { publishBusinessEventDraft } from "../../../services/businessEvents";
import {
  buildProxyStaticMapUrl,
  type StaticMapParams,
} from "../../../../../packages/offering-rendering/mapboxStaticProxyUrl";

const BRAND_ID = "64cb8e35-5b53-4633-8780-d7769bead244";
const DRAFT_ID = "0d5a1b3c-9c2e-4f61-8a7e-3b2d1c0e9f88";
const WYTHE = { lat: 40.7219, lng: -73.9577 };
const WYTHE_LABEL = "61 Wythe Avenue, Brooklyn, New York 11249, United States";

// The CreatorStep3Where map call, with the params it passes (height 160).
const wizardMapUrl = (draft: DraftEvent | null | undefined): string | null =>
  buildProxyStaticMapUrl(
    {
      lat: draft?.locationGeo?.lat ?? null,
      lng: draft?.locationGeo?.lng ?? null,
      accentHex: "#eb7825",
      height: 160,
    } satisfies StaticMapParams,
    "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1",
  );

const pickedDraft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  ...buildDraftEvent(BRAND_ID, DRAFT_ID, "2026-09-15T08:00:00.000Z"),
  name: "Lantern Room night",
  isRsvp: true,
  whenMode: "single",
  venueName: "Lantern Room",
  address: WYTHE_LABEL,
  city: "Brooklyn",
  locationGeo: WYTHE,
  coordinatePrecision: "exact",
  hideAddressUntilTicket: false,
  clientRevision: 4,
  ...patch,
});

/**
 * The events row an autosave owner returns, from the REAL write leg. The blob
 * goes through a JSON wire hop (JSON.stringify drops undefined).
 * `columnWritesGeo` false = business_update_rsvp_graph before the fix (it
 * never wrote location_geo); true = business_update_event_draft, and the RSVP
 * owner after the fix.
 */
const echoRow = (
  source: DraftEvent,
  columnWritesGeo: boolean,
): ServerDraftEventRow => {
  const payload = draftToServerUpdate(source, {});
  return {
    ...payload,
    theme: JSON.parse(JSON.stringify(payload.theme)) as Record<string, unknown>,
    location_geo: columnWritesGeo ? payload.location_geo : null,
    id: source.id,
    brand_id: source.brandId,
    created_by: "user-1",
    slug: "draft-where-pin",
    created_at: source.createdAt,
    updated_at: source.updatedAt,
    published_at: null,
    deleted_at: null,
  };
};

const echoThroughStore = (row: ServerDraftEventRow): DraftEvent | null => {
  const accepted = useDraftEventStore
    .getState()
    .upsertServerDraft(serverRowToDraft(row));
  // Without this, "survives" could be the echo being REJECTED and the local
  // draft left untouched — a false pass.
  expect(accepted).toBe(true);
  return useDraftEventStore.getState().getDraft(DRAFT_ID);
};

beforeEach(() => {
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {} });
  rpcMock.mockReset();
});

describe("Where step — the pin survives the autosave echo", () => {
  test("E-1 RSVP: the pre-fix server echo (location_geo NULL) no longer blanks the map", () => {
    const local = pickedDraft();
    useDraftEventStore.getState().upsertDraft(local);
    expect(wizardMapUrl(useDraftEventStore.getState().getDraft(DRAFT_ID))).not.toBeNull();

    const stored = echoThroughStore(echoRow(local, false));

    expect(stored?.address).toBe(WYTHE_LABEL);
    expect(stored?.locationGeo).toEqual(WYTHE);
    expect(wizardMapUrl(stored)).toContain("lat=40.7219");
    expect(wizardMapUrl(stored)).toContain("lng=-73.9577");
  });

  test("E-2 RSVP: after the server fix the column echo carries the pin and its precision", () => {
    const local = pickedDraft({ coordinatePrecision: "approximate" });
    useDraftEventStore.getState().upsertDraft(local);

    const stored = echoThroughStore(echoRow(local, true));

    expect(stored?.locationGeo).toEqual(WYTHE);
    // Drives the "Approximate location" badge + zoom 11 on the preview.
    expect(stored?.coordinatePrecision).toBe("approximate");
  });

  test("E-3 ticketed event: the pin was kept, but precision was wiped — now it survives", () => {
    const local = pickedDraft({ isRsvp: false });
    useDraftEventStore.getState().upsertDraft(local);

    const stored = echoThroughStore(echoRow(local, true));

    expect(stored?.locationGeo).toEqual(WYTHE);
    expect(stored?.coordinatePrecision).toBe("exact");
  });

  test("E-4 the next autosave writes the pin and precision back, never the blank", () => {
    const local = pickedDraft();
    useDraftEventStore.getState().upsertDraft(local);
    const stored = echoThroughStore(echoRow(local, false)) as DraftEvent;

    const nextSave = draftToServerUpdate(stored, {});
    const blob = nextSave.theme.business_draft as Record<string, unknown>;
    expect(nextSave.location_geo).toBe("(-73.9577,40.7219)");
    expect(blob.locationGeo).toEqual(WYTHE);
    expect(blob.coordinatePrecision).toBe("exact");
  });

  test("E-5 clearing the address clears the pin — the fallback never resurrects it", () => {
    const cleared = pickedDraft({
      address: null,
      city: null,
      locationGeo: null,
      coordinatePrecision: null,
    });
    useDraftEventStore.getState().upsertDraft(cleared);

    for (const columnWritesGeo of [false, true]) {
      const stored = echoThroughStore(echoRow(cleared, columnWritesGeo));
      expect({ columnWritesGeo, geo: stored?.locationGeo ?? null }).toEqual({
        columnWritesGeo,
        geo: null,
      });
      expect(stored?.coordinatePrecision).toBeNull();
      expect(wizardMapUrl(stored)).toBeNull();
    }
  });

  test("E-6 a legacy blob without the precision key reads null, and a corrupt pin is ignored", () => {
    const local = pickedDraft();
    const row = echoRow(local, false);
    const blob = (row.theme as Record<string, unknown>).business_draft as Record<
      string,
      unknown
    >;
    delete blob.coordinatePrecision;
    expect(serverRowToDraft(row).locationGeo).toEqual(WYTHE);
    expect(serverRowToDraft(row).coordinatePrecision).toBeNull();

    blob.locationGeo = { lat: "40.7", lng: null };
    expect(serverRowToDraft(row).locationGeo).toBeNull();
    expect(serverRowToDraft(row).coordinatePrecision).toBeNull();
  });
});

describe("Where step — the pin reaches the published event", () => {
  test("P-1 ticketed publish sends the top-level keys business_publish_event_draft promotes", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "stop-after-call" } });
    await expect(
      publishBusinessEventDraft(pickedDraft({ isRsvp: false, refundPolicy: null })),
    ).rejects.toEqual({ message: "stop-after-call" });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0] as [
      string,
      { p_draft_payload: Record<string, unknown> },
    ];
    expect(name).toBe("issue_1719_publish_event_with_poster");
    expect(args.p_draft_payload.locationGeo).toEqual(WYTHE);
    expect(args.p_draft_payload.coordinatePrecision).toBe("exact");
  });

  test("R-1 editing a published RSVP: a re-picked address sends pin, precision and city; an untouched one sends none", () => {
    const original = {
      name: "Lantern Room night",
      locationGeo: null,
      city: null,
    } as unknown as LiveEvent;
    const untouched = pickedDraft({ city: null, locationGeo: null, coordinatePrecision: null });

    const quiet = buildRsvpUpdatePayloadDiff(original, untouched);
    expect("location_geo" in quiet).toBe(false);
    expect("coordinate_precision" in quiet).toBe(false);
    expect("city" in quiet).toBe(false);

    const repicked = buildRsvpUpdatePayloadDiff(original, pickedDraft());
    expect(repicked.location_geo).toBe("(-73.9577,40.7219)");
    expect(repicked.coordinate_precision).toBe("exact");
    expect(repicked.city).toBe("Brooklyn");

    const clearedFrom = { ...original, locationGeo: WYTHE, city: "Brooklyn" } as LiveEvent;
    const cleared = buildRsvpUpdatePayloadDiff(
      clearedFrom,
      pickedDraft({ address: null, city: null, locationGeo: null, coordinatePrecision: null }),
    );
    expect(cleared.location_geo).toBeNull();
    expect(cleared.coordinate_precision).toBeNull();
    expect(cleared.city).toBeNull();
  });

  test("R-2 the published-RSVP editor seeds the loaded pin, so an unrelated edit never re-sends it", () => {
    const ROOT = path.resolve(__dirname, "../../../..");
    const adapter = fs.readFileSync(
      path.join(ROOT, "src/utils/liveEventAdapter.ts"),
      "utf8",
    );
    // liveEventToEditableDraft copies the loaded pin + city onto the edit state,
    // which is what makes R-1's "untouched → no keys" true in the real editor.
    expect(adapter).toContain("locationGeo: e.locationGeo ?? null");
    expect(typeof liveEventToEditableDraft).toBe("function");
  });
});
