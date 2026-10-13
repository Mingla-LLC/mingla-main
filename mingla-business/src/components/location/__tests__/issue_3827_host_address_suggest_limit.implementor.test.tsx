/**
 * issue #3827 — Host address fields show up to 10 suggestions.
 *
 * Before: every address search asked for 5 rows. With a far-away rank point
 * "Lagos, Nigeria" is the 7th result, so a Host could not find their own city.
 *
 * Now the Mingla Host wrapper asks for 10. The shared field's default and the
 * Explorer app stay at 5, the request still carries no `types` / `country`
 * filter, and the longer list scrolls inside a bounded box.
 *
 * FAILS ON REVERT: delete `suggestLimit={HOST_ADDRESS_SUGGEST_LIMIT}` from the
 * wrapper and the shared field receives no limit, so the request falls back to
 * the function's default of 5 — the first two tests go red.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// The shared field becomes a host element so the props the wrapper forwards
// can be read. Everything about the REQUEST stays real (see below).
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

import {
  HOST_ADDRESS_DROPDOWN_MAX_HEIGHT,
  HOST_ADDRESS_SUGGEST_LIMIT,
  MapboxAddressInput,
} from "../MapboxAddressInput";
import { autocompleteMapbox } from "../../../../../packages/location-input/src/mapboxGeocodeService";

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Tree {
  root: Node;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(repo, relative), "utf8");

const renderHostField = async (): Promise<Node> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <MapboxAddressInput
        value=""
        onChangeText={() => undefined}
        onPick={() => undefined}
        onClear={() => undefined}
      />,
    );
  });
  return tree.root.findAll(
    (node) => node.type === "SharedMapboxAddressInput",
  )[0] as Node;
};

/** The body the shared service sends to `mapbox-geocode` for a given limit. */
const suggestRequestBody = async (
  limit: number | undefined,
): Promise<Record<string, unknown>> => {
  const bodies: Record<string, unknown>[] = [];
  const invoke = (
    _fn: string,
    options: { body: Record<string, unknown> },
  ): Promise<{ data: unknown; error: null }> => {
    bodies.push(options.body);
    return Promise.resolve({ data: { suggestions: [] }, error: null });
  };
  await autocompleteMapbox("Lagos, Nigeria", "session-3827", { invoke }, { limit });
  expect(bodies).toHaveLength(1);
  return bodies[0];
};

describe("issue #3827 — Host address suggestions", () => {
  test("the Host wrapper forwards a limit of 10 to the shared field", async () => {
    const shared = await renderHostField();

    expect(HOST_ADDRESS_SUGGEST_LIMIT).toBe(10);
    expect(shared.props.suggestLimit).toBe(10);
  });

  test("that limit reaches the suggest request, with no types or country filter", async () => {
    const shared = await renderHostField();
    const body = await suggestRequestBody(shared.props.suggestLimit as number);

    expect(body).toEqual({
      action: "suggest",
      query: "Lagos, Nigeria",
      session_token: "session-3827",
      limit: 10,
    });
    expect(body).not.toHaveProperty("types");
    expect(body).not.toHaveProperty("country");
  });

  test("the shared package default stays at 5: no limit is sent, and the function resolves that to 5", async () => {
    const body = await suggestRequestBody(undefined);
    expect(body).not.toHaveProperty("limit");

    // The shared field declares the prop optional and gives it no default.
    const sharedSource = read("packages/location-input/src/MapboxAddressInput.tsx");
    expect(sharedSource).toMatch(/\n\s*suggestLimit\?: number;/);
    expect(sharedSource).toMatch(/\n\s*suggestLimit,\n/);
    expect(sharedSource).not.toMatch(/suggestLimit\s*=\s*\d/);

    // The function owns the default and the ceiling.
    const edge = read("supabase/functions/mapbox-geocode/index.ts");
    expect(edge).toMatch(
      /export function clampSuggestLimit\(limit: number \| undefined\): number \{\s*const n = typeof limit === "number" && Number\.isFinite\(limit\)\s*\? Math\.trunc\(limit\)\s*: 5;\s*return Math\.min\(Math\.max\(n, 1\), 10\);/,
    );
  });

  test("the Explorer app is not moved to 10", () => {
    const consumerWrapper = read("app-mobile/src/components/location/MapboxAddressInput.tsx");

    // It only passes on what its own caller asked for; it sets no limit itself.
    expect(consumerWrapper).toContain("suggestLimit={suggestLimit}");
    expect(consumerWrapper).not.toMatch(/suggestLimit=\{\s*10\s*\}/);
    expect(consumerWrapper).not.toContain("HOST_ADDRESS_SUGGEST_LIMIT");
  });

  test("ten rows scroll inside a bounded list instead of one unbounded block", async () => {
    const shared = await renderHostField();
    const tokens = shared.props.tokens as {
      dropdown: { mode: string; maxHeight: number };
    };

    expect(HOST_ADDRESS_DROPDOWN_MAX_HEIGHT).toBe(320);
    expect(tokens.dropdown.mode).toBe("card");
    expect(tokens.dropdown.maxHeight).toBe(320);

    // The shared card list bounds a scroll view by that token (keyboard-aware
    // on native), so rows past the bound are reachable by scrolling.
    const sharedSource = read("packages/location-input/src/MapboxAddressInput.tsx");
    expect(sharedSource).toContain("tokenMaxHeight: tokens.dropdown.maxHeight,");
    expect(sharedSource).toMatch(
      /<Scroll\s+style=\{\{ maxHeight: dropdownMaxHeight \}\}\s+keyboardShouldPersistTaps="handled"\s+nestedScrollEnabled\s+showsVerticalScrollIndicator\s*>/,
    );
  });
});
