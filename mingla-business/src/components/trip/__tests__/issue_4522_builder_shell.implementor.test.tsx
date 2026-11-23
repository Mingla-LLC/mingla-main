// MINGLA-INVARIANT: I-4522-BUILDER-V2-STEPS | issue #4522 | The 4-step trip builder has exactly four steps, every Publish blocker is a checklist item that names the step to fix it in, the autosave pill tells the truth, and nothing is stored on the server until the host names the trip.
/**
 * Issue #4522 slice 9 — the 4-step shell, the publish checklist, the "Saved"
 * pill, the description field, DISC-0893 and the removed dated example.
 *
 * Pure rules run for real; the screens in `TripBuilderV2Parts.tsx` are compiled
 * and mounted against an explicit module boundary (the #3801 compiled-creator
 * pattern); the wizard and route wiring is pinned by source.
 *
 * Fails on revert: restore the 8-step `STEP_COUNT`/`LAST_STEP`, drop
 * `saveDirtyGroups` from `autosaveCurrentStep`, put the eager `createTripDraft`
 * back on mount, or restore the "— March 2026" placeholder -> red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";
import { describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import {
  AUTOSAVE_DEBOUNCE_MS,
  BUILDER_STEP_COUNT,
  BUILDER_STEP_TITLES,
  autosavePillState,
  autosaveRetryDelayMs,
  buildPublishChecklist,
  builderStepForLegacyStep,
  checklistProgress,
  dayIsFilled,
  dirtySaveGroups,
  firstOpenItem,
  pricingSignature,
  publishUnlockLine,
  builderStepComplete,
  type ChecklistInput,
  type SaveGroup,
} from "../tripBuilderV2Model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRIP_DIR = path.resolve(__dirname, "..");
const read = (rel: string): string => fs.readFileSync(path.join(TRIP_DIR, rel), "utf8");
const readRoot = (rel: string): string =>
  fs.readFileSync(path.resolve(TRIP_DIR, "..", "..", "..", rel), "utf8");

const READY: ChecklistInput = {
  title: "Tulum Yoga Retreat",
  description: "Five days of yoga, cenotes and slow mornings on the Riviera Maya.",
  hasCover: true,
  startAt: "2027-03-12T00:00:00.000Z",
  endAt: "2027-03-16T23:59:59.000Z",
  placesValid: true,
  days: [{ ordinal: 1, title: "Arrive in Tulum", narrative: "", media: [] }],
  packagesOk: true,
  hasPricedPackage: true,
  planOk: true,
  bookingDeadline: null,
  payoutsReady: true,
  invitesReady: true,
};

describe("the four steps", () => {
  test("exactly four, with the spec's titles", () => {
    expect(BUILDER_STEP_COUNT).toBe(4);
    expect(BUILDER_STEP_TITLES).toEqual({
      1: "Trip",
      2: "Itinerary & inclusions",
      3: "Pricing & policy",
      4: "Travelers & publish",
    });
  });

  test("a server refusal on any of today's eight steps lands on one of the four", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(builderStepForLegacyStep)).toEqual([1, 2, 2, 3, 3, 4, 4, 4]);
  });
});

describe("publish checklist", () => {
  test("everything met: no unlock line, nothing to open, full count", () => {
    const items = buildPublishChecklist(READY);
    expect(publishUnlockLine(items)).toBeNull();
    expect(firstOpenItem(items)).toBeNull();
    const { done, total } = checklistProgress(items);
    expect(done).toBe(total);
  });

  test("each missing item names the step that fixes it", () => {
    const cases: Array<[Partial<ChecklistInput>, string, 1 | 2 | 3 | 4]> = [
      [{ title: "  " }, "title", 1],
      [{ description: "too short" }, "description", 1],
      [{ hasCover: false }, "cover", 1],
      [{ startAt: null }, "dates", 1],
      [{ placesValid: false }, "places", 1],
      [{ days: [{ ordinal: 1, title: "Day 1", narrative: "", media: [] }] }, "itinerary", 2],
      [{ hasPricedPackage: false }, "package", 3],
      [{ planOk: false }, "plan", 3],
      [{ bookingDeadline: "2027-03-20T10:00:00.000Z" }, "deadline", 3],
      [{ payoutsReady: false }, "payouts", 4],
      [{ invitesReady: false }, "invites", 4],
    ];
    for (const [patch, key, step] of cases) {
      const items = buildPublishChecklist({ ...READY, ...patch });
      const open = items.filter((i) => !i.done);
      expect(open.map((i) => i.key)).toEqual([key]);
      expect(open[0].step).toBe(step);
    }
  });

  test("the unlock line names what is left, singular and plural", () => {
    expect(publishUnlockLine(buildPublishChecklist({ ...READY, hasCover: false }))).toBe(
      "Publish unlocks when Cover photo is done.",
    );
    expect(
      publishUnlockLine(buildPublishChecklist({ ...READY, hasCover: false, startAt: null })),
    ).toBe("Publish unlocks when Cover photo and Trip dates are done.");
  });

  test("a day is filled by a title, a description or media; the seeded 'Day N' is not", () => {
    expect(dayIsFilled({ ordinal: 2, title: "Day 2", narrative: "", media: [] })).toBe(false);
    expect(dayIsFilled({ ordinal: 2, title: "Cenotes", narrative: "", media: [] })).toBe(true);
    expect(dayIsFilled({ ordinal: 2, title: "Day 2", narrative: "Swim.", media: [] })).toBe(true);
    expect(dayIsFilled({ ordinal: 2, title: "Day 2", narrative: "", media: [{}] })).toBe(true);
  });

  test("a deadline on or after the start is not met; none at all is", () => {
    expect(
      buildPublishChecklist({ ...READY, bookingDeadline: "2027-03-12T00:00:00.000Z" }).find(
        (i) => i.key === "deadline",
      )?.done,
    ).toBe(false);
    expect(
      buildPublishChecklist({ ...READY, bookingDeadline: "2027-03-01T09:00:00.000Z" }).find(
        (i) => i.key === "deadline",
      )?.done,
    ).toBe(true);
  });

  test("Bank connected offers Connect bank, not a jump", () => {
    const bank = buildPublishChecklist({ ...READY, payoutsReady: false }).find(
      (i) => i.key === "payouts",
    );
    expect(bank?.action).toBe("connect_bank");
  });
});

// #4522 S-18 — the step rail ticks only a step that is truly complete.
// FAILS ON REVERT: "Travelers & publish" ticks on a fresh draft (its own
// items, bank and invites, are met by default).
describe("step rail ticks", () => {
  const FRESH: ChecklistInput = {
    ...READY,
    title: "",
    description: "",
    hasCover: false,
    startAt: null,
    endAt: null,
    placesValid: false,
    days: [],
    packagesOk: true,
    hasPricedPackage: false,
  };
  test("a fresh draft ticks nothing", () => {
    const items = buildPublishChecklist(FRESH);
    expect([1, 2, 3, 4].filter((n) => builderStepComplete(items, n as 1 | 2 | 3 | 4))).toEqual([]);
  });
  test("a step ticks when its own items are met; the publish step only when all are", () => {
    const items = buildPublishChecklist({ ...FRESH, title: READY.title, description: READY.description,
      hasCover: true, startAt: READY.startAt, endAt: READY.endAt, placesValid: true });
    expect(builderStepComplete(items, 1)).toBe(true);
    expect(builderStepComplete(items, 4)).toBe(false);
    const all = buildPublishChecklist(READY);
    expect([1, 2, 3, 4].every((n) => builderStepComplete(all, n as 1 | 2 | 3 | 4))).toBe(true);
  });
});

describe("autosave pill", () => {
  const base = { saving: false, pending: false, failed: false, conflict: false, savedAt: null };
  test("states and labels", () => {
    expect(autosavePillState(base).kind).toBe("idle");
    expect(autosavePillState({ ...base, saving: true }).label).toBe("Saving…");
    expect(autosavePillState({ ...base, pending: true }).label).toBe("Saving…");
    expect(autosavePillState({ ...base, savedAt: "2027-01-01T00:00:00Z" }).label).toBe("Saved");
    const failed = autosavePillState({ ...base, failed: true });
    expect(failed.label).toBe("Not saved — retrying");
    expect(failed.retryable).toBe(true);
    expect(autosavePillState({ ...base, conflict: true, failed: true }).retryable).toBe(false);
  });

  test("a failure is never reported as Saved", () => {
    expect(
      autosavePillState({ ...base, failed: true, savedAt: "2027-01-01T00:00:00Z" }).kind,
    ).toBe("error");
  });

  test("debounce and backoff", () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(800);
    expect([0, 1, 2, 3, 10].map(autosaveRetryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000]);
  });
});

describe("save groups", () => {
  const sigs = (over: Partial<Record<SaveGroup, string>> = {}): Record<SaveGroup, string> => ({
    basics: "a",
    days: "b",
    inclusions: "c",
    pricing: "d",
    policy: "e",
    intake: "",
    ...over,
  });
  test("only the group that changed is saved", () => {
    expect(dirtySaveGroups(sigs({ days: "b2" }), sigs(), false)).toEqual(["days"]);
    expect(dirtySaveGroups(sigs(), sigs(), false)).toEqual([]);
    expect(dirtySaveGroups(sigs(), sigs(), true)).toEqual(["intake"]);
  });

  test("adopting a server id after a create is not an edit", () => {
    const draft = (id: string | null) => ({
      currency: "NGN",
      pricingSwitches: null,
      packages: [{ key: "k1", ticketTypeId: id, name: "Shared", priceMajor: "1000" }],
    });
    expect(pricingSignature(draft(null))).toBe(pricingSignature(draft("tt-1")));
    const edited = { ...draft(null), packages: [{ key: "k1", ticketTypeId: null, name: "Shared", priceMajor: "1200" }] };
    expect(pricingSignature(edited)).not.toBe(pricingSignature(draft(null)));
  });
});

// ---------------------------------------------------------------------------
// The screens, compiled and mounted
// ---------------------------------------------------------------------------

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { root: TestInstance; unmount: () => void };
  act: (fn: () => void) => void;
};

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};

function loadParts(): {
  TripBuilderAutosavePill: React.ComponentType<Record<string, unknown>>;
  TripPublishChecklist: React.ComponentType<Record<string, unknown>>;
  TRIP_BUILDER_V2: boolean;
} {
  const source = read("TripBuilderV2Parts.tsx");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const boundary: Record<string, () => unknown> = {
    react: () => React,
    "react-native": () => jest.requireActual("react-native"),
    designSystem: () => designSystem,
    featureFlags: () => ({ isFeatureEnabled: () => true }),
    GlassCard: () => ({ GlassCard: leaf("GlassCard") }),
    Icon: () => ({ Icon: leaf("Icon") }),
    tripBuilderV2Model: () => jest.requireActual("../tripBuilderV2Model"),
  };
  const req = (specifier: string): unknown => {
    const supply = boundary[specifier] ?? boundary[specifier.split("/").pop() as string];
    if (supply === undefined) throw new Error(`Unclassified Parts boundary: ${specifier}`);
    return supply();
  };
  const mod = { exports: {} as never };
  new Function("require", "module", "exports", output)(req, mod, mod.exports);
  return mod.exports;
}

const textOf = (node: TestInstance): string =>
  node
    .findAll((n) => typeof n.type === "string" && n.type === "Text")
    .map((n) => (n.children as unknown[]).filter((c) => typeof c === "string").join(""))
    .join("|");

describe("screens", () => {
  const Parts = loadParts();

  test("the flag is read once and drives TRIP_BUILDER_V2", () => {
    expect(Parts.TRIP_BUILDER_V2).toBe(true);
  });

  test("the pill: failed is tappable and retries now; saved is not a button", () => {
    const onRetry = jest.fn();
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(Parts.TripBuilderAutosavePill, {
          state: { kind: "error", label: "Not saved — retrying", retryable: true },
          onRetry,
        }),
      );
    });
    const retry = tree.root.findAll((n) => n.props.testID === "trip-builder-save-pill-retry");
    expect(retry.length).toBeGreaterThan(0);
    retry[0].props.onPress && (retry[0].props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => {
      tree.unmount();
      tree = TestRenderer.create(
        React.createElement(Parts.TripBuilderAutosavePill, {
          state: { kind: "saved", label: "Saved", retryable: false },
          onRetry,
        }),
      );
    });
    expect(tree.root.findAll((n) => n.props.testID === "trip-builder-save-pill-retry")).toHaveLength(0);
    expect(textOf(tree.root)).toContain("Saved");
  });

  test("the checklist: every open item has a Fix control that jumps to its step; the count and line render", () => {
    const onJump = jest.fn();
    const onBank = jest.fn();
    const items = buildPublishChecklist({ ...READY, hasCover: false, payoutsReady: false });
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(Parts.TripPublishChecklist, { items, onJump, onConnectBank: onBank }),
      );
    });
    const root = tree.root;
    expect(textOf(root)).toContain(`${checklistProgress(items).done} of ${items.length}`);
    expect(textOf(root)).toContain("Publish unlocks when Cover photo and Bank connected are done.");
    const fixCover = root.findAll((n) => n.props.testID === "trip-checklist-fix-cover")[0];
    (fixCover.props.onPress as () => void)();
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ key: "cover", step: 1 }));
    const fixBank = root.findAll((n) => n.props.testID === "trip-checklist-fix-payouts")[0];
    (fixBank.props.onPress as () => void)();
    expect(onBank).toHaveBeenCalledTimes(1);
    // A met item has no Fix control.
    expect(root.findAll((n) => n.props.testID === "trip-checklist-fix-title")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Wiring (source)
// ---------------------------------------------------------------------------

describe("wizard wiring", () => {
  const wizard = read("TripCreatorWizard.tsx");

  test("fails on revert: the builder defaults on while featureFlags keeps its kill switch", () => {
    const flags = readRoot("src/config/featureFlags.ts");
    expect(flags).toContain('tripBuilderV2: readEnvFlag(process.env.EXPO_PUBLIC_FF_TRIP_BUILDER_V2, true)');
  });

  test("one queue: Continue, Back, Close and the background save all go through autosaveCurrentStep -> saveDirtyGroups", () => {
    expect(wizard).toContain("if (V2) await saveDirtyGroups();");
    expect(wizard).toContain("await autosaveCurrentStep();");
    expect(wizard).toContain("AUTOSAVE_DEBOUNCE_MS");
    // No second queue.
    expect(wizard.match(/createTripSaveQueue\(\)/g)?.length).toBe(1);
  });

  test("the 4-step map: stacked bodies and a four-step bound", () => {
    expect(wizard).toContain("const LAST_STEP: number = V2 ? BUILDER_STEP_COUNT : 8;");
    expect(wizard).toContain("itinerary: step === 2,\n        inclusions: step === 2,");
    expect(wizard).toContain("pricing: step === 3,\n        policy: step === 3,");
    expect(wizard).toContain("intake: step === 4,\n        invite: step === 4,\n        review: step === 4,");
  });

  // #4522 S-18 (spec §9.5) — the final Publish is enabled only when the
  // checklist is met, and the line under it says what is left; the top-bar
  // Publish stays tappable and jumps to what is left.
  test("Publish in the builder is disabled until the checklist is met, and says why", () => {
    expect(wizard).toContain("V2\n                      ? submitting || checkingInvitePublish || publishUnlock !== null");
    expect(wizard).toContain("const publishUnlock = V2 ? publishUnlockLine(publishChecklist) : null;");
    expect(wizard).toMatch(/V2 && publishUnlock !== null \? \(\s*<Text style=\{styles\.publishUnlockHint\} testID="trip-wizard-publish-unlock">\s*\{publishUnlock\}/);
    expect(wizard).toContain("handleBuilderPublishTap");
    expect(wizard).toContain("builderStepComplete(publishChecklist, n)");
  });

  test("a package created by an earlier save in the same run is never created twice", () => {
    expect(wizard).toContain("createdTierIdsByKeyRef.current.get(pkg.key)");
    expect(wizard).toContain("createdTierIdsByKeyRef.current.set(pkg.key, created.ticketTypeId)");
  });

  test("the description is saved only by the builder; the 8-step save is unchanged", () => {
    expect(wizard).toMatch(/\.\.\.\(V2\s*\?\s*\{\s*description:/);
  });
});

describe("DISC-0893 and the dated example", () => {
  test("the route does not create a server draft on mount when the builder is on", () => {
    const route = readRoot("app/trip/[id]/edit.tsx");
    expect(route).toContain('const builderV2 = isFeatureEnabled("tripBuilderV2");');
    expect(route).toContain("if (builderV2) return;");
    expect(route).toContain("<TripStartGate");
    expect(route).toContain("startDraft(eventId, title)");
  });

  test("create.tsx no longer carries the narrowed-scope note", () => {
    const create = readRoot("app/trip/create.tsx");
    expect(create).not.toContain("Narrowed-scope note");
    expect(create).toContain("DISC-0893");
  });

  test("the start gate says a failed create, and offers a retry", () => {
    const gate = read("TripStartGate.tsx");
    expect(gate).toContain("TRIP_START_FAILED_MESSAGE");
    expect(gate).toContain('failed ? "Try again"');
    expect(gate).not.toMatch(/catch\s*\(\s*\)?\s*\{\s*\}/);
  });

  test("the dated 'March 2026' title example is gone", () => {
    const step1 = read("TripCreatorStep1Basics.tsx");
    expect(step1).not.toContain("March 2026");
    expect(step1).toContain('placeholder="e.g. Tulum Yoga Retreat"');
  });

  test("the description field only shows in the builder", () => {
    const step1 = read("TripCreatorStep1Basics.tsx");
    expect(step1).toContain("{builderV2 ? (");
    expect(step1).toContain('testID="trip-step1-description"');
  });
});

