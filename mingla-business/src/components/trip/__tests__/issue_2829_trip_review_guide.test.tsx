/**
 * Issue #2829 (amendment A9) — the trip creator's Review step shows the
 * "Before you go" guide exactly as it will be published with the trip.
 *
 * Proves: the guide sections (highlights, group size + activity, what to
 * prepare, good to know, every question WITH its answer open) render from the
 * saved guide, shaped by the same `toTripOfferingGuide` the public trip page
 * uses; no guide → a plain note pointing to step 3 (nothing invented); loading
 * and load-error states with a working retry; and the Review step mounts the
 * sections for the trip being reviewed.
 *
 * The REAL component source is compiled and mounted against an explicit
 * module boundary (the #3801 pattern); the data hook is a fake.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => void) => void;
};
const { act } = TestRenderer;

const SECTIONS_FILE = path.resolve(__dirname, "..", "TripGuideReviewSections.tsx");
const REVIEW_FILE = path.resolve(__dirname, "..", "TripCreatorStep5Review.tsx");

type QueryState = { isLoading: boolean; isError: boolean; data: unknown; refetch: () => Promise<unknown> };
const hook: { query: QueryState; calledWith: unknown[] } = {
  query: { isLoading: false, isError: false, data: null, refetch: async () => undefined },
  calledWith: [],
};

function loadSections(): React.ComponentType<Record<string, unknown>> {
  const output = ts.transpileModule(fs.readFileSync(SECTIONS_FILE, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const boundary: Record<string, () => unknown> = {
    react: () => React,
    "react-native": () => jest.requireActual("react-native"),
    "@mingla/offering-rendering/tripGuide": () => jest.requireActual("@mingla/offering-rendering/tripGuide"),
    "../../constants/designSystem": () => designSystem,
    "../../hooks/useTripGuide": () => ({
      useTripGuideForEditor: (eventId: unknown) => {
        hook.calledWith.push(eventId);
        return hook.query;
      },
    }),
  };
  const req = (specifier: string): unknown => {
    const supply = boundary[specifier];
    if (supply === undefined) throw new Error(`Unclassified TripGuideReviewSections boundary: ${specifier}`);
    return supply();
  };
  const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> };
  new Function("require", "module", "exports", output)(req, module, module.exports);
  return module.exports.TripGuideReviewSections;
}

const Sections = loadSections();

function mount(capacity: number | null = 16): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Sections, { eventId: "trip-1", capacity }));
  });
  return renderer as unknown as Renderer;
}

const has = (r: Renderer, id: string): boolean => r.root.findAll((node) => node.props.testID === id).length > 0;
const text = (r: Renderer): string => JSON.stringify(r.toJSON());

describe("#2829 the Review step shows the trip guide that will be published", () => {
  test("renders every guide section, with each answer open", () => {
    hook.query = {
      isLoading: false, isError: false, refetch: async () => undefined,
      data: {
        highlights: ["Sunrise hike", "Night market"],
        what_to_prepare: "Good boots.",
        good_to_know: "Cash is useful.",
        faqs: [{ question: "Visa?", answer: "Not needed for most passports." }, { question: "Insurance?", answer: "Required." }],
        group_minimum: 6,
        activity_level: "moderate",
      },
    };
    const r = mount(16);
    expect(hook.calledWith.at(-1)).toBe("trip-1");
    for (const id of ["highlights", "group", "prepare", "good-to-know", "faqs"]) {
      expect(has(r, `trip-review-guide-${id}`)).toBe(true);
    }
    const shown = text(r);
    for (const words of ["Sunrise hike", "Night market", "Group size 6–16", "Moderate activity", "Good boots.", "Cash is useful.", "Visa?", "Not needed for most passports.", "Insurance?", "Required."]) {
      expect(shown).toContain(words);
    }
    expect(shown).toContain("Published with your trip");
  });

  test("leaves out what the host did not fill in, and never guesses a group size", () => {
    hook.query = { isLoading: false, isError: false, refetch: async () => undefined, data: { highlights: [], what_to_prepare: "Boots.", good_to_know: null, faqs: [], group_minimum: null, activity_level: null } };
    const r = mount(null);
    expect(has(r, "trip-review-guide-prepare")).toBe(true);
    for (const id of ["highlights", "group", "good-to-know", "faqs"]) {
      expect(has(r, `trip-review-guide-${id}`)).toBe(false);
    }
  });

  test("says plainly when there is no guide yet", () => {
    hook.query = { isLoading: false, isError: false, refetch: async () => undefined, data: null };
    const r = mount();
    expect(has(r, "trip-review-guide-empty")).toBe(true);
    expect(text(r)).toContain("No trip guide yet");
  });

  test("shows loading, then a load error with a retry that refetches", () => {
    hook.query = { isLoading: true, isError: false, data: undefined, refetch: async () => undefined };
    expect(has(mount(), "trip-review-guide-loading")).toBe(true);
    const refetch = jest.fn(async () => undefined);
    hook.query = { isLoading: false, isError: true, data: undefined, refetch };
    const failed = mount();
    expect(text(failed)).toContain("The trip guide could not be loaded");
    const retry = failed.root.findAll((node) => node.props.testID === "trip-review-guide-retry" && typeof node.props.onPress === "function")[0]!;
    act(() => (retry.props.onPress as () => void)());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("the Review step mounts the guide for the trip being reviewed", () => {
    const review = fs.readFileSync(REVIEW_FILE, "utf8");
    expect(review).toContain('import { TripGuideReviewSections } from "./TripGuideReviewSections";');
    expect(review).toMatch(/<TripGuideReviewSections eventId=\{trip\.id\} capacity=\{trip\.businessTrip\.capacity \?\? null\} \/>/);
  });
});
