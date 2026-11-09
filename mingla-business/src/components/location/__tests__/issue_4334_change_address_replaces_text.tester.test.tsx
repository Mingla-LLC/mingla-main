/**
 * #4334 — tester adversarial: "Change address" select-all, attacked from the
 * sides the implementor's happy path does not cover.
 *
 *   CT-1 blur, then refocus the same field: it must NOT select all again
 *        (the caret goes where the host taps), and the input is not remounted.
 *   CT-2 a SECOND "Change address" (after typing and re-picking) arms the
 *        select-all again, on a freshly mounted, auto-focused input.
 *   CT-3 a host whose Change address empties the value (instead of keeping
 *        the text): typing still works and the flag ends on the first key.
 *   CT-4 Explorer's way of using the shared field (no selected pill, no
 *        onChangeSelected): focus, clear, type, blur — select-all is
 *        explicitly off throughout, and nothing auto-focuses.
 *
 * Fails-on-revert: delete `selectTextOnFocus={selectAllOnFocus}` from
 * packages/location-input/src/AddressInput.tsx, or the
 * `setSelectAllOnFocus(true)` in handleChangeSelected → CT-1/CT-2/CT-3/CT-4 red.
 */
import React from "react";
import { describe, expect, test } from "@jest/globals";

import {
  AddressInput as SharedField,
  type LocationSelectionState,
} from "../../../../../packages/location-input/src/AddressInput";
import type { InvokeFn } from "../../../../../packages/location-input/src/placesService";
import type { LocationInputTokens } from "../../../../../packages/location-input/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HostNode = { type: unknown; key?: string | null; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const tokens: LocationInputTokens = {
  field: { bg: "#111", bgFocused: "#111", border: "#333", borderFocused: "#eb7825", borderError: "#f00", radius: 12, hasBorder: true, paddingHorizontal: 12, paddingVertical: 8, focusBorderWidth: 1 },
  text: { input: "#fff", placeholder: "#999" },
  icon: { leading: "#aaa", clear: "#aaa" },
  spinner: "#eb7825",
  dropdown: { mode: "card", bg: "#111", border: "#333", radius: 12, maxHeight: 300, hasShadow: false },
  row: { pressBg: "#222", textPrimary: "#fff", textSecondary: "#aaa", divider: "#333", style: "flat", primaryFontSize: 16, primaryLineHeight: 20, primaryWeight: "400", secondaryFontSize: 12, secondaryLineHeight: 16, paddingVertical: 10, paddingHorizontal: 12 },
  status: { text: "#aaa", fontSize: 12, lineHeight: 16 },
  error: { text: "#f00", fontSize: 12, lineHeight: 16 },
  attribution: { variant: "dark" },
};
const copy = {
  minLengthHint: "Type more",
  searching: "Searching",
  noResults: "No matches",
  unavailable: "Search unavailable",
  pickError: "Pick failed",
};
const Icon = (): null => null;
const invoke: InvokeFn = async () => ({ data: { suggestions: [] }, error: null });

const SAVED = "14 Admiralty Way, Lekki";

let selectFromOutside: ((label: string) => void) | null = null;

/** keepText=false behaves like a host that empties the field on Change address. */
function Host({ keepText }: { keepText: boolean }): React.ReactElement {
  const [value, setValue] = React.useState(SAVED);
  const [selectionState, setSelectionState] =
    React.useState<LocationSelectionState>("selected");
  selectFromOutside = (label: string) => {
    setValue(label);
    setSelectionState("selected");
  };
  return (
    <SharedField
      value={value}
      onChangeText={setValue}
      onPick={() => undefined}
      onClear={() => {
        setValue("");
        setSelectionState("editing");
      }}
      selectionState={selectionState}
      selectedLabel={selectionState === "selected" ? value : null}
      onChangeSelected={() => {
        if (!keepText) setValue("");
        setSelectionState("editing");
      }}
      tokens={tokens}
      IconComponent={Icon}
      invoke={invoke}
      copy={copy}
    />
  );
}

/** Explorer's usage: no selection pill, no onChangeSelected. */
function ExplorerHost(): React.ReactElement {
  const [value, setValue] = React.useState("Lagos");
  return (
    <SharedField
      value={value}
      onChangeText={setValue}
      onPick={() => undefined}
      onClear={() => setValue("")}
      tokens={tokens}
      IconComponent={Icon}
      invoke={invoke}
      copy={copy}
      searchMode="places"
    />
  );
}

async function mount(element: React.ReactElement) {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  const input = (): HostNode | undefined =>
    tree.root.findAll(
      (n) => n.props.accessibilityRole === "combobox" && typeof n.props.onChangeText === "function",
    )[0];
  const call = async (name: string, ...args: unknown[]): Promise<void> => {
    await TestRenderer.act(() => {
      (input()!.props[name] as (...a: unknown[]) => void)(...args);
    });
  };
  const press = async (label: string): Promise<void> => {
    const button = tree.root.findAll(
      (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function",
    )[0];
    await TestRenderer.act(() => {
      (button.props.onPress as () => void)();
    });
  };
  return { tree, input, call, press };
}

describe("#4334 tester — Change address select-all", () => {
  test("CT-1 blur then refocus does not select all a second time", async () => {
    const f = await mount(<Host keepText />);
    await f.press("Change address");
    const first = f.input()!;
    expect(first.props.selectTextOnFocus).toBe(true);
    await f.call("onFocus");
    await f.call("onBlur");
    await f.call("onFocus");
    const again = f.input()!;
    expect(again.props.value).toBe(SAVED);
    expect(again.props.selectTextOnFocus).toBe(false);
    // Same input, not a remount (a remount would autoFocus and steal the caret).
    expect(again.props.autoFocus).toBe(true);
    await f.call("onChangeText", `${SAVED} 2`);
    expect(f.input()!.props.value).toBe(`${SAVED} 2`);
    expect(f.input()!.props.selectTextOnFocus).toBe(false);
    f.tree.unmount();
  });

  test("CT-2 a second Change address arms select-all again on a fresh input", async () => {
    const f = await mount(<Host keepText />);
    await f.press("Change address");
    await f.call("onChangeText", "5 Main");
    expect(f.input()!.props.selectTextOnFocus).toBe(false);
    await TestRenderer.act(() => {
      selectFromOutside!("5 Main Street, Ikeja");
    });
    expect(f.input()).toBeUndefined(); // pill again
    await f.press("Change address");
    const input = f.input()!;
    expect(input.props.value).toBe("5 Main Street, Ikeja");
    expect(input.props.autoFocus).toBe(true);
    expect(input.props.selectTextOnFocus).toBe(true);
    f.tree.unmount();
  });

  test("CT-3 a host that empties the field: typing works and ends the select-all", async () => {
    const f = await mount(<Host keepText={false} />);
    await f.press("Change address");
    expect(f.input()!.props.value).toBe("");
    expect(f.input()!.props.selectTextOnFocus).toBe(true);
    await f.call("onChangeText", "N");
    expect(f.input()!.props.value).toBe("N");
    expect(f.input()!.props.selectTextOnFocus).toBe(false);
    f.tree.unmount();
  });

  test("CT-4 Explorer's usage never selects all and never auto-focuses", async () => {
    const f = await mount(<ExplorerHost />);
    const seen: unknown[] = [];
    const look = () => {
      seen.push(f.input()!.props.selectTextOnFocus);
      expect(f.input()!.props.autoFocus).toBe(false);
    };
    look();
    await f.call("onFocus");
    look();
    await f.press("Clear");
    look();
    await f.call("onChangeText", "Lagos, Nig");
    look();
    await f.call("onBlur");
    look();
    expect(f.tree.root.findAll((n) => n.props.accessibilityLabel === "Change address")).toHaveLength(0);
    expect(seen).toEqual([false, false, false, false, false]);
    f.tree.unmount();
  });
});
