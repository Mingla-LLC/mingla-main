/**
 * Issue #2829 W4 — the "Before you go" trip guide editor (TripGuideEditor),
 * mounted in the trip creator's inclusions step and the published-trip editor.
 *
 * Proves: loading and load-error states (with a working retry); the stored
 * guide seeds the form; adding a highlight and a question then saving sends
 * exactly the cleaned payload through `useSaveTripGuide`; a half-filled
 * question blocks the save with a plain reason (never a refused save); a
 * refused save shows Mingla's reason in plain words; nothing is a dead tap.
 * Also: the creator step and the published-trip editor both pass the trip id
 * so the editor mounts in both flows.
 *
 * The REAL component source is compiled and mounted against an explicit
 * module boundary (the #3801 pattern); the data hooks are fakes.
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
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => void) => void;
};
const { act } = TestRenderer;

const EDITOR_FILE = path.resolve(__dirname, "..", "TripGuideEditor.tsx");

type QueryState = { isLoading: boolean; isError: boolean; isSuccess: boolean; data: unknown; refetch: () => Promise<unknown> };
type Mutation = { isPending: boolean; mutate: (input: unknown, handlers: { onSuccess?: (v: unknown) => void; onError?: (e: unknown) => void }) => void };

const hooks = {
  query: { isLoading: false, isError: false, isSuccess: true, data: null, refetch: async () => undefined } as QueryState,
  mutation: { isPending: false, mutate: () => undefined } as Mutation,
};

const Icon = (): null => null;

function loadEditor(): React.ComponentType<Record<string, unknown>> {
  const output = ts.transpileModule(fs.readFileSync(EDITOR_FILE, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const boundary: Record<string, () => unknown> = {
    react: () => React,
    "react-native": () => jest.requireActual("react-native"),
    "@mingla/offering-rendering/tripGuide": () => jest.requireActual("@mingla/offering-rendering/tripGuide"),
    "../../constants/designSystem": () => designSystem,
    "../../hooks/useTripGuide": () => ({
      useTripGuideForEditor: () => hooks.query,
      useSaveTripGuide: () => hooks.mutation,
      tripGuideSaveErrorMessage: (error: unknown) =>
        String(error).includes("insufficient_event_permission")
          ? "Only event managers, admins and owners can edit the trip guide."
          : "The trip guide could not be saved. Check your connection and try again.",
    }),
    "../ui/Icon": () => ({ Icon }),
  };
  const req = (specifier: string): unknown => {
    const supply = boundary[specifier];
    if (supply === undefined) throw new Error(`Unclassified TripGuideEditor boundary: ${specifier}`);
    return supply();
  };
  const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> };
  new Function("require", "module", "exports", output)(req, module, module.exports);
  return module.exports.TripGuideEditor;
}

const Editor = loadEditor();

function mount(): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Editor, { eventId: "trip-1" }));
  });
  return renderer as unknown as Renderer;
}

const byId = (r: Renderer, id: string): TestInstance =>
  r.root.findAll((node) => node.props.testID === id && typeof node.type !== "string")[0] ??
  r.root.findAll((node) => node.props.testID === id)[0]!;
const has = (r: Renderer, id: string): boolean => r.root.findAll((node) => node.props.testID === id).length > 0;
const text = (r: Renderer): string => JSON.stringify(r.toJSON());

describe("#2829 TripGuideEditor", () => {
  test("shows loading, then a load error with a retry that refetches", () => {
    hooks.query = { isLoading: true, isError: false, isSuccess: false, data: undefined, refetch: async () => undefined };
    const loading = mount();
    expect(has(loading, "trip-guide-editor-loading")).toBe(true);
    const refetch = jest.fn(async () => undefined);
    hooks.query = { isLoading: false, isError: true, isSuccess: false, data: undefined, refetch };
    const failed = mount();
    expect(text(failed)).toContain("The trip guide could not be loaded");
    act(() => (byId(failed, "trip-guide-editor-retry").props.onPress as () => void)());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("seeds from the stored guide, edits, and saves exactly the cleaned guide", () => {
    hooks.query = {
      isLoading: false, isError: false, isSuccess: true, refetch: async () => undefined,
      data: { highlights: ["Night market"], what_to_prepare: "Boots.", good_to_know: null, faqs: [], group_minimum: 6, activity_level: "easy" },
    };
    const mutate = jest.fn((_input: unknown, handlers: { onSuccess?: (v: unknown) => void }) => {
      handlers.onSuccess?.({ highlights: ["Night market", "Sunrise hike"], what_to_prepare: "Boots.", good_to_know: null,
        faqs: [{ question: "Visa?", answer: "Not needed." }], group_minimum: 6, activity_level: "moderate" });
    });
    hooks.mutation = { isPending: false, mutate };
    const r = mount();
    expect(text(r)).toContain("Night market");
    // Nothing changed yet: the save button is disabled and says Saved.
    expect(byId(r, "trip-guide-editor-save").props.disabled).toBe(true);

    act(() => (byId(r, "trip-guide-editor-highlight-input").props.onChangeText as (v: string) => void)("  Sunrise hike "));
    act(() => (byId(r, "trip-guide-editor-highlight-add").props.onPress as () => void)());
    act(() => (byId(r, "trip-guide-editor-faq-add").props.onPress as () => void)());
    const faqInputs = r.root.findAll((node) => typeof node.props.accessibilityLabel === "string" &&
      /^(Question|Answer) 1$/.test(node.props.accessibilityLabel as string) && typeof node.props.onChangeText === "function");
    act(() => (faqInputs[0]!.props.onChangeText as (v: string) => void)("Visa?"));
    // Half-filled: the save is blocked with a plain reason.
    expect(text(r)).toContain("Every question needs an answer");
    expect(byId(r, "trip-guide-editor-save").props.disabled).toBe(true);
    act(() => (faqInputs[faqInputs.length - 1]!.props.onChangeText as (v: string) => void)("Not needed."));
    act(() => (byId(r, "trip-guide-editor-activity-moderate").props.onPress as () => void)());
    expect(byId(r, "trip-guide-editor-save").props.disabled).toBe(false);

    act(() => (byId(r, "trip-guide-editor-save").props.onPress as () => void)());
    expect(mutate).toHaveBeenCalledTimes(1);
    const sent = mutate.mock.calls[0]![0] as { eventId: string; draft: Record<string, unknown> };
    expect(sent.eventId).toBe("trip-1");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tripGuidePayload } = require("@mingla/offering-rendering/tripGuide") as { tripGuidePayload: (d: unknown) => unknown };
    expect(tripGuidePayload(sent.draft)).toEqual({
      highlights: ["Night market", "Sunrise hike"],
      what_to_prepare: "Boots.",
      good_to_know: null,
      faqs: [{ question: "Visa?", answer: "Not needed." }],
      group_minimum: 6,
      activity_level: "moderate",
    });
    expect(text(r)).toContain("Trip guide saved.");
  });

  test("a refused save shows Mingla's reason in plain words", () => {
    hooks.query = { isLoading: false, isError: false, isSuccess: true, data: null, refetch: async () => undefined };
    hooks.mutation = {
      isPending: false,
      mutate: (_input, handlers) => handlers.onError?.(new Error("insufficient_event_permission")),
    };
    const r = mount();
    act(() => (byId(r, "trip-guide-editor-whatToPrepare").props.onChangeText as (v: string) => void)("Sunscreen."));
    act(() => (byId(r, "trip-guide-editor-save").props.onPress as () => void)());
    expect(text(r)).toContain("Only event managers, admins and owners can edit the trip guide.");
  });

  test("the creator step and the published-trip editor both mount the guide editor with the trip id", () => {
    const read = (name: string) => fs.readFileSync(path.resolve(__dirname, "..", name), "utf8");
    const step3 = read("TripCreatorStep3Inclusions.tsx");
    expect(step3).toMatch(/eventId !== undefined \? \(\s*<TripGuideEditor/);
    expect(read("TripCreatorWizard.tsx")).toMatch(/<TripCreatorStep3Inclusions[\s\S]{0,400}eventId=\{trip\.id\}/);
    expect(read("EditPublishedTripScreen.tsx")).toMatch(/<TripCreatorStep3Inclusions[\s\S]{0,400}eventId=\{trip\.id\}/);
  });
});
