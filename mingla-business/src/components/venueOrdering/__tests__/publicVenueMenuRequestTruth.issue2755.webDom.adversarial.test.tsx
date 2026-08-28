/**
 * Issue #2755 tester-owned real RN Web markup guard.
 *
 * React test-renderer proves the shared screen passes an aria-disabled prop,
 * but RN Web's Pressable is the authority that creates browser markup. This
 * guard rejects the exact production mapping that silently drops the required
 * disabled semantic while retaining aria-busy and focusability.
 */

import React from "react";

const reactNativeWeb = require("react-native-web") as {
  Pressable: React.ComponentType<{
    children?: React.ReactNode;
    [key: string]: unknown;
  }>;
  Text: React.ComponentType<{ children?: React.ReactNode }>;
};
const renderToStaticMarkup = (
  require("react-dom/server") as {
    renderToStaticMarkup: (element: React.ReactElement) => string;
  }
).renderToStaticMarkup;

test("busy Retry reaches actual web markup as aria-disabled and aria-busy without native disabled", () => {
  const markup = renderToStaticMarkup(
    <reactNativeWeb.Pressable
      accessibilityRole="button"
      accessibilityLabel="Try loading the menu again"
      accessibilityState={{ disabled: true, busy: true }}
      aria-disabled={true}
      aria-busy={true}
      disabled={undefined}
    >
      <reactNativeWeb.Text>Try again</reactNativeWeb.Text>
    </reactNativeWeb.Pressable>,
  );

  expect(markup).toContain('aria-busy="true"');
  expect(markup).toContain('aria-disabled="true"');
  expect(markup).not.toContain(" disabled");
});
