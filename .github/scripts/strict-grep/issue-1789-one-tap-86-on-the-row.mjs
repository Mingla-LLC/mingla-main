#!/usr/bin/env node
/**
 * Issue #1789 (#1767 Phase 1) — ONE-TAP 86, ON THE ROW.
 *
 * SPEC #1788 P-15 / DESIGN D-6. The `menu_items.is_available` flag always
 * existed and flipping it removes the dish from the public menu on the very
 * next read. What was missing was a CONTROL: it sat ~5 taps behind
 * `MenuItemSheet`'s full edit form, which is five taps too many when the
 * kitchen runs out mid-service.
 *
 * This is a STRUCTURAL rule, so it is a gate rather than a jest pin — the
 * shape it guards is source shape, and a source-only jest assertion is exactly
 * what I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN forbids. The BEHAVIOURAL half
 * (grouping, printing, validation) is proven in
 * `mingla-business/src/components/venue/__tests__/qrSpots.issue1789.test.ts`.
 *
 * Four assertions on `VenueMenuModule.tsx`, each of which fails loudly if the
 * control regresses to what it replaced:
 *
 *   1. A per-item toggle testID exists on the ROW.
 *   2. The handler flips exactly ONE bit through the EXISTING upsert
 *      (`isAvailable: !item.isAvailable`) — no new write path, no new RLS
 *      surface, and no restating of the whole row.
 *   3. The control carries `accessibilityRole="switch"` — a 86 toggle that
 *      announces itself as a button lies to a screen reader about its state.
 *   4. It is manager-plus gated in the UI (`canMutate`), matching the RLS
 *      floor the OQ-4 ruling deliberately held: 86 changes what guests can
 *      buy, so it is not relaxed to any brand member.
 *
 * Supports `--self-test` (no repo scan; GOOD + BAD fixtures).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const TARGET = "mingla-business/src/components/venue/VenueMenuModule.tsx";

const CHECKS = [
  {
    id: "row-toggle-testid",
    re: /venue-menu-item-86-\$\{item\.id\}/,
    why:
      "no per-item 86 toggle on the menu row — 86'ing a dish is back to ~5 taps " +
      "inside the edit form (SPEC #1788 P-15).",
  },
  {
    id: "one-bit-flip",
    re: /isAvailable:\s*!item\.isAvailable/,
    why:
      "the 86 control no longer flips exactly one bit through the existing " +
      "upsert — a second write path is a second RLS surface (SPEC #1788 P-15).",
  },
  {
    id: "switch-role",
    re: /accessibilityRole="switch"/,
    why:
      "the 86 control does not announce itself as a switch, so a screen reader " +
      "cannot tell whether the dish is on or off the menu.",
  },
  {
    id: "manager-plus",
    re: /canMutate\s*\?\s*\(\s*<Pressable/,
    why:
      "the 86 control is not manager-plus gated in the UI. The OQ-4 ruling held " +
      "86 at the event_manager floor on purpose: it changes what guests can buy.",
  },
];

const scan = (label, code, failures) => {
  for (const check of CHECKS) {
    if (!check.re.test(code)) {
      failures.push(`${label}: [${check.id}] ${check.why}`);
    }
  }
};

const GOOD_FIXTURE = `
  {canMutate ? (
    <Pressable
      onPress={() => toggle86(menu, item)}
      accessibilityRole="switch"
      accessibilityState={{ checked: item.isAvailable }}
      testID={\`venue-menu-item-86-\${item.id}\`}
    >
      <Text>On</Text>
    </Pressable>
  ) : null}
  upsertItem.mutate({ id: item.id, isAvailable: !item.isAvailable });
`;

// The exact regression this gate exists to catch: the toggle demoted back into
// the edit form, leaving the row with a dead indicator dot.
const BAD_FIXTURE_NO_ROW_CONTROL = `
  <View style={styles.availabilityDot} />
  upsertItem.mutate({ id: item.id, isAvailable: !item.isAvailable });
  <Pressable accessibilityRole="switch" />
  {canMutate ? (<Pressable onPress={openEditItem} />) : null}
`;

// A toggle that announces itself as a button lies about its state.
const BAD_FIXTURE_WRONG_ROLE = `
  {canMutate ? (
    <Pressable
      onPress={() => toggle86(menu, item)}
      accessibilityRole="button"
      testID={\`venue-menu-item-86-\${item.id}\`}
    />
  ) : null}
  upsertItem.mutate({ id: item.id, isAvailable: !item.isAvailable });
`;

if (process.argv.includes("--self-test")) {
  const cases = [];

  const good = [];
  scan("self-test-good", GOOD_FIXTURE, good);
  cases.push(["the shipped shape passes", good.length === 0]);

  const bad1 = [];
  scan("self-test-bad-1", BAD_FIXTURE_NO_ROW_CONTROL, bad1);
  cases.push([
    "a row with no 86 toggle fails",
    bad1.some((f) => f.includes("row-toggle-testid")),
  ]);

  const bad2 = [];
  scan("self-test-bad-2", BAD_FIXTURE_WRONG_ROLE, bad2);
  cases.push([
    "a toggle that announces itself as a button fails",
    bad2.some((f) => f.includes("switch-role")),
  ]);

  const bad3 = [];
  scan("self-test-bad-3", GOOD_FIXTURE.replace(/!item\.isAvailable/, "false"), bad3);
  cases.push([
    "a control that stops flipping the existing bit fails",
    bad3.some((f) => f.includes("one-bit-flip")),
  ]);

  // Anti-vacuity: a missing target is a failure, never a silent pass.
  cases.push([
    "a missing target file fails",
    !existsSync(join(root, "mingla-business/src/components/venue/__NoSuchModule.tsx")),
  ]);

  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error("issue-1789 one-tap-86 gate self-test FAILED:");
    for (const [name] of failed) console.error(`- ${name}`);
    process.exit(1);
  }
  console.log(
    `issue-1789 one-tap-86 gate self-test passed (${cases.length}/${cases.length}).`,
  );
  process.exit(0);
}

const failures = [];
const abs = join(root, TARGET);
if (!existsSync(abs)) {
  failures.push(`${TARGET}: missing — the venue menu builder must exist.`);
} else {
  scan(TARGET, readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error("issue-1789 one-tap-86-on-the-row gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("issue-1789 one-tap-86-on-the-row gate passed.");
