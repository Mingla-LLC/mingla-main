import React from "react";
import { Platform } from "react-native";
import { RecentStatePanel } from "../../../src/components/home/RecentStatePanel";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (callback: () => void) => void;

test("Recent recovery CTA exposes and clears a visible web keyboard focus ring", () => {
  const originalPlatform = Platform.OS;
  Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
  let tree: any;
  act(() => {
    tree = TestRenderer.create(
      <RecentStatePanel
        title="Nothing recent yet"
        description="Open something to begin."
        cta={{ label: "Browse", onPress: jest.fn() }}
      />,
    );
  });
  const cta = tree.root.findByProps({ testID: "recent-state-cta" });

  act(() => cta.props.onFocus());
  expect(cta.props.style({ pressed: false })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ borderWidth: 2 }),
    ]),
  );

  act(() => cta.props.onBlur());
  expect(cta.props.style({ pressed: false })).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ borderWidth: 2 }),
    ]),
  );
  tree.unmount();
  Object.defineProperty(Platform, "OS", {
    value: originalPlatform,
    configurable: true,
  });
});
