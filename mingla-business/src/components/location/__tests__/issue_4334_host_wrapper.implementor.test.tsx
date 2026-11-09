/**
 * #4334 — the Host AddressInput wrapper (D4, D5, D7).
 * Fails-on-revert: re-add `suggestLimit` → H-1 red; drop
 * `onSearchUnavailable={reportSearchUnavailable}` → H-2 red; drop the
 * attribution token → H-3 red; import the shared field statically on web → H-4;
 * a value import from the package index in an eager Host file → H-5.
 */
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reportNonFatal = jest.fn();
jest.mock("../../../diagnostics/reportNonFatal", () => ({ __esModule: true, reportNonFatal: (...a: unknown[]) => reportNonFatal(...a) }));
// The wrapper loads the shared field through ./sharedAddressField (static on
// native and here; its own chunk on web — see sharedAddressField.web.tsx).
jest.mock("../sharedAddressField", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    SharedAddressInput: (props: Record<string, unknown>) => ReactActual.createElement("SharedAddressInput", props),
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

// ── #4334 (#2099 ceiling) — the web field loads from its own chunk ──────────

describe("#4334 — the shared field stays off the eager web boot payload", () => {
  const read = (rel: string) =>
    readFileSync(path.join(__dirname, "..", rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  test("H-4 web: React.lazy + dynamic import of the shared field, behind a field-height box", () => {
    const web = read("sharedAddressField.web.tsx");
    expect(web).toMatch(/React\.lazy\(async \(\) => \{\s*const mod = await import\("@mingla\/location-input\/src\/AddressInput"\);/);
    expect(web).toContain("<Suspense fallback={<View style={{ minHeight: FIELD_PLACEHOLDER_HEIGHT }} />}>");
    expect(web).not.toMatch(/^import [^;]*\{[^}]*\bAddressInput\b[^}]*\}[^;]*from "@mingla\/location-input/m);
    // native keeps the static import
    expect(read("sharedAddressField.tsx")).toContain(
      'export { AddressInput as SharedAddressInput } from "@mingla/location-input/src/AddressInput";',
    );
  });

  test("H-5 the wrapper and every eager Host importer take values from their own files, never the package index", () => {
    const wrapper = read("AddressInput.tsx");
    expect(wrapper).toContain('import { SharedAddressInput } from "./sharedAddressField";');
    expect(wrapper).not.toMatch(/import \{[^}]*\bAddressInput as SharedAddressInput\b[^}]*\} from "@mingla\/location-input"/);
    const root = path.join(__dirname, "../../../..");
    const files = [
      "src/components/event/CreatorStep3Where.tsx",
      "src/components/experience/ExperienceStopCard.tsx",
      "src/components/trip/EditPublishedTripScreen.tsx",
      "src/components/trip/TripCreatorStep1Basics.tsx",
      "src/components/venue/VenueDetailsEditor.tsx",
      "src/components/venue/VenueStep1Address.tsx",
      "src/services/placesService.ts",
      "src/components/location/AddressInput.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(root, rel), "utf8");
      // only `import type` may name the index
      const valueImports = src.match(/^import (?!type )[^;]*from "@mingla\/location-input";/gm) ?? [];
      expect({ rel, valueImports }).toEqual({ rel, valueImports: [] });
    }
  });
});
