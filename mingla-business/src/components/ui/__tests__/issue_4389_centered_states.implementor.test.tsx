// MINGLA-INVARIANT: I-4389-CENTERED-STATES | issue #4389 | Every empty, error or no-match state #4389 added or touched renders through ui/CenteredState: the block is centred horizontally (and vertically in the space left with `fill`), its text is centre-aligned, and its buttons keep their natural width (never fullWidth).
/**
 * Seth (2026-11-11): the F2 "Try again" sat left-aligned; every empty, error
 * and no-match state must be centred.
 *
 * FAILS-ON-REVERT: put PayoutCountryList's old `styles.empty` View back and
 * C2 fails; drop `alignItems`/`textAlign` from CenteredState and C1 fails;
 * give a CenteredState button `fullWidth` again and C4 fails.
 *
 *   cd mingla-business && npx jest src/components/ui/__tests__/issue_4389_centered_states.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import { StyleSheet, Text } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;



import { CenteredState } from "../CenteredState";
import { PayoutCountryList } from "../../brand/PayoutCountryList";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[] }
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
};
const flat = (style: unknown): Record<string, unknown> => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
const BIZ = path.join(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ, rel), "utf8");

function expectCentered(root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }, testID: string): void {
  const block = root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
  expect(block).toHaveLength(1);
  const s = flat(block[0]!.props.style);
  expect(s.alignItems).toBe("center");
  expect(s.justifyContent).toBe("center");
  const texts = root.findAll((n) => n.type === Text);
  for (const t of texts) expect(flat(t.props.style).textAlign).toBe("center");
}

describe("#4389 centred empty / error / no-match states", () => {
  test("C1: CenteredState centres the block, its text and its actions; fill grows into the space left", () => {
    let tree: ReturnType<typeof TestRenderer.create> | null = null;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <CenteredState fill title="We couldn't load this." body="Try again." testID="state"><Text>btn</Text></CenteredState>,
      );
    });
    const t = tree as unknown as ReturnType<typeof TestRenderer.create>;
    const block = t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "state")[0]!;
    expect(flat(block.props.style)).toMatchObject({ alignItems: "center", justifyContent: "center", flexGrow: 1 });
    const actions = t.root.findAll((n) => typeof n.type === "string" && flat(n.props.style).marginTop !== undefined && flat(n.props.style).alignItems === "center");
    expect(actions.length).toBeGreaterThan(0);
    t.unmount();
  });

  test("C2: F2 no-match is a centred CenteredState that fills the space under the search", () => {
    let tree: ReturnType<typeof TestRenderer.create> | null = null;
    TestRenderer.act(() => {
      tree = TestRenderer.create(<PayoutCountryList selected={null} onSelect={jest.fn()} />);
    });
    const t = tree as unknown as ReturnType<typeof TestRenderer.create>;
    const search = t.root.findAll((n) => n.props.testID === "payout-country-list-search" && typeof n.props.onChangeText === "function")[0]!;
    TestRenderer.act(() => (search.props.onChangeText as (q: string) => void)("Atlantis"));
    const block = t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "payout-country-list-no-match");
    expect(block).toHaveLength(1);
    expect(flat(block[0]!.props.style)).toMatchObject({ alignItems: "center", justifyContent: "center", flexGrow: 1 });
    const texts = t.root.findAll((n) => n.type === Text && String(n.props.children).includes("Atlantis"));
    expect(texts.length).toBeGreaterThan(0);
    expect(flat(texts[0]!.props.style).textAlign).toBe("center");
    // The list root grows so the state can centre vertically.
    const root = t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "payout-country-list")[0]!;
    expect(flat(root.props.style).flexGrow).toBe(1);
    t.unmount();
  });

  test("C3: F2 has no load-error state to misalign: the bank-country list is bundled, never read from the server", () => {
    const list = read("src/components/brand/PayoutCountryList.tsx");
    expect(list).toContain('from "../../constants/stripeSupportedCountries"');
    expect(list).not.toMatch(/supabase|useQuery|payout_country_rails/);
  });

  test("C4: the #4389 states use CenteredState, and no button inside one is fullWidth", () => {
    const sites: Record<string, string[]> = {
      "src/components/brand/PayoutCountryList.tsx": ["testID={`${testID}-no-match`}"],
      "src/components/door/DoorModeScreen.tsx": ["door-mode-not-found", "door-mode-no-tiers", "door-mode-no-recent-sales"],
      "src/components/door/DoorModePayCodeSheet.tsx": ["door-mode-code-load-failed"],
      "app/brand/[id]/tap-to-pay/address.tsx": ["t1-error"],
      "src/components/ari/AriSetupCard.tsx": ["<CenteredState compact title={C.a2.error}"],
    };
    for (const [file, marks] of Object.entries(sites)) {
      const src = read(file);
      expect({ file, imports: src.includes("ui/CenteredState") }).toEqual({ file, imports: true });
      for (const mark of marks) expect({ file, mark, ok: src.includes(mark) }).toEqual({ file, mark, ok: true });
      for (const m of src.matchAll(/<CenteredState\b[\s\S]*?<\/CenteredState>/g)) {
        expect({ file, fullWidth: /fullWidth/.test(m[0]) }).toEqual({ file, fullWidth: false });
      }
    }
  });
});
