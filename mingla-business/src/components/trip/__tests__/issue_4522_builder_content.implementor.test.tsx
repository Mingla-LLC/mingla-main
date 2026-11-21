// MINGLA-INVARIANT: I-4522-BUILDER-V2-CONTENT | issue #4522 | The builder's earnings card, refund chips, deposit rule and question library write only values the platform already defines (pricingPreview fees, the refund policy keys, the intake schema), and no tap in them is dead.
/**
 * Issue #4522 slice 10 — live preview, earnings card, inclusion chips, refund
 * chips + "Deposit is non-refundable", traveler-question library.
 *
 * Pure rules run for real; each screen is compiled and mounted against an
 * explicit module boundary (the #3801 compiled-creator pattern).
 *
 * Fails on revert: change a chip's tier ladder, write `deposit_non_refundable`
 * when the switch is off, invent a fee when the rate is unknown, drop the
 * "apply to all packages" fan-out, or make the preview update later than 300ms
 * -> red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import {
  parseOfferingRefundPolicy,
} from "../../../../../packages/offering-rendering/offeringRefundPolicy";
import { feeFromBps } from "../../../utils/pricingPreview";
import { NO_REFUNDS_POLICY } from "../../../services/refundPolicyModel";
import {
  INCLUSION_CHIPS,
  PREVIEW_UPDATE_DELAY_MS,
  addLibraryQuestion,
  applyRefundChip,
  computeEarningsRows,
  earningsAtFullCapacity,
  inclusionChipOn,
  refundChipOf,
  removeLibraryQuestion,
  toggleInclusionChip,
  withDepositNonRefundable,
  TRAVELER_QUESTION_LIBRARY,
  MAX_INTAKE_QUESTIONS,
} from "../tripBuilderV2Model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TI {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
  findAll: (p: (n: TI) => boolean) => TI[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (n: React.ReactElement) => { root: TI; unmount: () => void };
  act: (fn: () => void) => void;
};
const { act } = TestRenderer;

const TRIP_DIR = path.resolve(__dirname, "..");
const read = (rel: string): string => fs.readFileSync(path.join(TRIP_DIR, rel), "utf8");
const leaf = (name: string) => {
  const L = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  L.displayName = name;
  return L;
};

function compile<T>(file: string, boundary: Record<string, () => unknown>): T {
  const output = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const req = (specifier: string): unknown => {
    const supply = boundary[specifier] ?? boundary[specifier.split("/").pop() as string];
    if (supply === undefined) throw new Error(`Unclassified boundary in ${file}: ${specifier}`);
    return supply();
  };
  const mod = { exports: {} as T };
  new Function("require", "module", "exports", output)(req, mod, mod.exports);
  return mod.exports;
}

const CORE: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  designSystem: () => designSystem,
  tripBuilderV2Model: () => jest.requireActual("../tripBuilderV2Model"),
  Icon: () => ({ Icon: leaf("Icon") }),
  GlassCard: () => ({ GlassCard: leaf("GlassCard") }),
  TripBuilderChip: () => ({ TripBuilderChip: leaf("Chip") }),
  Switch: () => ({ Switch: leaf("SwitchProbe") }),
};

const press = (n: TI): void => (n.props.onPress as () => void)();
const byId = (root: TI, id: string): TI => {
  const hit = root.findAll((n) => n.props.testID === id && typeof n.type === "string");
  if (hit.length === 0) throw new Error(`no element ${id}`);
  return hit[0];
};

// ---------------------------------------------------------------------------
// inclusions
// ---------------------------------------------------------------------------

describe("inclusion chips", () => {
  test("the eight chips, one tap adds, a second removes, others untouched", () => {
    expect(INCLUSION_CHIPS.map((c) => c.label)).toEqual([
      "Flights", "Hotel", "Breakfast", "Airport transfer", "Guide", "Activities", "Insurance", "Dinners",
    ]);
    const own = [{ kind: "included" as const, item: "Daily yoga", ordinal: 0 }];
    const added = toggleInclusionChip(own, "Hotel");
    expect(inclusionChipOn(added, "Hotel")).toBe(true);
    expect(added.find((i) => i.item === "Hotel")?.ordinal).toBe(1);
    expect(toggleInclusionChip(added, "hotel")).toEqual(own);
  });

  test("an excluded item with the same words is not a tick", () => {
    expect(inclusionChipOn([{ kind: "excluded", item: "Flights", ordinal: 0 }], "Flights")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// refunds
// ---------------------------------------------------------------------------

describe("refund chips and the deposit rule", () => {
  test("presets write the ladders the spec names", () => {
    expect(applyRefundChip(null, "full_30").tiers).toEqual([
      { days_before_start: 30, refund_pct: 100 },
      { days_before_start: 0, refund_pct: 0 },
    ]);
    expect(applyRefundChip(null, "half_14").tiers).toEqual([
      { days_before_start: 14, refund_pct: 50 },
      { days_before_start: 0, refund_pct: 0 },
    ]);
    expect(applyRefundChip(null, "none").tiers).toEqual(NO_REFUNDS_POLICY.tiers);
  });

  test("every preset is a policy the server accepts and every buyer surface renders", () => {
    for (const key of ["full_30", "half_14", "none"] as const) {
      expect(parseOfferingRefundPolicy(applyRefundChip(null, key))).not.toBeNull();
    }
  });

  test("a stored policy reads back as its chip; anything else is Custom", () => {
    expect(refundChipOf(null)).toBeNull();
    expect(refundChipOf(applyRefundChip(null, "full_30"))).toBe("full_30");
    expect(refundChipOf(applyRefundChip(null, "half_14"))).toBe("half_14");
    expect(refundChipOf(NO_REFUNDS_POLICY)).toBe("none");
    expect(refundChipOf({ kind: "strict", tiers: [{ days_before_start: 90, refund_pct: 100 }, { days_before_start: 0, refund_pct: 0 }] })).toBe("custom");
  });

  test("the deposit rule is written only when on; off leaves the policy byte-identical", () => {
    const base = applyRefundChip(null, "full_30");
    expect(withDepositNonRefundable(base, true).deposit_non_refundable).toBe(true);
    expect(withDepositNonRefundable(withDepositNonRefundable(base, true), false)).toEqual(base);
    expect("deposit_non_refundable" in withDepositNonRefundable(base, false)).toBe(false);
  });

  test("the deposit rule survives a change of chip", () => {
    const on = withDepositNonRefundable(applyRefundChip(null, "full_30"), true);
    expect(applyRefundChip(on, "half_14").deposit_non_refundable).toBe(true);
  });

  test("the server parser keeps the rule", () => {
    const on = withDepositNonRefundable(applyRefundChip(null, "full_30"), true);
    expect(parseOfferingRefundPolicy(on)?.deposit_non_refundable).toBe(true);
  });

  describe("the section", () => {
    const Section = compile<{ TripRefundPolicySection: React.ComponentType<Record<string, unknown>> }>(
      "TripRefundPolicySection.tsx",
      {
        ...CORE,
        LazyRefundPolicyEditor: () => ({ LazyRefundPolicyEditor: leaf("EditorProbe") }),
        refundPolicyModel: () => jest.requireActual("../../../services/refundPolicyModel"),
      },
    ).TripRefundPolicySection;

    const mount = (value: unknown, onChange: (n: unknown) => void) => {
      let t!: ReturnType<typeof TestRenderer.create>;
      act(() => {
        t = TestRenderer.create(React.createElement(Section, { value, onChange }));
      });
      return t;
    };

    test("tapping No refunds writes the one 0% tier; Custom opens the editor and writes nothing", () => {
      const onChange = jest.fn();
      const t = mount(null, onChange);
      act(() => press(byId(t.root, "trip-refund-chip-none")));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tiers: NO_REFUNDS_POLICY.tiers }));
      onChange.mockClear();
      expect(t.root.findAll((n) => n.type === "EditorProbe")).toHaveLength(0);
      act(() => press(byId(t.root, "trip-refund-chip-custom")));
      expect(t.root.findAll((n) => n.type === "EditorProbe")).toHaveLength(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("the switch is off and disabled until a refund option exists, then writes the rule", () => {
      const onChange = jest.fn();
      const none = mount(null, onChange);
      expect(byId(none.root, "trip-deposit-non-refundable").props.disabled).toBe(true);
      const t = mount(applyRefundChip(null, "full_30"), onChange);
      const sw = byId(t.root, "trip-deposit-non-refundable");
      expect(sw.props.value).toBe(false);
      (sw.props.onValueChange as (v: boolean) => void)(true);
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ deposit_non_refundable: true }));
    });

    test("an edit in the full editor keeps the deposit rule", () => {
      const onChange = jest.fn();
      const t = mount(withDepositNonRefundable(applyRefundChip(null, "full_30"), true), onChange);
      act(() => press(byId(t.root, "trip-refund-chip-custom")));
      const editor = t.root.findAll((n) => n.type === "EditorProbe")[0];
      (editor.props.onChange as (p: unknown) => void)({ kind: "custom", tiers: [{ days_before_start: 7, refund_pct: 100 }, { days_before_start: 0, refund_pct: 0 }] });
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ deposit_non_refundable: true }));
    });
  });
});

// ---------------------------------------------------------------------------
// earnings
// ---------------------------------------------------------------------------

describe("earnings card numbers (pricingPreview, never invented)", () => {
  const switches = (covers: boolean) => ({ passTax: false, passMinglaFee: covers, passServiceFee: covers });
  const price = 150_000; // 1,500.00 in minor units

  test("SC-17: a 150 bps brand that absorbs the fee pays take + the 3% service fee", () => {
    const rows = computeEarningsRows({ priceMinor: price, takeRateBps: 150, switches: switches(false) });
    expect(rows?.feeMinor).toBe(feeFromBps(price, 150) + feeFromBps(price, 300));
    expect(rows?.feeMinor).toBe(feeFromBps(price, 150 + 300));
    expect(rows?.receiveMinor).toBe(price - feeFromBps(price, 450));
    expect(rows?.feePassedMinor).toBe(0);
  });

  test("when the buyer covers the fees the host receives the price", () => {
    const rows = computeEarningsRows({ priceMinor: price, takeRateBps: 150, switches: switches(true) });
    expect(rows?.receiveMinor).toBe(price);
    expect(rows?.feeMinor).toBe(0);
    expect(rows?.feePassedMinor).toBe(feeFromBps(price, 450));
  });

  test("an unreadable brand rate yields no rows at all", () => {
    expect(computeEarningsRows({ priceMinor: price, takeRateBps: null, switches: switches(false) })).toBeNull();
    expect(earningsAtFullCapacity([{ priceMinor: price, spots: 4 }], { takeRateBps: null, switches: switches(false) })).toBeNull();
  });

  test("Nigeria shows VAT from the configured rate; no rate, no row", () => {
    expect(computeEarningsRows({ priceMinor: price, takeRateBps: 150, switches: switches(false), vatRateBps: 750 })?.vatMinor).toBe(feeFromBps(price, 750));
    expect(computeEarningsRows({ priceMinor: price, takeRateBps: 150, switches: switches(false) })?.vatMinor).toBeNull();
  });

  test("at capacity: each package at its own price, packages without spots left out", () => {
    const base = { takeRateBps: 150, switches: switches(false) };
    const a = computeEarningsRows({ ...base, priceMinor: 100_000 })!.receiveMinor;
    const b = computeEarningsRows({ ...base, priceMinor: 250_000 })!.receiveMinor;
    expect(
      earningsAtFullCapacity(
        [{ priceMinor: 100_000, spots: 4 }, { priceMinor: 250_000, spots: 2 }, { priceMinor: 90_000, spots: null }],
        base,
      ),
    ).toEqual({ spots: 6, receiveMinor: a * 4 + b * 2 });
  });
});

// ---------------------------------------------------------------------------
// question library
// ---------------------------------------------------------------------------

describe("traveler question library", () => {
  let n = 0;
  const deps = {
    emptySchema: () => ({ schema_version_id: "v0", questions: [] as never[] }),
    makeId: () => `q-${++n}`,
    bump: (s: { schema_version_id: string; questions: never[] }) => ({ ...s, schema_version_id: `v${++n}` }),
  };
  const lib = (key: string) => TRAVELER_QUESTION_LIBRARY.find((q) => q.key === key)!;

  test("the nine questions of the spec", () => {
    expect(TRAVELER_QUESTION_LIBRARY.map((q) => q.label)).toEqual([
      "Name as on passport", "Date of birth", "Nationality", "Passport number", "Passport expiry",
      "Dietary needs", "Medical notes", "Emergency contact", "T-shirt size",
    ]);
  });

  test("adds in the intake shape, in order, with choices for sizes", () => {
    const one = addLibraryQuestion(null, lib("dob"), deps as never)!;
    expect(one.questions).toMatchObject([{ label: "Date of birth", type: "date", required: true, position: 0 }]);
    const two = addLibraryQuestion(one, lib("tshirt"), deps as never)!;
    expect(two.questions[1]).toMatchObject({ type: "single_choice", position: 1 });
    expect(two.questions[1].options?.length).toBeGreaterThan(1);
    expect(two.schema_version_id).not.toBe(one.schema_version_id);
  });

  test("never adds twice, never past the form limit", () => {
    const one = addLibraryQuestion(null, lib("dob"), deps as never)!;
    expect(addLibraryQuestion(one, lib("dob"), deps as never)).toBeNull();
    const full = { ...one, questions: Array.from({ length: MAX_INTAKE_QUESTIONS }, (_, i) => ({ ...one.questions[0], id: `x${i}`, label: `Q${i}`, position: i })) };
    expect(addLibraryQuestion(full as never, lib("nationality"), deps as never)).toBeNull();
  });

  test("removing renumbers; removing the last clears the form", () => {
    let s = addLibraryQuestion(null, lib("dob"), deps as never)!;
    s = addLibraryQuestion(s, lib("nationality"), deps as never)!;
    const without = removeLibraryQuestion(s, "Date of birth", deps.bump as never)!;
    expect(without.questions.map((q) => [q.label, q.position])).toEqual([["Nationality", 0]]);
    expect(removeLibraryQuestion(without, "Nationality", deps.bump as never)).toBeNull();
  });

  describe("the section", () => {
    let counter = 0;
    const Library = compile<{ TripQuestionLibrary: React.ComponentType<Record<string, unknown>> }>(
      "TripQuestionLibrary.tsx",
      {
        ...CORE,
        intakeSchemaService: () => ({
          createEmptyIntakeSchema: () => ({ schema_version_id: "v0", questions: [] }),
          bumpSchemaVersion: (s: object) => ({ ...s, schema_version_id: `bumped-${++counter}` }),
          createBlankQuestion: () => ({ id: `id-${++counter}` }),
        }),
        tripsService: () => ({}),
      },
    ).TripQuestionLibrary;
    const tiers = [
      { ticketTypeId: "t1", tierName: "Shared" },
      { ticketTypeId: "t2", tierName: "Private" },
    ];
    const mount = (props: Record<string, unknown>) => {
      let t!: ReturnType<typeof TestRenderer.create>;
      act(() => {
        t = TestRenderer.create(React.createElement(Library, props));
      });
      return t;
    };

    test("Apply to all packages: one tap writes the question to every package in the same pass", () => {
      const onSchemaChange = jest.fn();
      const t = mount({ tiers, unsavedPackageCount: 0, schemasByTier: new Map(), onSchemaChange, onNotice: jest.fn() });
      act(() => press(byId(t.root, "trip-question-chip-dob")));
      expect(onSchemaChange).toHaveBeenCalledTimes(2);
      expect(onSchemaChange.mock.calls.map((c) => c[0])).toEqual(["t1", "t2"]);
      expect((onSchemaChange.mock.calls[0][1] as { questions: { label: string }[] }).questions[0].label).toBe("Date of birth");
    });

    test("switched off, only the chosen package gets it", () => {
      const onSchemaChange = jest.fn();
      const t = mount({ tiers, unsavedPackageCount: 0, schemasByTier: new Map(), onSchemaChange, onNotice: jest.fn() });
      act(() => (byId(t.root, "trip-question-apply-all").props.onValueChange as (v: boolean) => void)(false));
      act(() => press(byId(t.root, "trip-question-target-t2")));
      act(() => press(byId(t.root, "trip-question-chip-nationality")));
      expect(onSchemaChange).toHaveBeenCalledTimes(1);
      expect(onSchemaChange.mock.calls[0][0]).toBe("t2");
    });

    test("a chip already on is not dead: the tap removes it everywhere", () => {
      const onSchemaChange = jest.fn();
      const withQ = { schema_version_id: "v1", questions: [{ id: "a", type: "date", label: "Date of birth", required: true, position: 0 }] };
      const t = mount({ tiers, unsavedPackageCount: 0, schemasByTier: new Map([["t1", withQ], ["t2", withQ]]), onSchemaChange, onNotice: jest.fn() });
      expect(byId(t.root, "trip-question-chip-dob").props.selected).toBe(true);
      act(() => press(byId(t.root, "trip-question-chip-dob")));
      expect(onSchemaChange.mock.calls.map((c) => [c[0], c[1]])).toEqual([["t1", null], ["t2", null]]);
    });

    test("a full form says so out loud", () => {
      const onNotice = jest.fn();
      const full = { schema_version_id: "v1", questions: Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, type: "short_text", label: `Q${i}`, required: false, position: i })) };
      const t = mount({ tiers: [tiers[0]], unsavedPackageCount: 0, schemasByTier: new Map([["t1", full]]), onSchemaChange: jest.fn(), onNotice });
      act(() => press(byId(t.root, "trip-question-chip-dob")));
      expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("20 questions"));
    });

    test("an unsaved package is named, not hidden; no package yet explains why", () => {
      const t = mount({ tiers, unsavedPackageCount: 1, schemasByTier: new Map(), onSchemaChange: jest.fn(), onNotice: jest.fn() });
      expect(byId(t.root, "trip-question-unsaved-note")).toBeDefined();
      const empty = mount({ tiers: [], unsavedPackageCount: 0, schemasByTier: new Map(), onSchemaChange: jest.fn(), onNotice: jest.fn() });
      expect(byId(empty.root, "trip-question-library-empty")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

describe("live preview", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const Preview = compile<{
    TripLivePreview: React.ComponentType<Record<string, unknown>>;
    TripPreviewPeek: React.ComponentType<Record<string, unknown>>;
  }>("TripBuilderPreview.tsx", {
    ...CORE,
    useBrands: () => ({ useBrand: () => ({ data: { theme: null } }) }),
    themeResolver: () => ({ resolveTheme: () => ({ font: "x" }) }),
    currency: () => ({ formatCurrency: (v: number, c: string) => `${c} ${v / 100}` }),
    LazyPublicParts: () => ({ TripPreview: leaf("TripPreviewProbe") }),
    tripsService: () => ({}),
  });

  const trip = (title: string): Record<string, unknown> => ({
    id: "t", brandId: "b", title, coverMediaUrl: "https://x/c.jpg", coverMediaType: "image",
  });
  const brand = { id: "b", slug: "b", name: "B" };
  const shownTitle = (root: TI): unknown =>
    (root.findAll((n) => n.type === "TripPreviewProbe")[0].props.trip as { title: string }).title;

  test("the preview follows the draft within 300ms, not before", () => {
    expect(PREVIEW_UPDATE_DELAY_MS).toBe(300);
    const Host: React.FC<{ title: string }> = ({ title }) =>
      React.createElement(Preview.TripLivePreview, { trip: trip(title), brand, themeOverrides: null });
    let setTitle!: (s: string) => void;
    const Stateful: React.FC = () => {
      const [title, set] = React.useState("Old");
      setTitle = set;
      return React.createElement(Host, { title });
    };
    let t!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      t = TestRenderer.create(React.createElement(Stateful));
    });
    act(() => {
      jest.advanceTimersByTime(PREVIEW_UPDATE_DELAY_MS);
    });
    act(() => setTitle("New"));
    act(() => {
      jest.advanceTimersByTime(PREVIEW_UPDATE_DELAY_MS - 1);
    });
    expect(shownTitle(t.root)).toBe("Old");
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(shownTitle(t.root)).toBe("New");
  });

  test("the preview is read-only", () => {
    let t!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      t = TestRenderer.create(React.createElement(Preview.TripLivePreview, { trip: trip("T"), brand, themeOverrides: null }));
    });
    const probe = t.root.findAll((n) => n.type === "TripPreviewProbe")[0];
    expect(probe.props.showCta).toBe(false);
  });

  test("the peek bar shows the cover and price; a tap opens the preview and Close returns", () => {
    let t!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      t = TestRenderer.create(
        React.createElement(Preview.TripPreviewPeek, { trip: trip("Tulum"), brand, themeOverrides: null, fromPriceMinor: 150000, currency: "NGN" }),
      );
    });
    expect(t.root.findAll((n) => n.props.testID === "trip-preview-peek-open")).toHaveLength(0);
    const bar = byId(t.root, "trip-preview-peek");
    expect(JSON.stringify(bar.props.style)).toContain("88");
    const texts = t.root.findAll((n) => n.type === "Text").map((n) => (n.children as unknown[]).join(""));
    expect(texts.join("|")).toContain("From NGN 1500");
    act(() => press(bar));
    expect(byId(t.root, "trip-preview-peek-open")).toBeDefined();
    act(() => press(byId(t.root, "trip-preview-peek-close")));
    expect(t.root.findAll((n) => n.props.testID === "trip-preview-peek-open")).toHaveLength(0);
  });

  test("a drag up on the bar opens the preview; no price means no price text", () => {
    let t!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      t = TestRenderer.create(
        React.createElement(Preview.TripPreviewPeek, { trip: trip(""), brand, themeOverrides: null, fromPriceMinor: null, currency: "NGN" }),
      );
    });
    const bar = byId(t.root, "trip-preview-peek");
    act(() => {
      (bar.props.onTouchStart as (e: unknown) => void)({ nativeEvent: { pageY: 600 } });
      (bar.props.onTouchEnd as (e: unknown) => void)({ nativeEvent: { pageY: 520 } });
    });
    expect(byId(t.root, "trip-preview-peek-open")).toBeDefined();
    const texts = t.root.findAll((n) => n.type === "Text").map((n) => (n.children as unknown[]).join("")).join("|");
    expect(texts).not.toContain("From ");
  });
});

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

describe("wiring", () => {
  const wizard = read("TripCreatorWizard.tsx");
  test("each piece is mounted in its step, behind the flag", () => {
    expect(wizard).toContain("{V2 && shows.inclusions ? (\n            <TripInclusionChips");
    expect(wizard).toContain("{V2 && shows.policy ? <TripEarningsCard draft={step4Draft} /> : null}");
    expect(wizard).toContain("{V2 && shows.intake ? (\n            <TripQuestionLibrary");
    expect(wizard).toContain("showPreviewPane");
    expect(wizard).toContain("PREVIEW_PANE_MIN_WIDTH");
    expect(wizard).toContain("<TripPreviewPeek");
  });

  test("the library and the schema builder share one writer", () => {
    expect(wizard).toContain("onSchemaChange={handleIntakeSchemaChange}");
    expect(wizard.match(/onSchemaChange=\{handleIntakeSchemaChange\}/g)?.length).toBe(2);
  });

  test("the refund chips replace the editor card only in the builder", () => {
    const policy = read("TripCreatorStep5Policy.tsx");
    expect(policy).toContain("{builderV2 ? (\n          <TripRefundPolicySection");
    expect(policy).toContain("<RefundPolicyEditor");
  });

  test("the earnings card reads the brand's real rate and the shared switches, with no invented default", () => {
    const card = read("TripEarningsCard.tsx");
    expect(card).toContain("brand.takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS");
    expect(card).toContain("resolveSwitches(");
    expect(card).toContain("EARNINGS_LOADING_COPY");
    expect(card).not.toMatch(/\b(450|0\.045|4\.5)\b/);
  });

  test("no orange on the builder's new surfaces (accent is for Create and progress)", () => {
    for (const f of [
      "TripBuilderChip.tsx", "TripInclusionChips.tsx", "TripRefundPolicySection.tsx", "TripEarningsCard.tsx",
      "TripQuestionLibrary.tsx", "TripBuilderPreview.tsx", "TripBuilderV2Parts.tsx", "TripStartGate.tsx",
    ]) {
      expect(read(f)).not.toMatch(/color\.accent/);
    }
  });
});
