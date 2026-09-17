/**
 * RSVP Step 5 turnout card — advice cut mid-word, and a forecast "of 1".
 *
 * Found filming the RSVP tutorial on the iOS simulator. The card read:
 *   "Clarify Venue Capacity · Essential for any turnout; prevents event
 *    cancellation due to capacity misunderstanding and allows for realistic
 *    plannin"
 * The lift note is exactly 120 characters: growth-tools-events stored it with a
 * bare `.slice(0, 120)`. The engine now clips on a word boundary with "…"
 * (needs an edge deploy); reports already saved or cached still carry the old
 * cut, so the app repairs them for display.
 *
 * Mounts the REAL ambient card (TurnoutForecastCardContent), the full report
 * (EventsReportSections) and the Preview gate (TurnoutGateSection).
 *
 * Fails on revert: drop `repairCappedTurnoutCopy` from either surface and
 * "realistic plannin" renders again; restore `capacity < 1` and a one-seat
 * guest limit builds a forecast input.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import { buildDraftEvent } from "../../../store/draftEventStore";
import type { TurnoutReport } from "../../../types/growthTools";
import {
  repairCappedTurnoutCopy,
  TURNOUT_FIX_COPY_CAPS,
} from "../../../utils/turnoutDisplayCopy";
import {
  buildTurnoutInput,
  MIN_FORECAST_CAPACITY,
} from "../../../utils/turnoutInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The exact 120-character string the stored report carried.
const SHIPPED_LIFT_NOTE =
  "Essential for any turnout; prevents event cancellation due to capacity misunderstanding and allows for realistic plannin";

const storedReport = (): TurnoutReport =>
  ({
    forecast: { total_low: 25, total_high: 45, capacity: 80, confidence: "medium" },
    factors: [],
    fixes: [
      {
        title: "Clarify Venue Capacity",
        why: "Guests plan around it",
        change: "Set a guest limit",
        lift_note: SHIPPED_LIFT_NOTE,
      },
    ],
    meta: { research_source: "grounded", generated_at: "2026-09-14T10:00:00.000Z" },
  }) as unknown as TurnoutReport;

const mockIntel: Record<string, unknown> = {};
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  const identity = (t: number): number => t;
  return { ...actual, Easing: { out: () => identity, cubic: identity, quad: identity } };
});
jest.mock("../TurnoutIntelContext", () => ({
  useTurnoutIntel: () => mockIntel,
}));
jest.mock("../../ui/Button", () => ({
  Button: ({ label }: { label: string }) => React.createElement("Button", null, label),
}));
jest.mock("../IntelProgress", () => ({
  IntelProgress: () => React.createElement("Progress"),
  INTEL_RESULT_MIN_HEIGHT: 0,
}));
jest.mock("../IntelCard", () => ({
  IntelCard: ({ children }: { children: React.ReactNode }) =>
    React.createElement("IntelCard", null, children),
}));
jest.mock("../IntelDriverChip", () => ({
  IntelDriverChip: ({ label }: { label: string }) => React.createElement("Chip", null, label),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => React.createElement("Icon") }));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

// eslint-disable-next-line import/first
import { EventsReportSections } from "../EventsReportSections";
// eslint-disable-next-line import/first
import { TurnoutForecastCardContent } from "../TurnoutForecastCardContent";
// eslint-disable-next-line import/first
import { TurnoutGateSection } from "../TurnoutGateSection";

type Tree = { toJSON: () => unknown; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => Tree;
};

const texts = (node: unknown, out: string[] = []): string[] => {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((child) => texts(child, out));
    return out;
  }
  const host = node as { children?: unknown[] | null };
  const children = host.children ?? [];
  const own = children
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join("");
  if (own.length > 0) out.push(own);
  children.forEach((child) => texts(child, out));
  return out;
};

const shown = (node: React.ReactElement): string[] => {
  let tree: Tree | null = null;
  act(() => {
    tree = create(node);
  });
  const out = texts((tree as unknown as Tree).toJSON());
  act(() => (tree as unknown as Tree).unmount());
  return out;
};

const resetIntel = (patch: Record<string, unknown>): void => {
  for (const key of Object.keys(mockIntel)) delete mockIntel[key];
  Object.assign(mockIntel, {
    wizard: "rsvp",
    state: "result",
    report: storedReport(),
    input: { currency: "USD" },
    inputKey: "k",
    blockReason: null,
    fresh: true,
    run: jest.fn(),
    openReport: jest.fn(),
    ...patch,
  });
};

describe("turnout advice is never shown cut mid-word", () => {
  test("repairCappedTurnoutCopy backs a capped cut up to a whole word", () => {
    const repaired = repairCappedTurnoutCopy(
      SHIPPED_LIFT_NOTE,
      TURNOUT_FIX_COPY_CAPS.lift_note,
    );
    expect(repaired).toBe(
      "Essential for any turnout; prevents event cancellation due to capacity misunderstanding and allows for realistic…",
    );
    // Shorter than the cap = exactly what the engine wrote.
    expect(repairCappedTurnoutCopy("+120 people", 120)).toBe("+120 people");
    // The current engine already ended it; a finished sentence is left alone.
    expect(repairCappedTurnoutCopy(`${"a ".repeat(59)}b…`, 120)).toBe(`${"a ".repeat(59)}b…`);
    expect(repairCappedTurnoutCopy(`${"word ".repeat(23)}done.`, 120)).toBe(`${"word ".repeat(23)}done.`);
  });

  test("ambient card shows the repaired advice, never 'plannin'", () => {
    resetIntel({});
    const out = shown(<TurnoutForecastCardContent surface="rsvp_setup" />).join("\n");
    expect(out).toContain("Clarify Venue Capacity · Essential for any turnout;");
    expect(out).toContain("allows for realistic…");
    expect(out).not.toMatch(/plannin(?!g)/);
  });

  test("full report shows the repaired advice too", () => {
    const out = shown(<EventsReportSections report={storedReport()} />).join("\n");
    expect(out).toContain("allows for realistic…");
    expect(out).not.toMatch(/plannin(?!g)/);
  });
});

describe("a one-seat guest limit is not a forecast", () => {
  const draft = () => ({
    ...buildDraftEvent("brand-1", "draft-1", "2026-09-01T00:00:00.000Z"),
    name: "Neighbors Night on Wythe",
    partyTypes: ["networking-event"],
    city: "Brooklyn",
    venueName: "Lantern Room",
    date: (() => {
      const d = new Date();
      d.setDate(d.getDate() + 11);
      return d.toISOString().slice(0, 10);
    })(),
    isRsvp: true,
  });

  test("RSVP Max guests 1 (the toggle's seed) → missing_capacity; 2 → eligible", () => {
    expect(MIN_FORECAST_CAPACITY).toBe(2);
    expect(
      buildTurnoutInput({
        kind: "rsvp",
        draft: { ...draft(), rsvpCapacity: 1 },
        brandDefaultCurrency: "USD",
      }),
    ).toEqual({ ok: false, reason: "missing_capacity" });
    expect(
      buildTurnoutInput({
        kind: "rsvp",
        draft: { ...draft(), rsvpCapacity: 2 },
        brandDefaultCurrency: "USD",
      }),
    ).toMatchObject({ ok: true, input: { capacity: 2 } });
  });

  test("the same floor holds for ticketed events and experiences", () => {
    const base = draft();
    const oneSeatEvent = buildTurnoutInput({
      kind: "event",
      draft: {
        ...base,
        isRsvp: false,
        tickets: [
          {
            id: "t1",
            name: "GA",
            priceGbp: 10,
            capacity: 1,
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
          },
        ],
      },
      brandDefaultCurrency: "USD",
    });
    expect(oneSeatEvent).toEqual({ ok: false, reason: "missing_capacity" });
  });

  test("Preview gate tells an RSVP host what to change", () => {
    resetIntel({ report: null, state: "idle", blockReason: "missing_capacity", inputKey: null });
    const out = shown(<TurnoutGateSection />).join("\n");
    expect(out).toContain("Set a guest limit above 1 to check turnout.");
  });
});
