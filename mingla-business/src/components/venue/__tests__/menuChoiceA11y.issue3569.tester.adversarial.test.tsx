/**
 * Issue #3569 independent tester proof — deployed-web selected-state output.
 *
 * The implementor suite reads React Native props from react-test-renderer. This
 * suite takes a separate boundary: the real components and shared Button are
 * rendered through react-native-web, then assertions inspect the emitted HTML
 * a browser and assistive technology receive. It guards topology, names,
 * selected values, and 44px targets without importing the implementor test.
 */
import React from "react";

const renderToStaticMarkup = (
  require("react-dom/server") as {
    renderToStaticMarkup: (element: React.ReactElement) => string;
  }
).renderToStaticMarkup;
const { AppRegistry } = require("react-native-web") as {
  AppRegistry: {
    registerComponent: (
      name: string,
      component: () => () => React.ReactElement,
    ) => void;
    getApplication: (name: string) => {
      element: React.ReactElement;
      getStyleElement: () => React.ReactElement;
    };
  };
};

jest.mock("react-native", () => require("react-native-web"));
jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native-web");
  return {
    __esModule: true,
    default: { View },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});
jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: jest.fn() },
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { ScrollView } = require("react-native-web");
  return { ScrollView };
});
jest.mock("../../ui/Sheet", () => {
  const ReactLocal = require("react") as typeof React;
  const { View } = require("react-native-web");
  return {
    Sheet: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) =>
      visible ? ReactLocal.createElement(View, { testID }, children) : null,
  };
});
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/BrandSwitch", () => ({ BrandSwitch: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));

import { MenuCategorySheet } from "../MenuCategorySheet";
import { MenuItemSheet } from "../MenuItemSheet";
import { MenuModifierGroupEditor } from "../MenuModifierGroupEditor";

const openingTags = (markup: string, attribute: string): string[] =>
  markup.match(new RegExp(`<[^>]+${attribute}[^>]*>`, "g")) ?? [];

const labelledTag = (markup: string, label: string): string => {
  const encoded = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markup.match(new RegExp(`<[^>]+aria-label="${encoded}"[^>]*>`));
  if (match === null) throw new Error(`Missing emitted control: ${label}`);
  return match[0];
};

let renderCount = 0;
const renderWeb = (
  element: React.ReactElement,
): { markup: string; css: string } => {
  const name = `Issue3569_${renderCount++}`;
  AppRegistry.registerComponent(name, () => () => element);
  const app = AppRegistry.getApplication(name);
  return {
    markup: renderToStaticMarkup(app.element),
    css: renderToStaticMarkup(app.getStyleElement()),
  };
};

const expectMinimumTarget = (tag: string, css: string): void => {
  const classes = tag.match(/class="([^"]+)"/)?.[1]?.split(/\s+/) ?? [];
  const normalizedCss = css.replace(/\s+/g, "");
  const hasMinimum = classes.some((className) => {
    const encoded = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `\\.${encoded}\\{[^}]*min-height:(?:44px|2\\.75rem)`,
    ).test(normalizedCss);
  });
  expect(hasMinimum).toBe(true);
};

describe("issue #3569 tester adversarial — web selected-state topology", () => {
  test("service days emit seven independent checked checkboxes, not a radiogroup", () => {
    const { markup, css } = renderWeb(
      <MenuCategorySheet
        visible
        onClose={jest.fn()}
        category={null}
        onSave={jest.fn()}
        saving={false}
        saveFailed={false}
      />,
    );

    expect(markup).toContain('aria-label="Service days"');
    expect(markup).not.toContain('role="radiogroup"');
    const checkboxes = openingTags(markup, 'role="checkbox"');
    expect(checkboxes).toHaveLength(7);
    for (const tag of checkboxes) {
      expect(tag).toContain('aria-checked="true"');
      expectMinimumTarget(tag, css);
    }
  });

  test("nullable prep stations emit reversible unchecked toggle buttons", () => {
    const { markup, css } = renderWeb(
      <MenuItemSheet
        visible
        onClose={jest.fn()}
        item={null}
        currency="USD"
        brandHasCurrency
        onSave={jest.fn()}
        saving={false}
      />,
    );

    for (const label of ["Kitchen", "Bar", "Somewhere else"]) {
      const tag = labelledTag(markup, label);
      expect(tag).toContain('role="togglebutton"');
      expect(tag).toContain('aria-checked="false"');
      expectMinimumTarget(tag, css);
    }
  });

  test("pick mode emits one two-radio group and required stays outside it", () => {
    const { markup, css } = renderWeb(
      <MenuModifierGroupEditor
        menuItemId="item-1"
        group={null}
        currency="USD"
        nextSortOrder={0}
        onSave={jest.fn()}
        saving={false}
        onCancel={jest.fn()}
      />,
    );

    const groups = openingTags(markup, 'role="radiogroup"');
    const radios = openingTags(markup, 'role="radio"');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain(
      'aria-label="How many options can guests pick?"',
    );
    expect(radios).toHaveLength(2);
    expect(labelledTag(markup, "Pick one")).toContain('aria-checked="true"');
    expect(labelledTag(markup, "Pick several")).toContain(
      'aria-checked="false"',
    );
    expectMinimumTarget(labelledTag(markup, "Pick one"), css);
    expectMinimumTarget(labelledTag(markup, "Pick several"), css);

    const required = labelledTag(markup, "Options required");
    expect(required).toContain('role="togglebutton"');
    expect(required).toContain('aria-checked="true"');
    expectMinimumTarget(required, css);
  });
});
