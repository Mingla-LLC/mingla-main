/**
 * Issue #2755 tester-owned raw RN Web negative control.
 *
 * [TEST-MOD-APPROVED #2755] This deliberately mounts no Mingla product code.
 * It documents why direct props cannot satisfy the contract: RN Web's
 * Pressable overwrites aria-disabled from its undefined `disabled` prop. The
 * product-mounted guard owns the post-commit host correction.
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

test("raw RN Web Pressable drops direct aria-disabled and proves a host correction is required", () => {
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
  expect(markup).not.toContain('aria-disabled="true"');
  expect(markup).not.toContain(" disabled");
});
