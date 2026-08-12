#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const shellPath = "mingla-business/src/components/stay/StaySuiteShell.tsx";
const actionBarPath = "mingla-business/src/components/stay/StayActionBar.tsx";

function requireToken(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function requireOrder(source, first, second, label, failures) {
  const firstAt = source.indexOf(first);
  const secondAt = source.indexOf(second);
  if (firstAt < 0 || secondAt < 0 || firstAt >= secondAt) {
    failures.push(`${label}: expected ${first} before ${second}`);
  }
}

export function check(files) {
  const failures = [];
  const shell = files.shell ?? "";
  const actionBar = files.actionBar ?? "";
  const settingsSection = shell.slice(
    shell.indexOf("function StaySettings("),
    shell.indexOf("function Field("),
  );

  // Authoritative lifecycle: neither booking state nor supply alone can claim Live.
  requireToken(
    shell,
    'settings?.booking_state === "active" && liveSupply',
    "authoritative active-state conjunction",
    failures,
  );
  requireOrder(
    shell,
    "{isActive ? (",
    '<Text style={styles.cardTitle}>Ready to publish</Text>',
    "live management branch must precede the not-live readiness branch",
    failures,
  );
  requireToken(
    settingsSection,
    "seededVersionRef.current === settings.version",
    "same-version refetch must not overwrite an in-progress form",
    failures,
  );

  // Desktop reachability: the terminal field remains before an in-flow save,
  // and the 720px page style contains no overlay positioning primitive.
  requireOrder(
    settingsSection,
    'testID="stay-settings-rules"',
    "{isWideDesktop ? (",
    "terminal field must remain reachable before desktop save",
    failures,
  );
  requireOrder(
    shell,
    'testID="stay-settings-scroll"',
    'testID="stay-settings-save"',
    "desktop save must stay inside the scroll flow",
    failures,
  );
  const pageForm = shell.match(/pageForm:\s*\{([\s\S]*?)\n\s*\},/u)?.[1] ?? "";
  requireToken(pageForm, "maxWidth: suiteFormMaxWidth", "desktop readable measure", failures);
  for (const forbidden of ['position: "absolute"', 'position: "fixed"', 'position: "sticky"']) {
    if (pageForm.includes(forbidden)) failures.push(`desktop page overlay forbidden: ${forbidden}`);
  }

  // Native/narrow parity: safe area plus keyboard suppression remain owned by
  // the pinned component rather than being approximated at a call site.
  for (const token of [
    "if (keyboardVisible) return null",
    "paddingBottom: insets.bottom + spacing.md",
    'position: "absolute"',
    "bottom: 0",
  ]) {
    requireToken(actionBar, token, "native keyboard/safe-area action", failures);
  }

  // Invalid/pending/error/retry semantics: validity owns disabled state,
  // pending owns loading, errors stay visible, and the same enabled button
  // keeps submit wired so a failed save can be retried.
  for (const token of [
    "if (!valid) return",
    "disabled={!valid}",
    "loading={save.isPending}",
    "{save.isError ? (",
    "onPress={submit}",
  ]) {
    requireToken(shell, token, "save-state contract", failures);
  }

  // Accessibility remains semantic at 200% zoom / Dynamic Type: management
  // destinations are buttons and the editable terminal field has a label.
  requireToken(shell, 'accessibilityRole="button"', "management keyboard navigation", failures);
  requireToken(shell, "accessibilityLabel={label}", "form-field accessible name", failures);

  return failures;
}

function readFiles() {
  return {
    shell: fs.readFileSync(path.join(root, shellPath), "utf8"),
    actionBar: fs.readFileSync(path.join(root, actionBarPath), "utf8"),
  };
}

function selfTest() {
  const valid = readFiles();
  const baseline = check(valid);
  if (baseline.length > 0) throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  const reversions = [
    ["shell", 'settings?.booking_state === "active" && liveSupply', 'settings?.booking_state === "active"', "authoritative active-state conjunction"],
    ["shell", "seededVersionRef.current === settings.version", "seededVersionRef.current === null", "same-version refetch"],
    ["shell", 'testID="stay-settings-rules"', 'testID="stay-settings-rules-moved"', "terminal field"],
    ["actionBar", "if (keyboardVisible) return null", "", "native keyboard/safe-area action"],
    ["shell", "disabled={!valid}", "disabled={false}", "save-state contract"],
  ];
  for (const [key, from, to, expected] of reversions) {
    const broken = {
      ...valid,
      [key]: expected === "save-state contract"
        ? valid[key].split(from).join(to)
        : valid[key].replace(from, to),
    };
    if (!check(broken).some((failure) => failure.includes(expected))) {
      throw new Error(`true-source reversion escaped: ${expected}`);
    }
  }
  console.log(`issue-1944 tester adversarial self-test: PASS (${reversions.length} reversions)`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = check(readFiles());
  if (failures.length > 0) {
    console.error("I-1944-STAY-LIFECYCLE-ADVERSARIAL violated:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log("I-1944-STAY-LIFECYCLE-ADVERSARIAL: PASS");
}
