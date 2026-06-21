/**
 * ORCH-1171 — consumer keyboard Done-bar mount-coverage regression test.
 *
 * Run: node src/wrappers/__tests__/orch_1171_keyboard_toolbar_mount_coverage.test.mjs
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const read = (relativePath) =>
  fs.readFileSync(path.join(MOBILE_ROOT, relativePath), "utf8");

describe("ORCH-1171 Done-bar mount coverage (consumer)", () => {
  const HOSTS = [
    { label: "app root", rel: "app/_layout.tsx" },
    {
      label: "BaseBottomSheet wrapInRNModal host",
      rel: "src/components/ui/BaseBottomSheet.tsx",
    },
  ];

  for (const { label, rel } of HOSTS) {
    it(`${label} imports AND renders KeyboardToolbarRoot`, () => {
      const src = read(rel);
      assert.match(
        src,
        /import\s*\{\s*KeyboardToolbarRoot\s*\}\s*from\s*["'][^"']*KeyboardToolbarRoot["']/,
      );
      const withoutImports = src
        .split("\n")
        .filter((l) => !/^\s*import\b/.test(l))
        .join("\n");
      assert.match(withoutImports, /<KeyboardToolbarRoot\s*\/?>/);
    });
  }

  it("app root nests KeyboardToolbarRoot inside KeyboardRoot", () => {
    const src = read("app/_layout.tsx");
    assert.match(
      src,
      /import\s*\{\s*KeyboardRoot\s*\}\s*from\s*["'][^"']*KeyboardRoot["']/,
    );
    const withoutImports = src
      .split("\n")
      .filter((l) => !/^\s*import\b/.test(l))
      .join("\n");
    assert.match(withoutImports, /<KeyboardRoot\b[^>]*>/);
    assert.match(withoutImports, /<KeyboardToolbarRoot\s*\/?>/);
  });

  it("BaseBottomSheet wrapInRNModal nests toolbar inside per-window KeyboardRoot", () => {
    const src = read("src/components/ui/BaseBottomSheet.tsx");
    assert.match(
      src,
      /import\s*\{\s*KeyboardRoot\s*\}\s*from\s*["'][^"']*KeyboardRoot["']/,
    );
    const modalBlock = src.slice(src.indexOf("if (wrapInRNModal)"));
    assert.match(modalBlock, /<KeyboardRoot\b[^>]*>/);
    assert.match(modalBlock, /<KeyboardToolbarRoot\s*\/?>/);
  });

  it("KeyboardAwareScrollView clearance includes toolbar height constants", () => {
    const kas = read("src/components/ui/KeyboardAwareScrollView.tsx");
    assert.match(kas, /KEYBOARD_TOOLBAR_HEIGHT/);
    assert.match(kas, /KEYBOARD_CLEARANCE_ABOVE_TOOLBAR/);
  });

  it("MessageInterface lifts composer by KEYBOARD_TOOLBAR_HEIGHT when keyboard open", () => {
    const chat = read("src/components/MessageInterface.tsx");
    assert.match(chat, /keyboardHeight\s*\+\s*KEYBOARD_TOOLBAR_HEIGHT/);
  });

  it("KeyboardToolbarRoot native uses showArrows={false} and brand primary color", () => {
    const toolbar = read("src/wrappers/KeyboardToolbarRoot.native.tsx");
    assert.match(toolbar, /showArrows=\{false\}/);
    assert.match(toolbar, /colors\.primary/);
  });

  it("app.config registers withGooglePodsModularHeaders plugin", () => {
    const cfg = read("app.config.ts");
    assert.match(cfg, /"\.\/plugins\/withGooglePodsModularHeaders"/);
  });

  it("package.json declares react-native-keyboard-controller", () => {
    const pkg = read("package.json");
    assert.match(pkg, /"react-native-keyboard-controller"/);
  });
});
