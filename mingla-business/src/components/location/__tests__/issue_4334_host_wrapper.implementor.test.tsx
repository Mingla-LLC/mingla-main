/**
 * #4334 — the Host AddressInput wrapper (D4, D5, D7).
 * Fails-on-revert: re-add `suggestLimit` → H-1 red; drop
 * `onSearchUnavailable={reportSearchUnavailable}` → H-2 red; drop the
 * attribution token → H-3 red.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reportNonFatal = jest.fn();
jest.mock("../../../diagnostics/reportNonFatal", () => ({ __esModule: true, reportNonFatal: (...a: unknown[]) => reportNonFatal(...a) }));
jest.mock("@mingla/location-input", () => {
  const ReactActual = require("react") as typeof React;
  const actual = jest.requireActual("../../../../../packages/location-input/src/placesService") as Record<string, unknown>;
  return {
    __esModule: true,
    createThrottledReporter: actual.createThrottledReporter,
    AddressInput: (props: Record<string, unknown>) => ReactActual.createElement("SharedAddressInput", props),
  };
});
jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: () => null }));
jest.mock("../../../services/supabase", () => ({ __esModule: true, supabase: { functions: { invoke: jest.fn() } } }));

import { AddressInput } from "../AddressInput";

const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => Array<{ props: Record<string, unknown> }> } };
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

async function shared(): Promise<Record<string, unknown>> {
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <AddressInput value="" onChangeText={() => undefined} onPick={() => undefined} onClear={() => undefined} />,
    );
  });
  return tree.root.findAll((n) => n.type === "SharedAddressInput")[0].props;
}

describe("#4334 — Host wrapper", () => {
  test("H-1 no row limit is forwarded (Google returns at most 5, D4)", async () => {
    const props = await shared();
    expect(props).not.toHaveProperty("suggestLimit");
  });

  test("H-2 an unavailable search is reported to Sentry with its code, throttled", async () => {
    const props = await shared();
    const report = props.onSearchUnavailable as (code: string) => void;
    report("provider_denied");
    report("provider_denied");
    expect(reportNonFatal).toHaveBeenCalledTimes(1);
    expect(reportNonFatal.mock.calls[0][0]).toBe("address_search");
    expect(reportNonFatal.mock.calls[0][2]).toEqual({ code: "provider_denied" });
  });

  test("H-3 Host copy and the on-dark attribution", async () => {
    const props = await shared();
    expect((props.copy as Record<string, string>).unavailable).toBe(
      "Address search isn't working right now. Tap to try again.",
    );
    expect((props.tokens as { attribution?: { variant: string } }).attribution).toEqual({ variant: "dark" });
  });
});
