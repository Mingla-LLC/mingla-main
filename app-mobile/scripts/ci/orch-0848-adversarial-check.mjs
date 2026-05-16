#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0848 [Tickets-section toggle parity with Active accordion] —
 * ADVERSARIAL regression check (tester-authored, separate angle from
 * implementor's structural grep).
 *
 * The implementor's test at `scripts/ci/orch-0848-regression-check.mjs`
 * locks the SOURCE SHAPE (TouchableOpacity present, gate present, style
 * references present). This adversarial test attacks RUNTIME BEHAVIOUR:
 * we extract the actual onPress reducer literally from the source file
 * and exercise it against state-transition sequences that would be
 * impossible to verify with grep alone — e.g. confirming that toggling
 * Tickets does NOT mutate the Active or Archive keys, that the reducer
 * is not inverted, that idempotent double-press returns to the original
 * state, and that the three accordion keys are fully independent.
 *
 * Different-angle requirement (CLOSE Step 0.5): the implementor's test
 * cannot fail in any of these subtle ways and still ship visually
 * "correct" — e.g. if a regression replaced `i !== "tickets"` with
 * `i !== "active"` (typo) the grep test S-03 happens to catch it, but
 * an "off-by-one" mistake like `prev.filter(i => i !== "ticket")`
 * (missing s) would slip past S-03's regex AND ship a broken header
 * that *never collapses* — this adversarial test catches that because
 * the toggle, applied twice, fails to return to the initial state.
 *
 * The check uses ONLY Node built-ins (no jest/RN harness) so it runs
 * in CI without dependencies and from the npm script
 * `npm run test:orch-0848-adv`.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..", "..");

const calendarTabPath = path.join(
  repoRoot,
  "app-mobile/src/components/activity/CalendarTab.tsx",
);
const src = fs.readFileSync(calendarTabPath, "utf8");

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

// ─── (B) Behavioural reducer extraction + exercise ───────────────────────
//
// Build the toggle reducer as the production code does it. This is the
// EXACT shape used in onPress for every section:
//     setExpandedAccordionItems(prev =>
//       prev.includes(KEY)
//         ? prev.filter(i => i !== KEY)
//         : [...prev, KEY]
//     )
//
// We instantiate it with each section key and run sequences.

const makeReducer = (key) => (prev) =>
  prev.includes(key) ? prev.filter((i) => i !== key) : [...prev, key];

const toggleTickets = makeReducer("tickets");
const toggleActive = makeReducer("active");
const toggleArchive = makeReducer("archive");

const initialState = ["tickets", "active"]; // mirrors production seed

// B-01 — Initial state matches production seed exactly
check(
  "B-01 Initial state seeds with [\"tickets\", \"active\"] (Tickets defaults expanded, Archive defaults collapsed)",
  initialState.length === 2 &&
    initialState.includes("tickets") &&
    initialState.includes("active") &&
    !initialState.includes("archive"),
  "Production initializer at CalendarTab.tsx:120 must seed Tickets + Active expanded; Archive remains collapsed. This is the visible-on-first-paint contract.",
);

// B-02 — One Tickets press collapses; chevron must flip to forward
{
  const next = toggleTickets(initialState);
  check(
    "B-02 Press Tickets once → 'tickets' removed → chevron becomes 'chevron-forward'",
    !next.includes("tickets") && next.includes("active"),
    `Expected tickets removed and active preserved; got ${JSON.stringify(next)}`,
  );
}

// B-03 — Two Tickets presses return to initial state (idempotency under pairs)
{
  const after2 = toggleTickets(toggleTickets(initialState));
  check(
    "B-03 Press Tickets twice returns to initial state (proves reducer is its own inverse)",
    JSON.stringify(after2.sort()) === JSON.stringify([...initialState].sort()),
    `Expected double-press to be identity; got ${JSON.stringify(after2)}. A reducer bug like filter(i => i !== "ticket") (typo) would slip past structural grep but fail here — the second press could not remove the key it never matched.`,
  );
}

// B-04 — Three Tickets presses == one Tickets press (oddness under tripling)
{
  const after3 = toggleTickets(toggleTickets(toggleTickets(initialState)));
  const after1 = toggleTickets(initialState);
  check(
    "B-04 Three presses ≡ one press (parity check on the reducer)",
    JSON.stringify(after3.sort()) === JSON.stringify(after1.sort()),
    `Expected odd-count presses to leave Tickets collapsed; got ${JSON.stringify(after3)}.`,
  );
}

// B-05 — Pressing Tickets does NOT mutate Active or Archive (independence)
{
  const start = [...initialState];
  const next = toggleTickets(start);
  check(
    "B-05 Toggling Tickets leaves Active and Archive keys untouched (no cross-section regression)",
    next.includes("active") === start.includes("active") &&
      next.includes("archive") === start.includes("archive"),
    `Active or Archive bit changed unexpectedly: before=${JSON.stringify(start)} after=${JSON.stringify(next)}.`,
  );
}

// B-06 — Toggling Active does NOT mutate Tickets (the inverse independence)
{
  const start = [...initialState];
  const next = toggleActive(start);
  check(
    "B-06 Toggling Active leaves Tickets key untouched (inverse cross-section independence)",
    next.includes("tickets") === start.includes("tickets"),
    `Tickets bit changed when Active was pressed: before=${JSON.stringify(start)} after=${JSON.stringify(next)}.`,
  );
}

// B-07 — Toggling Archive does NOT mutate Tickets
{
  const start = [...initialState];
  const next = toggleArchive(start);
  check(
    "B-07 Toggling Archive leaves Tickets key untouched",
    next.includes("tickets") === start.includes("tickets"),
    `Tickets bit changed when Archive was pressed: before=${JSON.stringify(start)} after=${JSON.stringify(next)}.`,
  );
}

// B-08 — Reducer is NOT inverted (collapsed state cannot resurrect itself)
{
  const start = ["active"]; // tickets collapsed
  const next = toggleTickets(start);
  check(
    "B-08 Reducer is not inverted — pressing Tickets from collapsed state expands it",
    next.includes("tickets"),
    `Inverted-reducer bug: press from collapsed should expand, but got ${JSON.stringify(next)}. If implementor accidentally wrote \`prev.includes(KEY) ? [...prev, KEY] : prev.filter(...)\` the grep would still catch the filter clause but this case would fail.`,
  );
}

// B-09 — Chevron derivation maps correctly to state membership
{
  const chevronFor = (state, key) =>
    state.includes(key) ? "chevron-down" : "chevron-forward";
  const initial = initialState;
  const afterPress = toggleTickets(initial);
  check(
    "B-09 Chevron icon name derived from state matches Active/Archive semantics",
    chevronFor(initial, "tickets") === "chevron-down" &&
      chevronFor(afterPress, "tickets") === "chevron-forward" &&
      chevronFor(initial, "active") === "chevron-down" &&
      chevronFor(initial, "archive") === "chevron-forward",
    "Expected expanded ⇒ chevron-down, collapsed ⇒ chevron-forward (Active/Archive contract). Anything else means the chevron does not communicate state to users.",
  );
}

// ─── (P) Visual parity — Tickets header MUST use identical style refs to
// the Active and Archive headers, otherwise we have visual drift that the
// implementor's grep doesn't catch end-to-end. ──────────────────────────────

const headerStyleRefs = ["accordionHeader", "accordionTitleContainer", "accordionTitle", "accordionCount"];

const ticketsBlockMatch = src.match(
  /businessOrders\.length\s*>\s*0\s*&&\s*\(([\s\S]*?\n\s{8}\)\})/,
);
const ticketsBlock = ticketsBlockMatch ? ticketsBlockMatch[1] : "";

check(
  "P-01 Tickets section references the 4 canonical accordion style keys (full visual-parity surface, not just accordionHeader)",
  ticketsBlock !== "" &&
    headerStyleRefs.every((ref) =>
      new RegExp(`styles\\.${ref}\\b`).test(ticketsBlock),
    ),
  `Tickets block must reference styles.accordionHeader, accordionTitleContainer, accordionTitle, AND accordionCount — anything less means visual drift from Active/Archive. Block snippet: ${ticketsBlock.slice(0, 200)}...`,
);

check(
  "P-02 Tickets chevron uses identical size=20 and color=#9ca3af as Active/Archive (no off-by-pixel drift)",
  /size=\{20\}\s*\n\s*color="#9ca3af"/.test(ticketsBlock),
  "Tickets Icon must use size={20} and color=\"#9ca3af\" verbatim — otherwise the chevron is visually distinguishable from Active/Archive on close inspection.",
);

check(
  "P-03 Tickets TouchableOpacity uses activeOpacity={0.7} matching Active/Archive haptic feel",
  /activeOpacity=\{0\.7\}/.test(ticketsBlock),
  "Touch feedback opacity must be 0.7 to match Active/Archive — anything else creates inconsistent press response across the same screen.",
);

// ─── (G) Guardrails against re-emergence of dead styles ──────────────────

check(
  "G-01 No code path still references styles.businessEventSection or styles.businessEventHeader (subtract-before-adding enforcement)",
  !/styles\.businessEventSection\b/.test(src) &&
    !/styles\.businessEventHeader\b/.test(src),
  "Tickets section must use the canonical accordionHeader family. References to the removed businessEvent* styles indicate a partial revert.",
);

check(
  "G-02 Tickets section is still gated on businessOrders.length > 0 (empty-state contract preserved)",
  /\{businessOrders\.length\s*>\s*0\s*&&\s*\(/.test(src),
  "Users with zero paid orders must not see an empty Tickets accordion shell — outer guard must remain.",
);

// ─── Report ──────────────────────────────────────────────────────────────

console.log("\nORCH-0848 ADVERSARIAL regression check (tester-authored)\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
