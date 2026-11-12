/**
 * #3355 Wave A (A4, Seth D5a) — Brand Edit's Time zone field, rendered, and
 * the save path that writes `brands.default_timezone`.
 *
 * Production 2026-11-10: Ari sent a Lagos host to Brand profile to add a time
 * zone, and Brand profile had no time zone field. Now the field shows the
 * brand's zone (or "Not set"), the picker searches the full IANA list, and a
 * pick travels through Brand Edit's own save into `default_timezone`.
 */
import React from "react";

import {
  mapBrandRowToUi,
  mapUiToBrandUpdatePatch,
  type BrandRow,
} from "../../../services/brandMapping";
import { computeDirtyFieldsPatch } from "../../../utils/brandPatch";
import type { Brand } from "../../../store/currentBrandStore";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
  create: (node: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
};

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement(name, props, children);
  return {
    StyleSheet: { create: (styles: unknown) => styles },
    Pressable: host("pressable"),
    Text: host("text"),
    View: host("view"),
  };
});
jest.mock("../../../constants/designSystem", () => ({
  spacing: { xs: 4, sm: 8 },
  text: { primary: "black", tertiary: "grey" },
  typography: { body: { fontSize: 16 }, bodySm: { fontSize: 14 } },
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("button", props),
}));
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("input", props),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandEditTimezoneField, filterTimezones } = require("../BrandEditTimezoneField") as typeof import("../BrandEditTimezoneField");

function mount(value: string | undefined, onChange: (zone: string) => void) {
  let r!: ReturnType<typeof TestRenderer.create>;
  void TestRenderer.act(() => {
    r = TestRenderer.create(
      <BrandEditTimezoneField value={value} onChange={onChange} testID="tz" />,
    );
  });
  return r;
}

const byTestId = (r: ReturnType<typeof mount>, id: string): Node[] =>
  r.root.findAll((n) => n.props.testID === id && typeof n.type === "string");

describe("#3355 Wave A — Brand Edit Time zone field", () => {
  test("no zone yet: says Not set, never UTC; Choose opens the search", () => {
    const r = mount(undefined, () => undefined);
    expect(byTestId(r, "tz-unset")).toHaveLength(1);
    expect(byTestId(r, "tz-value")).toHaveLength(0);
    const toggle = byTestId(r, "tz-toggle")[0];
    expect(toggle.props.label).toBe("Choose");
    expect(byTestId(r, "tz-search")).toHaveLength(0);
    void TestRenderer.act(() => (toggle.props.onPress as () => void)());
    expect(byTestId(r, "tz-search")).toHaveLength(1);
    void TestRenderer.act(() => r.unmount());
  });

  test("a set zone shows its label; searching Lagos and picking writes Africa/Lagos", () => {
    const picked: string[] = [];
    const r = mount("Europe/London", (zone) => picked.push(zone));
    expect(String(byTestId(r, "tz-value")[0].props.children)).toMatch(
      /^Europe\/London/,
    );
    void TestRenderer.act(() =>
      (byTestId(r, "tz-toggle")[0].props.onPress as () => void)()
    );
    void TestRenderer.act(() =>
      (byTestId(r, "tz-search")[0].props.onChangeText as (v: string) => void)(
        "lagos",
      )
    );
    const option = byTestId(r, "tz-option-Africa/Lagos");
    expect(option).toHaveLength(1);
    void TestRenderer.act(() => (option[0].props.onPress as () => void)());
    expect(picked).toEqual(["Africa/Lagos"]);
    expect(byTestId(r, "tz-search")).toHaveLength(0);
    void TestRenderer.act(() => r.unmount());
  });

  test("search matches city names with spaces (New York → America/New_York)", () => {
    expect(
      filterTimezones(["America/New_York", "Europe/London"], "new york"),
    ).toEqual(["America/New_York"]);
  });

  test("the save path writes default_timezone, and reads it back", () => {
    const original = mapBrandRowToUi({
      id: "b1",
      account_id: "u1",
      name: "Favy Lagos",
      slug: "favy",
      default_timezone: null,
      country_code: "NG",
      created_at: "2026-11-10T00:00:00Z",
      updated_at: "2026-11-10T00:00:00Z",
      deleted_at: null,
    } as unknown as BrandRow, { role: "owner" }) as Brand;
    expect(original.defaultTimezone).toBeUndefined();
    const draft: Brand = { ...original, defaultTimezone: "Africa/Lagos" };
    const patch = computeDirtyFieldsPatch(draft, original);
    expect(patch).toEqual({ defaultTimezone: "Africa/Lagos" });
    expect(mapUiToBrandUpdatePatch(patch)).toEqual({
      default_timezone: "Africa/Lagos",
    });
    const reread = mapBrandRowToUi({
      ...({ id: "b1", account_id: "u1", name: "Favy Lagos", slug: "favy" } as object),
      default_timezone: "Africa/Lagos",
      created_at: "2026-11-10T00:00:00Z",
      updated_at: "2026-11-10T00:00:00Z",
      deleted_at: null,
    } as unknown as BrandRow, { role: "owner" }) as Brand;
    expect(reread.defaultTimezone).toBe("Africa/Lagos");
  });
});
