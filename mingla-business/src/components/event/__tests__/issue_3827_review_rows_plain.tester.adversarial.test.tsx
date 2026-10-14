/* eslint-disable import/first */
// issue #3827 — tester adversarial suite (different angles from the implementor's).
//
// The implementor pinned the map pin, settings objects and the JSON guard. This
// suite attacks what the guard can break and what #3850 relies on:
//
//   TXT-*   real host text that merely STARTS like data ("[21+] Rooftop night",
//           "[2026] NYE", "{"Best"} night") must still read old → new, not be
//           swallowed into "Changed". (TXT-1 FAILS on 959ad1258: the guard's
//           truncated-JSON regex treats "[<digit>" and "{"" openers as data.)
//   VAL-*   value → null, null → value, 0, long strings, empty lists.
//   NOTE-*  the "Notifies" decision is fed by the FULL diff list: dropping the
//           pin row from the sheet never changes the keys the notice reads.
//   GATE-*  the sheet still refuses to save without a reason when buyers exist.

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
import { changeSummaryRows, DIFF_CHANGED_SUMMARY } from "../../../utils/changeSummaryRows";
import { changeSummaryNotice } from "../../../utils/buyerNoticeCopy";
import type { DraftEvent } from "../../../store/draftEventStore";
import type { LiveEvent } from "../../../store/liveEventStore";

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "event-3827-adv",
    serverEventId: "server-event-3827-adv",
    brandId: "brand-1",
    brandSlug: "brand",
    eventSlug: "issue-3827-adv",
    status: "scheduled",
    publishedAt: "2026-06-01T12:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "event",
    name: "Rooftop night",
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
    rsvpCapacity: 50,
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

const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const texts = (tree: Renderer): string[] =>
  tree.root.findAll((node) => (node.type as unknown) === "Text").map((node) => textOf(node));

const mountModal = async (
  diffs: FieldDiff[],
  extra: Partial<React.ComponentProps<typeof ChangeSummaryModal>> = {},
): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ChangeSummaryModal
        visible
        diffs={diffs}
        severity="material"
        onClose={() => undefined}
        onConfirm={() => undefined}
        {...extra}
      />,
    );
  });
  return tree;
};

describe("issue #3827 adversarial — real host text is never swallowed by the JSON guard", () => {
  test.each([
    ["an age-gated name", "name", "[21+] Rooftop night"],
    ["a year-tagged name", "name", "[2026] NYE party"],
    ["a numbered description", "description", "[1] Doors at eight. [2] Bring ID."],
    ["a quoted-brace name", "name", '{"Best"} night in town'],
  ])("TXT-1: %s reads old → new, not 'Changed'", (_label, key, value) => {
    const original = liveEvent();
    const diffs = computeRichFieldDiffs(original, edit(original, { [key]: value } as Partial<DraftEvent>));
    const rows = changeSummaryRows(diffs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBeUndefined();
    expect(rows[0]?.newValue).toBe(value);
  });

  test("TXT-2: plain text that only starts with a bracket word still reads as text", () => {
    const original = liveEvent();
    const rows = changeSummaryRows(
      computeRichFieldDiffs(original, edit(original, { name: "[TBD] Rooftop night" })),
    );
    expect(rows[0]).toMatchObject({ newValue: "[TBD] Rooftop night" });
    expect(rows[0]?.summary).toBeUndefined();
  });
});

describe("issue #3827 adversarial — value edges keep their old → new text", () => {
  test("VAL-1: value → null, null → value, 0, long strings and empty lists", () => {
    const original = liveEvent({ onlineUrl: null });
    const long = "A".repeat(200);
    const diffs = computeRichFieldDiffs(
      original,
      edit(original, {
        venueName: null,
        onlineUrl: "https://example.invalid/stream",
        rsvpCapacity: 0,
        description: long,
        vibeTags: [],
      } as Partial<DraftEvent>),
    );
    const byKey = new Map(changeSummaryRows(diffs).map((d) => [d.fieldKey, d]));
    expect(byKey.get("venueName")).toMatchObject({ oldValue: "Lantern Room", newValue: "(empty)" });
    expect(byKey.get("onlineUrl")).toMatchObject({ oldValue: "(empty)", newValue: "https://example.invalid/stream" });
    if (byKey.has("rsvpCapacity")) {
      expect(byKey.get("rsvpCapacity")).toMatchObject({ oldValue: "50", newValue: "0" });
    }
    const description = byKey.get("description");
    expect(description?.summary).toBeUndefined();
    expect(description?.newValue.endsWith("…")).toBe(true);
    expect(description?.newValue.length).toBeLessThanOrEqual(80);
    expect(byKey.get("vibeTags")).toMatchObject({ oldValue: "social", newValue: "(empty)" });
    for (const row of byKey.values()) {
      expect(`${row.oldValue}${row.newValue}`).not.toMatch(/[{}"]/);
    }
  });

  test("VAL-2: a pin cleared together with the address leaves only the address row", () => {
    const original = liveEvent();
    const diffs = computeRichFieldDiffs(original, edit(original, { address: "", locationGeo: null }));
    expect(diffs.map((d) => d.fieldKey)).toEqual(["address", "locationGeo"]);
    expect(changeSummaryRows(diffs).map((d) => d.fieldKey)).toEqual(["address"]);
  });
});

describe("issue #3827 adversarial — the Notifies decision reads every diff, not the shown rows", () => {
  test("NOTE-1: dropping the pin row does not change the keys or the tagged rows", () => {
    const original = liveEvent();
    const diffs = computeRichFieldDiffs(
      original,
      edit(original, { address: "250 Bedford Avenue, Brooklyn", locationGeo: { lat: 40.7172, lng: -73.9589 } }),
    );
    const input = {
      loggedCopy: "logged",
      entityLabel: "event" as const,
      severity: "material" as const,
      noBuyers: false,
      noun: "guests" as const,
      status: null,
    };
    const fromDiffs = changeSummaryNotice({ ...input, fieldKeys: diffs.map((d) => String(d.fieldKey)) });
    // Same decision as before #3827 (which listed the pin row too).
    expect(diffs.some((d) => d.fieldKey === "locationGeo")).toBe(true);
    const fromAddressOnly = changeSummaryNotice({ ...input, fieldKeys: ["address"] });
    expect(fromDiffs.footer).toBe(fromAddressOnly.footer);
    expect(fromDiffs.footerIsNotice).toBe(fromAddressOnly.footerIsNotice);
    expect([...fromDiffs.taggedKeys].filter((k) => k !== "locationGeo")).toEqual([...fromAddressOnly.taggedKeys]);
    expect(fromDiffs.taggedKeys.has("locationGeo")).toBe(false);
  });

  test("NOTE-2: a pin-only move is still a material diff row (severity unchanged)", () => {
    const original = liveEvent();
    const [row] = computeRichFieldDiffs(original, edit(original, { locationGeo: { lat: 40.69, lng: -73.98 } }));
    expect(row).toMatchObject({ fieldKey: "locationGeo", summary: "Moved" });
    expect(row?.summary).not.toBe(DIFF_CHANGED_SUMMARY);
  });
});

describe("issue #3827 adversarial — the reason gate still holds", () => {
  test("GATE-1: with buyers, Save stays disabled and inert until a 10+ character reason", async () => {
    const original = liveEvent();
    const onConfirm = jest.fn();
    const tree = await mountModal(
      computeRichFieldDiffs(original, edit(original, { locationGeo: { lat: 40.69, lng: -73.98 } })),
      { buyerCount: 3, onConfirm },
    );
    const save = (): TestInstance =>
      tree.root.findAll((n) => (n.type as unknown) === "ButtonProbe" && n.props.label === "Save changes")[0]!;
    expect(save().props.disabled).toBe(true);
    await act(async () => {
      (save().props.onPress as () => void)();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    const input = tree.root.findAll(
      (n) => (n.type as unknown) === "TextInput" && n.props.accessibilityLabel === "Reason for change",
    )[0]!;
    await act(async () => {
      (input.props.onChangeText as (v: string) => void)("short");
    });
    expect(save().props.disabled).toBe(true);
    await act(async () => {
      (input.props.onChangeText as (v: string) => void)("Venue moved due to weather");
    });
    expect(save().props.disabled).toBe(false);
    await act(async () => {
      (save().props.onPress as () => void)();
    });
    expect(onConfirm).toHaveBeenCalledWith("Venue moved due to weather");
    expect(texts(tree)).toEqual(expect.arrayContaining(["Map pin", "Moved"]));
  });
});
