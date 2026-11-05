/**
 * #4271 phase 2 — Tap to Pay on iPhone surfaces, rendered. Pure rules live in
 * src/services/terminal/__tests__/issue_4271_apple_requirements.implementor.test.ts.
 * Every test here fails when its change is reverted (recorded on the issue).
 */
import React from "react";
import { Linking } from "react-native";

// react-test-renderer ships no types in this app.
interface ReactTestInstance {
  type: unknown;
  props: Record<string, any>;
  children: (ReactTestInstance | string)[];
  findAll: (predicate: (node: ReactTestInstance) => boolean) => ReactTestInstance[];
}
interface ReactTestRenderer {
  root: ReactTestInstance;
}
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  return {
    Button: (props: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) =>
      ReactLocal.createElement(
        Pressable,
        { onPress: props.onPress, disabled: props.disabled, testID: props.testID },
        ReactLocal.createElement(Text, null, props.label),
      ),
  };
});

import { TapUpdateIos } from "../tap/TapUpdateIos";

const mount = (element: React.ReactElement): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(element);
  });
  return tree as ReactTestRenderer;
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");

const byTestId = (root: ReactTestInstance, id: string): ReactTestInstance =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0] as ReactTestInstance;

describe("B2 iOS update screen", () => {
  test("says what to do, opens Settings and keeps the pay code", () => {
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    const onUsePayCode = jest.fn();
    const { root } = mount(<TapUpdateIos onUsePayCode={onUsePayCode} />);
    const text = textOf(root);
    expect(text).toContain("Update iOS to use Tap to Pay on iPhone");
    expect(text).toContain("Tap to Pay on iPhone needs iOS 17.6 or later.");
    act(() => {
      byTestId(root, "tap-update-open-settings").props.onPress();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
    act(() => {
      byTestId(root, "tap-update-pay-code").props.onPress();
    });
    expect(onUsePayCode).toHaveBeenCalledTimes(1);
  });
});
