/**
 * #4334 — "Change address" then typing replaces the saved address; it never
 * joins old and new text together.
 *
 * Cause: tapping the selected-address pill's X ("Change address") hands the
 * field back in editing mode with the saved address still in it (every Host
 * host keeps the text so backing out loses nothing: CreatorStep3Where,
 * BrandEditAddressField) and remounts the input with autoFocus. Nothing
 * selected that text, so the caret sat at its end on iOS, Android and web and
 * the host's first keystrokes were appended ("61 Wythe Avenue, Brooklyn5 Main").
 *
 * Fix: the handed-back text is selected on that focus (selectTextOnFocus, which
 * RN implements natively on iOS/Android and react-native-web implements with
 * input.select()), so the first keystroke replaces it. Once the host types,
 * clears or leaves the field it is ordinary text again (tapping later places
 * the caret normally).
 *
 * Driven through the REAL shared field with a stateful host harness that
 * behaves like CreatorStep3Where.
 *
 * Fails-on-revert: delete `selectTextOnFocus={selectAllOnFocus}` from
 * packages/location-input/src/AddressInput.tsx (or the setSelectAllOnFocus(true)
 * in handleChangeSelected) → C-1 red.
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

type HostNode = { type: unknown; props: Record<string, unknown> };
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

const SAVED = "61 Wythe Avenue, Brooklyn";

/** Behaves like CreatorStep3Where: "Change address" keeps the text. */
function Host({ initialState }: { initialState: LocationSelectionState }): React.ReactElement {
  const [value, setValue] = React.useState(SAVED);
  const [selectionState, setSelectionState] = React.useState(initialState);
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
      selectedLabel={value}
      onChangeSelected={() => setSelectionState("editing")}
      tokens={tokens}
      IconComponent={Icon}
      invoke={invoke}
      copy={copy}
    />
  );
}

async function mount(initialState: LocationSelectionState) {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(<Host initialState={initialState} />);
  });
  const input = (): HostNode =>
    tree.root.findAll(
      (n) => n.props.accessibilityRole === "combobox" && typeof n.props.onChangeText === "function",
    )[0];
  const press = async (label: string): Promise<void> => {
    const button = tree.root.findAll(
      (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function",
    )[0];
    await TestRenderer.act(() => {
      (button.props.onPress as () => void)();
    });
  };
  return { tree, input, press };
}

describe("#4334 — Change address, then type", () => {
  test("C-1 the handed-back address is focused and selected, so typing replaces it", async () => {
    const f = await mount("selected");
    expect(f.input()).toBeUndefined(); // the selected pill shows, no input yet
    await f.press("Change address");
    const input = f.input();
    expect(input.props.value).toBe(SAVED);
    expect(input.props.autoFocus).toBe(true);
    expect(input.props.selectTextOnFocus).toBe(true);

    // The platform replaces the selected text with the keystroke.
    await TestRenderer.act(() => {
      (f.input().props.onChangeText as (v: string) => void)("5");
    });
    expect(f.input().props.value).toBe("5");
    // From here it is ordinary text: a later focus places the caret.
    expect(f.input().props.selectTextOnFocus).toBe(false);
  });

  test("C-2 leaving the field ends the select-all; Clear still empties it", async () => {
    const f = await mount("selected");
    await f.press("Change address");
    await TestRenderer.act(() => {
      (f.input().props.onBlur as () => void)();
    });
    expect(f.input().props.selectTextOnFocus).toBe(false);
    await f.press("Clear");
    expect(f.input().props.value).toBe("");
    expect(f.input().props.selectTextOnFocus).toBe(false);
  });

  test("C-3 a field that was never handed back does not select on focus", async () => {
    const f = await mount("editing");
    expect(f.input().props.value).toBe(SAVED);
    expect(f.input().props.selectTextOnFocus).toBe(false);
    expect(f.input().props.autoFocus).toBe(false);
  });
});
