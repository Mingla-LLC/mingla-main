#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const paths = {
  shell: "mingla-business/src/components/stay/StaySuiteShell.tsx",
  actionBar: "mingla-business/src/components/stay/StayActionBar.tsx",
  renderTest:
    "mingla-business/src/components/stay/__tests__/stayLifecycleLayout.issue1944.render.test.tsx",
  jestConfig: "mingla-business/jest.issue1944.render.cjs",
};

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbid(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

export function check(files) {
  const failures = [];
  const shell = files.shell ?? "";
  const actionBar = files.actionBar ?? "";
  const renderTest = files.renderTest ?? "";
  const jestConfig = files.jestConfig ?? "";

  for (const token of [
    'settings?.booking_state === "active" && liveSupply',
    "Manage your live Stay",
    'testID="stay-live-management"',
    'testID="stay-management-grid"',
    "!isActive && isWideDesktop",
    "!isActive && !isWideDesktop",
    'testID="stay-overview-action-bar"',
    'testID="stay-settings-action-bar"',
    'testID="stay-settings-scroll"',
    'testID="stay-settings-save"',
  ]) {
    need(shell, token, "Stay lifecycle/layout shell", failures);
  }
  forbid(
    shell,
    'label={isActive ? "Stay is live" : "Publish Stay"}',
    "live Stay publish pseudo-action",
    failures,
  );

  for (const token of [
    'position: "absolute"',
    "useSafeAreaInsets",
    "useKeyboardIsVisible",
    "if (keyboardVisible) return null",
    "paddingBottom: insets.bottom + spacing.md",
  ]) {
    need(actionBar, token, "native/narrow pinned action contract", failures);
  }

  for (const token of [
    "[1024, 1440, 1920]",
    "suiteFormMaxWidth",
    'hasAncestor(save as RenderTreeNode, "stay-settings-scroll")',
    'byTestId(tree, "stay-settings-action-bar")',
    'byTestId(tree, "stay-overview-action-bar")',
    'byTestId(tree, "stay-publish")',
    '"Manage your live Stay"',
    '"Ready to publish"',
    "mockSavePending = true",
    "mockSaveError = true",
  ]) {
    need(renderTest, token, "append-only issue #1944 render proof", failures);
  }
  need(
    jestConfig,
    "stayLifecycleLayout.issue1944.render.test.tsx",
    "issue #1944 Jest registration",
    failures,
  );

  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(paths).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const valid = readFiles();
  const baseline = check(valid);
  if (baseline.length > 0) {
    throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  }
  const reversions = [
    [
      "shell",
      "Manage your live Stay",
      "Ready to publish",
      "Manage your live Stay",
    ],
    [
      "shell",
      "!isActive && isWideDesktop",
      "!isActive",
      "!isActive && isWideDesktop",
    ],
    [
      "shell",
      "!isActive && !isWideDesktop",
      "!isActive",
      "!isActive && !isWideDesktop",
    ],
    [
      "actionBar",
      "if (keyboardVisible) return null",
      "",
      "if (keyboardVisible) return null",
    ],
    ["renderTest", "[1024, 1440, 1920]", "[1440]", "[1024, 1440, 1920]"],
  ];
  for (const [key, from, to, expected] of reversions) {
    const broken = { ...valid, [key]: valid[key].replace(from, to) };
    if (!check(broken).some((failure) => failure.includes(expected))) {
      throw new Error(`true-source reversion escaped: ${expected}`);
    }
  }
  console.log(
    `issue-1944 Stay live layout self-test: PASS (${reversions.length} reversions)`,
  );
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = check(readFiles());
  if (failures.length > 0) {
    console.error("I-1944-STAY-LIVE-LAYOUT violated:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    "I-1944-STAY-LIVE-LAYOUT: PASS (lifecycle, desktop flow, native pin, render proof)",
  );
}
