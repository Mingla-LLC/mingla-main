/**
 * #3355 — the phone field's country chip follows an opt-in `countryIso`.
 *
 * Brand Edit moves an EMPTY phone box's country to each newly picked
 * address's country (London → UK, then New York → US). The chip kept its own
 * state, read from `defaultCountryIso` only at mount, so the second pick left
 * it on UK. With `countryIso` the chip follows every change; without it the
 * field behaves exactly as before.
 *
 * FAILS-ON-REVERT: delete Input's `countryIso` effect and the "follows" case
 * stays on the first country.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../Icon", () => ({ Icon: () => null }));
// The country list sheet is closed throughout; its native blur cannot load here.
jest.mock("../Sheet", () => ({ Sheet: () => null }));

import { Input } from "../Input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Node = { props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: Node) => boolean) => Node[] };
  update: (el: React.ReactElement) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => void) => void;
};

const chipLabel = (tree: Tree): string => {
  const chip = tree.root.findAll(
    (n) =>
      typeof n.props.accessibilityLabel === "string" &&
      (n.props.accessibilityLabel as string).startsWith("Country: "),
  );
  return (chip[0]?.props.accessibilityLabel as string | undefined) ?? "";
};

const field = (props: { countryIso?: string; defaultCountryIso?: string }) => (
  <Input
    variant="phone"
    value=""
    onChangeText={() => undefined}
    accessibilityLabel="Contact phone"
    {...props}
  />
);

describe("#3355 — the phone chip follows countryIso", () => {
  test("follows every change: GB, then US, then NG", () => {
    let tree!: Tree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(field({ defaultCountryIso: "GB", countryIso: "GB" }));
    });
    expect(chipLabel(tree)).toContain("United Kingdom");
    TestRenderer.act(() => tree.update(field({ defaultCountryIso: "GB", countryIso: "US" })));
    expect(chipLabel(tree)).toContain("United States");
    TestRenderer.act(() => tree.update(field({ defaultCountryIso: "GB", countryIso: "NG" })));
    expect(chipLabel(tree)).toContain("Nigeria");
    TestRenderer.act(() => tree.unmount());
  });

  test("without countryIso, a new defaultCountryIso does not move the chip (unchanged)", () => {
    let tree!: Tree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(field({ defaultCountryIso: "GB" }));
    });
    expect(chipLabel(tree)).toContain("United Kingdom");
    TestRenderer.act(() => tree.update(field({ defaultCountryIso: "US" })));
    expect(chipLabel(tree)).toContain("United Kingdom");
    TestRenderer.act(() => tree.unmount());
  });
});
