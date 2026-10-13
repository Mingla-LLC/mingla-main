/**
 * issue #3827 — tester adversarial pass on "Host address fields show up to 10
 * suggestions, in a list bounded to 320".
 *
 * The implementor's test proves the wrapper forwards 10 and the token is 320.
 * This file attacks different angles:
 *
 *   1. the REAL edge-function code (`clampSuggestLimit`, `buildSuggestUrl`) and
 *      the REAL keyboard cap (`computeDropdownMaxHeight`) are lifted out of
 *      their source files and executed, so the numbers are computed, not read;
 *   2. the keyboard-aware cap on native: bounding the token to 320 must never
 *      make the list TALLER than it was with the old unbounded token, at any
 *      keyboard position, and must never push it under the 96 floor;
 *   3. a caller of the Host wrapper that tries to pass its own limit;
 *   4. the "Can't find it in the list? Use what you typed." row and the
 *      loading / no-results / offline rows are outside the bounded scroll box;
 *   5. the request with a rank point and a limit together still has no
 *      `types` / `country`, and nonsense limits never reach the provider;
 *   6. every Explorer caller keeps the limit it had.
 */
import React from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, jest, test } from "@jest/globals";
import ts from "typescript";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@mingla/location-input", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    MapboxAddressInput: (props: Record<string, unknown>) =>
      ReactActual.createElement("SharedMapboxAddressInput", props),
  };
});
jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: () => null }));
jest.mock("../../../services/supabase", () => ({
  __esModule: true,
  supabase: { functions: { invoke: jest.fn() } },
}));

import * as hostWrapper from "../MapboxAddressInput";
import { computeShowFreeTextRow } from "../../../../../packages/location-input/src/assistFooter";
import { autocompleteMapbox } from "../../../../../packages/location-input/src/mapboxGeocodeService";

const { MapboxAddressInput } = hostWrapper;
// Read through the namespace so that, with the fix reverted, the file still
// loads and each case fails on its own assertion.
const HOST_LIMIT = (hostWrapper as unknown as { HOST_ADDRESS_SUGGEST_LIMIT?: number })
  .HOST_ADDRESS_SUGGEST_LIMIT;
const HOST_MAX_HEIGHT = (hostWrapper as unknown as { HOST_ADDRESS_DROPDOWN_MAX_HEIGHT?: number })
  .HOST_ADDRESS_DROPDOWN_MAX_HEIGHT;

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Tree {
  root: Node;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(repo, relative), "utf8");

const sharedSource = read("packages/location-input/src/MapboxAddressInput.tsx");
const edgeSource = read("supabase/functions/mapbox-geocode/index.ts");

/** Lift one exported function out of a source file and run it under jest. */
const lift = <T,>(
  source: string,
  name: string,
  scope: Record<string, unknown> = {},
): T => {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = source.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`${name} has no end`);
  const js = ts.transpileModule(
    source.slice(start, end + 2).replace("export function", "function"),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
  ).outputText;
  const names = Object.keys(scope);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(...names, `${js}\nreturn ${name};`)(
    ...names.map((key) => scope[key]),
  ) as T;
};

const numberConstant = (source: string, name: string): number => {
  const match = new RegExp(`export const ${name} = (\\d+);`).exec(source);
  if (match === null) throw new Error(`${name} not found`);
  return Number(match[1]);
};

const MIN_DROPDOWN_HEIGHT = numberConstant(sharedSource, "MIN_DROPDOWN_HEIGHT");
const DROPDOWN_SAFETY_MARGIN = numberConstant(sharedSource, "DROPDOWN_SAFETY_MARGIN");
const DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE = numberConstant(
  sharedSource,
  "DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE",
);

const computeDropdownMaxHeight = lift<
  (params: {
    keyboardScreenY: number;
    cardTopY: number | null;
    tokenMaxHeight: number;
    isIOS: boolean;
  }) => number
>(sharedSource, "computeDropdownMaxHeight", {
  MIN_DROPDOWN_HEIGHT,
  DROPDOWN_SAFETY_MARGIN,
  DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE,
});

const clampSuggestLimit = lift<(limit: number | undefined) => number>(
  edgeSource,
  "clampSuggestLimit",
);
const buildSuggestUrl = lift<
  (
    base: string,
    token: string,
    query: string,
    session: string,
    opts?: { proximity?: string; limit?: number },
  ) => string
>(edgeSource, "buildSuggestUrl", { clampSuggestLimit });

const renderHostField = async (extraProps: Record<string, unknown> = {}): Promise<Node> => {
  let tree!: Tree;
  const Field = MapboxAddressInput as unknown as React.ComponentType<Record<string, unknown>>;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <Field
        value=""
        onChangeText={() => undefined}
        onPick={() => undefined}
        onClear={() => undefined}
        {...extraProps}
      />,
    );
  });
  return tree.root.findAll((node) => node.type === "SharedMapboxAddressInput")[0] as Node;
};

const hostTokens = async (): Promise<{
  dropdown: { mode: string; maxHeight: number };
  row: {
    paddingVertical: number;
    primaryLineHeight: number;
    secondaryLineHeight: number;
  };
}> => (await renderHostField()).props.tokens as never;

const suggestBody = async (bias?: {
  proximity?: string;
  limit?: number;
}): Promise<Record<string, unknown>> => {
  const bodies: Record<string, unknown>[] = [];
  await autocompleteMapbox(
    "Lagos, Nigeria",
    "session-3827-tester",
    {
      invoke: (_fn: string, options: { body: Record<string, unknown> }) => {
        bodies.push(options.body);
        return Promise.resolve({ data: { suggestions: [] }, error: null });
      },
    },
    bias,
  );
  expect(bodies).toHaveLength(1);
  return bodies[0];
};

describe("issue #3827 tester — the limit a Host field asks for", () => {
  test("a caller that passes its own limit is overridden: every Host field asks for 10", async () => {
    for (const attempted of [3, 5, 25, 0, undefined, null]) {
      const shared = await renderHostField({ suggestLimit: attempted });
      expect(shared.props.suggestLimit).toBe(10);
    }
    // The wrapper's own props do not offer a limit, so this cannot compile in
    // a real caller: the override above is deliberate, not an accident.
    const wrapper = read("mingla-business/src/components/location/MapboxAddressInput.tsx");
    const propsBlock = wrapper.slice(
      wrapper.indexOf("interface MapboxAddressInputProps {"),
      wrapper.indexOf("\n}\n", wrapper.indexOf("interface MapboxAddressInputProps {")),
    );
    expect(propsBlock.length).toBeGreaterThan(0);
    expect(propsBlock).not.toContain("suggestLimit");
  });

  test("no Host screen tries to pass a limit or its own scroll container", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx$/.test(entry) || full.endsWith("location/MapboxAddressInput.tsx")) continue;
        const text = readFileSync(full, "utf8");
        if (/<MapboxAddressInput\b/.test(text) && /suggestLimit=/.test(text)) offenders.push(full);
      }
    };
    walk(join(repo, "mingla-business", "src"));
    walk(join(repo, "mingla-business", "app"));
    expect(offenders).toEqual([]);
  });

  test("10 is exactly the provider ceiling: the function sends 10 and keeps all 10 rows", () => {
    expect(HOST_LIMIT).toBe(10);
    expect(clampSuggestLimit(HOST_LIMIT)).toBe(10);
    expect(buildSuggestUrl("https://api.test", "tok", "Lagos, Nigeria", "s", { limit: HOST_LIMIT })).toMatch(
      /&limit=10$/,
    );
    // The response is trimmed to the SAME clamped number, not a hardcoded 5.
    expect(edgeSource).toMatch(
      /const effectiveLimit = clampSuggestLimit\(opts\.limit\);[\s\S]{0,400}\.slice\(0, effectiveLimit\);/,
    );
  });

  test("nonsense limits never reach the provider, and no limit still means 5", () => {
    expect(clampSuggestLimit(undefined)).toBe(5);
    expect(clampSuggestLimit(Number.NaN)).toBe(5);
    expect(clampSuggestLimit(Number.POSITIVE_INFINITY)).toBe(5);
    expect(clampSuggestLimit("10" as unknown as number)).toBe(5);
    expect(clampSuggestLimit(11)).toBe(10);
    expect(clampSuggestLimit(1_000)).toBe(10);
    expect(clampSuggestLimit(10.9)).toBe(10);
    expect(clampSuggestLimit(0)).toBe(1);
    expect(clampSuggestLimit(-4)).toBe(1);
    expect(buildSuggestUrl("https://api.test", "tok", "Lagos", "s")).toMatch(/&limit=5$/);
  });

  test("the request and the provider URL carry a limit and a rank point, and still no types or country", async () => {
    const body = await suggestBody({ proximity: "-0.1276,51.5072", limit: HOST_LIMIT });
    expect(Object.keys(body).sort()).toEqual(
      ["action", "limit", "proximity", "query", "session_token"].sort(),
    );
    expect(body.limit).toBe(10);
    expect(body.action).toBe("suggest");

    const url = buildSuggestUrl("https://api.test", "tok", "Lagos, Nigeria", "s", {
      proximity: "-0.1276,51.5072",
      limit: 10,
    });
    const params = [...new URL(url).searchParams.keys()].sort();
    expect(params).toEqual(["access_token", "limit", "proximity", "q", "session_token"]);
    expect(url).not.toMatch(/[?&](types|country|bbox|language)=/);
  });
});

describe("issue #3827 tester — Explorer and the shared default are untouched", () => {
  test("the shared service sends no limit unless a caller gives one", async () => {
    expect(await suggestBody()).not.toHaveProperty("limit");
    expect(await suggestBody({ proximity: "3.3792,6.5244" })).not.toHaveProperty("limit");
    expect(await suggestBody({ limit: 0 })).not.toHaveProperty("limit");
  });

  test("every Explorer caller keeps the limit it had: two opt into 8, none into 10", () => {
    const withLimit: Record<string, string[]> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        const found = readFileSync(full, "utf8").match(/suggestLimit=\{[^}]*\}/g);
        if (found !== null) withLimit[full.slice(repo.length + 1)] = found;
      }
    };
    walk(join(repo, "app-mobile", "src"));

    expect(withLimit).toEqual({
      "app-mobile/src/components/OnboardingFlow.tsx": ["suggestLimit={8}"],
      "app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx": [
        "suggestLimit={8}",
      ],
      "app-mobile/src/components/location/MapboxAddressInput.tsx": [
        "suggestLimit={suggestLimit}",
      ],
    });
    expect(read("app-mobile/src/components/location/MapboxAddressInput.tsx")).not.toMatch(
      /HOST_ADDRESS|maxHeight: 320/,
    );
  });
});

describe("issue #3827 tester — the 320 bound and the keyboard cap on native", () => {
  test("with the keyboard down the list is bounded to 320 instead of unbounded", () => {
    expect(HOST_MAX_HEIGHT).toBe(320);
    for (const cardTopY of [null, 0, 200, 900]) {
      expect(
        computeDropdownMaxHeight({
          keyboardScreenY: Number.POSITIVE_INFINITY,
          cardTopY,
          tokenMaxHeight: HOST_MAX_HEIGHT as number,
          isIOS: true,
        }),
      ).toBe(320);
    }
  });

  test("at every keyboard position the bounded list is never taller than the old unbounded one, and never under the floor", () => {
    const worse: string[] = [];
    for (const isIOS of [true, false]) {
      for (let cardTopY = 0; cardTopY <= 900; cardTopY += 25) {
        for (let keyboardScreenY = 200; keyboardScreenY <= 1000; keyboardScreenY += 20) {
          const before = computeDropdownMaxHeight({
            keyboardScreenY,
            cardTopY,
            tokenMaxHeight: 9999,
            isIOS,
          });
          const after = computeDropdownMaxHeight({
            keyboardScreenY,
            cardTopY,
            tokenMaxHeight: HOST_MAX_HEIGHT as number,
            isIOS,
          });
          const expected = Math.min(before, 320);
          if (after !== expected || after > before || after < MIN_DROPDOWN_HEIGHT) {
            worse.push(`${isIOS ? "ios" : "android"} top=${cardTopY} kb=${keyboardScreenY}: ${before} -> ${after}`);
          }
        }
      }
    }
    expect(worse).toEqual([]);
  });

  test("when the keyboard leaves less than 320, the keyboard cap still wins", () => {
    // Card top at 400, keyboard top at 560: 160 - 8 margin = 152 on Android,
    // minus the 44 accessory allowance on iOS = 108.
    expect(
      computeDropdownMaxHeight({ keyboardScreenY: 560, cardTopY: 400, tokenMaxHeight: 320, isIOS: false }),
    ).toBe(152);
    expect(
      computeDropdownMaxHeight({ keyboardScreenY: 560, cardTopY: 400, tokenMaxHeight: 320, isIOS: true }),
    ).toBe(108);
    // A keyboard that covers the card entirely still leaves the two-row floor.
    expect(
      computeDropdownMaxHeight({ keyboardScreenY: 300, cardTopY: 400, tokenMaxHeight: 320, isIOS: true }),
    ).toBe(MIN_DROPDOWN_HEIGHT);
  });

  test("the bound really is about five and a half rows, so ten rows must scroll and the next row peeks", async () => {
    const tokens = await hostTokens();
    const rowHeight =
      tokens.row.paddingVertical * 2 + tokens.row.primaryLineHeight + 2 + tokens.row.secondaryLineHeight;
    expect(tokens.dropdown.maxHeight).toBe(320);
    expect(rowHeight * 10).toBeGreaterThan(tokens.dropdown.maxHeight);
    expect(rowHeight * 5).toBeLessThanOrEqual(tokens.dropdown.maxHeight);
    // Not a whole number of rows: a cut-off row signals there is more to scroll.
    const visibleRows = tokens.dropdown.maxHeight / rowHeight;
    expect(visibleRows).toBeGreaterThan(5);
    expect(visibleRows).toBeLessThan(6);
    expect(tokens.dropdown.maxHeight).toBeGreaterThan(MIN_DROPDOWN_HEIGHT);
  });
});

describe("issue #3827 tester — nothing else is clipped by the 320 bound", () => {
  const cardStart = sharedSource.indexOf("const wrappedList =");
  const cardEnd = sharedSource.indexOf("// ── Issue #1363 — selected free-text assist footer");
  const card = sharedSource.slice(cardStart, cardEnd);
  const scrollStart = card.indexOf("<Scroll");
  const scrollEnd = card.indexOf("</Scroll>");
  const scrollBox = card.slice(scrollStart, scrollEnd);

  test("only the suggestion rows live inside the bounded scroll box", () => {
    expect(cardStart).toBeGreaterThan(0);
    expect(cardEnd).toBeGreaterThan(cardStart);
    expect(scrollStart).toBeGreaterThan(0);
    expect(scrollEnd).toBeGreaterThan(scrollStart);
    // The bound is applied to the scroll viewport and to nothing else.
    expect(scrollBox).toContain("style={{ maxHeight: dropdownMaxHeight }}");
    expect(scrollBox).toContain("{renderRows(rowsOpen)}");
    expect(scrollBox).not.toContain("statusContent");
    expect(scrollBox).not.toContain("assistFooter");
    expect(sharedSource.match(/maxHeight: dropdownMaxHeight/g)?.length).toBe(1);
    // The card itself has no height bound that could cut the box off.
    expect(card.slice(0, scrollStart)).not.toMatch(/\bmaxHeight\b|\bheight:/);
  });

  test("loading, no-results and offline rows render above the scroll box, and the box only exists when there are rows", () => {
    expect(card.indexOf("{statusContent}")).toBeGreaterThan(0);
    expect(card.indexOf("{statusContent}")).toBeLessThan(scrollStart);
    expect(card).toMatch(/\{rowsOpen \? \(\s*<Scroll/);
    for (const state of ["suggestions_open", "loading_suggestions", "no_results", "offline"]) {
      expect(card.slice(0, scrollStart)).toContain(`status.kind === "${state}"`);
    }
    expect(sharedSource).toMatch(
      /const rowsOpen = status\.kind === "suggestions_open" \? status\.results : null;/,
    );
    expect(sharedSource).toContain("{status.kind === \"no_results\" ? statusText(copy.noResults) : null}");
  });

  test("the free-text row is a sibling below the card, never inside the bounded box", () => {
    const footerStart = sharedSource.indexOf("const assistFooter =");
    expect(footerStart).toBeGreaterThan(cardEnd);
    const footer = sharedSource.slice(footerStart, sharedSource.indexOf("const effectiveSelectionState", footerStart));
    expect(footer).toContain("Can't find it in the list? Use what you typed.");
    expect(footer).not.toMatch(/maxHeight|overflow/);
    expect(card).not.toContain("Use what you typed");
  });

  test("the free-text row still shows beside an open ten-row list and on zero results, not while loading", () => {
    const show = (statusKind: Parameters<typeof computeShowFreeTextRow>[0]["statusKind"]) =>
      computeShowFreeTextRow({
        allowFreeText: true,
        hasOnFreeText: true,
        justPicked: false,
        statusKind,
        trimmedLength: "Lagos, Nigeria".length,
      });
    expect(show("suggestions_open")).toBe(true);
    expect(show("no_results")).toBe(true);
    expect(show("offline")).toBe(true);
    expect(show("loading_suggestions")).toBe(false);
    expect(show("fetching_details")).toBe(false);
  });

  test("with ten rows the free-text row sits at most 320 below the field, not ten rows down", async () => {
    const tokens = await hostTokens();
    const rowHeight =
      tokens.row.paddingVertical * 2 + tokens.row.primaryLineHeight + 2 + tokens.row.secondaryLineHeight;
    const listHeight = (rows: number): number =>
      Math.min(rows * rowHeight, tokens.dropdown.maxHeight);
    // Bounded: ten rows push the row no further than the bound.
    expect(listHeight(10)).toBe(320);
    // Short lists are not padded out to the bound.
    expect(listHeight(1)).toBe(rowHeight);
    expect(listHeight(3)).toBe(rowHeight * 3);
    // Versus five rows before this change, the row moves down by less than one row.
    expect(listHeight(10) - rowHeight * 5).toBeLessThan(rowHeight);
  });
});
