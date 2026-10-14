/* eslint-disable import/first */
// issue #3827 — the "Review changes" sheet showed a MAP LOCATION row with raw
// `{"lng":-73.96,"lat":40.71} → {"lat":40.69,…}` when a host changed a live
// event's address.
//
// WHAT THIS FILE PINS
//   DIFF-*  the REAL computeRichFieldDiffs: a moved pin is one "Map pin" row
//           that says "Moved" / "Added" / "Removed" and carries no
//           coordinates; a settings object (theme, who covers costs) is
//           "Changed"; a list of words reads as words. No value is JSON.
//   ROWS-*  the REAL changeSummaryRows guard: the pin row is dropped when the
//           address row is in the list; any serialized object or list (whole
//           or truncated) becomes a one-word summary, whatever field it is.
//   CS-*    the REAL ChangeSummaryModal, rendered: an address change with the
//           pin shows the address only; a pin-only move shows "Map pin" with
//           "Moved"; a stray JSON value from any editor (trip included) never
//           paints.
//
// FAILS-ON-REVERT: restore liveEventAdapter.ts and DIFF-* goes red; delete
// changeSummaryRows.ts and nothing loads; restore ChangeSummaryModal.tsx and
// CS-* goes red.

import React from "react";

import { describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

jest.mock("../../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    props.visible ? require("react").createElement("SheetProbe", null, props.children) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("IconProbe", props),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: (props: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ScrollViewProbe", null, props.children),
}));

import { ChangeSummaryModal } from "../ChangeSummaryModal";
import {
  computeRichFieldDiffs,
  liveEventToEditableDraft,
  type FieldDiff,
} from "../../../utils/liveEventAdapter";
import {
  DIFF_CHANGED_SUMMARY,
  changeSummaryRows,
  looksLikeSerializedData,
} from "../../../utils/changeSummaryRows";
import type { DraftEvent } from "../../../store/draftEventStore";
import type { LiveEvent } from "../../../store/liveEventStore";

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "event-3827-rows",
    serverEventId: "server-event-3827-rows",
    brandId: "brand-1",
    brandSlug: "brand",
    eventSlug: "issue-3827-rows",
    status: "scheduled",
    publishedAt: "2026-06-01T12:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "event",
    name: "Issue 3827 rows",
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
    locationGeo: { lng: -73.9578, lat: 40.7122 },
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

const edit = (original: LiveEvent, patch: Partial<DraftEvent>): DraftEvent => ({
  ...liveEventToEditableDraft(original),
  ...patch,
});

const COORDINATES = /-?\d+\.\d{2,}/;
const allValues = (diffs: FieldDiff[]): string[] =>
  diffs.flatMap((diff) => [diff.oldValue, diff.newValue, diff.summary ?? ""]);

const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const texts = (tree: Renderer): string[] =>
  tree.root.findAll((node) => (node.type as unknown) === "Text").map((node) => textOf(node));

const mountModal = async (diffs: FieldDiff[]): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ChangeSummaryModal
        visible
        diffs={diffs}
        severity="material"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
  });
  return tree;
};

describe("issue #3827 — a host never reads raw location data in Review changes", () => {
  test("DIFF-1: a pin that moved is one 'Map pin' row that says Moved, with no coordinates", () => {
    const original = liveEvent();
    const diffs = computeRichFieldDiffs(
      original,
      edit(original, { locationGeo: { lat: 40.6912, lng: -73.9851 } }),
    );
    expect(diffs).toEqual([
      expect.objectContaining({
        fieldKey: "locationGeo",
        fieldLabel: "Map pin",
        summary: "Moved",
        oldValue: "",
        newValue: "",
      }),
    ]);
    for (const value of allValues(diffs)) {
      expect(value).not.toMatch(COORDINATES);
      expect(looksLikeSerializedData(value)).toBe(false);
    }
  });

  test("DIFF-2: a pin that appeared or was cleared says so", () => {
    const noPin = liveEvent({ locationGeo: null });
    expect(
      computeRichFieldDiffs(noPin, edit(noPin, { locationGeo: { lat: 40.7, lng: -73.9 } }))[0]
        ?.summary,
    ).toBe("Added");
    const original = liveEvent();
    expect(
      computeRichFieldDiffs(original, edit(original, { locationGeo: null }))[0]?.summary,
    ).toBe("Removed");
  });

  test("DIFF-3: settings objects read 'Changed' and word lists read as words — never JSON", () => {
    const original = liveEvent();
    const diffs = computeRichFieldDiffs(
      original,
      edit(original, {
        pricingSwitches: { passTax: true, passMinglaFee: null, passServiceFee: null },
        partyTypes: ["festival", "rooftop"],
        musicGenres: ["house"],
      } as Partial<DraftEvent>),
    );
    const byKey = new Map(diffs.map((diff) => [diff.fieldKey, diff]));
    expect(byKey.get("pricingSwitches")?.summary).toBe(DIFF_CHANGED_SUMMARY);
    expect(byKey.get("partyTypes")).toMatchObject({
      oldValue: "festival",
      newValue: "festival, rooftop",
    });
    expect(byKey.get("musicGenres")).toMatchObject({ oldValue: "(empty)", newValue: "house" });
    for (const value of allValues(diffs)) {
      expect(looksLikeSerializedData(value)).toBe(false);
    }
  });

  test("ROWS-1: the pin row is dropped when the address row is in the list", () => {
    const original = liveEvent();
    const diffs = computeRichFieldDiffs(
      original,
      edit(original, {
        address: "250 Bedford Avenue, Brooklyn",
        locationGeo: { lat: 40.7172, lng: -73.9589 },
      }),
    );
    expect(diffs.map((diff) => diff.fieldKey)).toEqual(["address", "locationGeo"]);
    expect(changeSummaryRows(diffs).map((diff) => diff.fieldKey)).toEqual(["address"]);
    // The diff list itself is untouched (the editor still uses it).
    expect(diffs).toHaveLength(2);
  });

  test("ROWS-2: any serialized object or list becomes one word, whole or truncated", () => {
    const input: FieldDiff[] = [
      { fieldKey: "future", fieldLabel: "Future", oldValue: '{"lng":-73.96,"lat":40.71}', newValue: '{"lat":40.69,"lng":-73.98}' },
      { fieldKey: "cut", fieldLabel: "Cut", oldValue: "(empty)", newValue: '{"lat":40.6912345,"lng":-73.98510…' },
      { fieldKey: "list", fieldLabel: "List", oldValue: '["a","b"]', newValue: "[]" },
      { fieldKey: "words", fieldLabel: "Words", oldValue: "[Updated] Rooftop night", newValue: "{curly} name" },
    ];
    const rows = changeSummaryRows(input);
    expect(rows.map((row) => row.summary)).toEqual([
      DIFF_CHANGED_SUMMARY,
      DIFF_CHANGED_SUMMARY,
      DIFF_CHANGED_SUMMARY,
      undefined,
    ]);
  });

  test("CS-1: an address change with its pin shows the address, and no pin row or coordinates", async () => {
    const original = liveEvent();
    const tree = await mountModal(
      computeRichFieldDiffs(
        original,
        edit(original, {
          address: "250 Bedford Avenue, Brooklyn",
          locationGeo: { lat: 40.7172, lng: -73.9589 },
        }),
      ),
    );
    const shown = texts(tree);
    expect(shown).toEqual(expect.arrayContaining(["Address", "250 Bedford Avenue, Brooklyn"]));
    expect(shown).not.toContain("Map pin");
    expect(shown).not.toContain("Map location");
    for (const line of shown) {
      expect(line).not.toMatch(/"lat"|"lng"/);
    }
  });

  test("CS-2: a pin-only move shows 'Map pin' with 'Moved'", async () => {
    const original = liveEvent();
    const tree = await mountModal(
      computeRichFieldDiffs(original, edit(original, { locationGeo: { lat: 40.69, lng: -73.98 } })),
    );
    const shown = texts(tree);
    expect(shown).toEqual(expect.arrayContaining(["Map pin", "Moved"]));
    expect(shown.join(" ")).not.toMatch(COORDINATES);
  });

  test("CS-3: a stray JSON value from any editor never paints", async () => {
    const tree = await mountModal([
      {
        fieldKey: "trip_future_field",
        fieldLabel: "Something new",
        oldValue: '{"lng":-73.96,"lat":40.71}',
        newValue: '{"lat":40.69,"lng":-73.98}',
        severity: "safe",
      },
    ]);
    const shown = texts(tree);
    expect(shown).toEqual(expect.arrayContaining(["Something new", DIFF_CHANGED_SUMMARY]));
    for (const line of shown) {
      expect(line).not.toContain("{");
    }
  });
});
