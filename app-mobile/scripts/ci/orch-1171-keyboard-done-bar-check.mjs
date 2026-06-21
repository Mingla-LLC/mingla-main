#!/usr/bin/env node
/**
 * ORCH-1171 — consumer keyboard Done bar CI gate.
 * Fails if root/modal keyboard hosts or clearance constants regress.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const checks = [
  {
    name: "app/_layout KeyboardRoot + KeyboardToolbarRoot",
    pass: () => {
      const s = read("app/_layout.tsx");
      return (
        /KeyboardRoot/.test(s) &&
        /KeyboardToolbarRoot/.test(s) &&
        /react-native-keyboard-controller/.test(read("package.json"))
      );
    },
  },
  {
    name: "BaseBottomSheet per-modal KeyboardRoot",
    pass: () => {
      const s = read("src/components/ui/BaseBottomSheet.tsx");
      return /<KeyboardRoot>/.test(s) && /wrapInRNModal/.test(s);
    },
  },
  {
    name: "keyboardConstants KEYBOARD_TOOLBAR_HEIGHT = 42",
    pass: () => {
      const s = read("src/wrappers/keyboardConstants.ts");
      return /KEYBOARD_TOOLBAR_HEIGHT = 42/.test(s);
    },
  },
  {
    name: "withGooglePodsModularHeaders plugin registered",
    pass: () =>
      read("app.config.ts").includes('"./plugins/withGooglePodsModularHeaders"') &&
      fs.existsSync(path.join(ROOT, "plugins/withGooglePodsModularHeaders.js")),
  },
  {
    name: "CountryPickerModal per-window KeyboardProvider",
    pass: () => {
      const s = read("../packages/phone-input/CountryPickerModal.tsx");
      return /<KeyboardProvider>/.test(s) && /<KeyboardToolbar/.test(s);
    },
  },
];

let failed = 0;
for (const c of checks) {
  if (c.pass()) {
    console.log(`OK   ${c.name}`);
  } else {
    console.error(`FAIL ${c.name}`);
    failed += 1;
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`ORCH-1171 keyboard gate: ${checks.length}/${checks.length} passed`);
