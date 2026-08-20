#!/usr/bin/env node
//
// #2321 — a deletion that did not delete may not claim it did.
//
// The consumer app rendered "Account Deleted" over a live login for the entire
// life of the dual-sided deletion feature. The server had reported `authRetained`
// since #668; the client discarded it. Nothing structural distinguished the two
// outcomes — same component, same styles, same three <Text> elements — so no type,
// no lint rule and no happy-path test could see it, and the flow is one Apple
// 5.1.1(v) / Play data-deletion reviewers audit in three taps.
//
// Enforces two DRAFT invariants:
//   I-2321-RETAINED-AUTH-CANNOT-CLAIM-DELETED  (A1, A2, A5)
//   I-2321-SIDE-GATE-IS-FALSIFIABLE            (A3, A4)
//
// A2 is a DISTINCT-STRING assertion, not a boolean "is there an if". Asserting an
// `if` exists would pass if both arms rendered the same key. Asserting the two
// titles DIFFER, per locale, cannot pass vacuously (#2113) and fails when a locale
// is added without the new key.
//
//   --self-test  proves each assertion reddens on its own reverted defect.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ACCOUNT_SETTINGS = "app-mobile/src/components/profile/AccountSettings.tsx";
const LOCALES_DIR = "app-mobile/src/i18n/locales";
const SHARED = "supabase/functions/_shared/accountDeletionSides.ts";
const BUSINESS_DELETE = "mingla-business/app/account/delete.tsx";

// Pinned at 29 so a 30th locale FAILS the gate rather than being silently skipped.
const EXPECTED_LOCALE_COUNT = 29;
const RETAINED_KEYS = ["retained_title", "retained_body", "retained_sub"];
const SUCCESS_KEYS = ["success_title", "success_body", "success_sub"];

const BUSINESS_RETAINED_HEADLINE = "Business Account Deleted";
const BUSINESS_NON_RETAINED_HEADLINE = "Account scheduled for deletion";

/** Strip block and line comments so a commented-out fix can never satisfy an assertion. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Slice the JSX guarded by `deleteStep === "<step>" && (` up to its balanced `)}`.
 * Brace/paren counting, not a regex over the whole file — the two branches are
 * adjacent siblings and a lazy match would run straight through both.
 */
function sliceStepBranch(source, step) {
  const marker = `deleteStep === "${step}" && (`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Last executable statement of a function body, comments already stripped. */
function terminalStatementOf(source, fnName) {
  const sig = new RegExp(`export\\s+async\\s+function\\s+${fnName}\\s*\\(`);
  const m = sig.exec(source);
  if (m === null) return null;
  const bodyStart = source.indexOf("{", m.index + m[0].length);
  if (bodyStart === -1) return null;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = source.slice(bodyStart + 1, i);
        const statements = body.split(";").map((s) => s.trim()).filter((s) => s !== "");
        if (statements.length === 0) return "";
        // The chunk after the final `;` still carries the closing brace of whatever
        // block preceded it (`... }\n  return true`). Drop everything up to the last
        // `}` so the terminal STATEMENT is what gets asserted on, not its context.
        return statements[statements.length - 1].replace(/^[\s\S]*\}/, "").trim();
      }
    }
  }
  return null;
}

/** Complete exported async function, including its balanced body. */
function functionSourceOf(source, fnName) {
  const sig = new RegExp(`export\\s+async\\s+function\\s+${fnName}\\s*\\(`);
  const m = sig.exec(source);
  if (m === null) return null;
  const bodyStart = source.indexOf("{", m.index + m[0].length);
  if (bodyStart === -1) return null;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(m.index, i + 1);
    }
  }
  return null;
}

export function validate(readFile, readLocales) {
  const failures = [];

  // ── A1 — the consumer app has a distinct retained branch, and the fully-deleted
  //         copy is unreachable from it. ────────────────────────────────────────
  const rawSettings = readFile(ACCOUNT_SETTINGS);
  if (rawSettings === null) {
    failures.push(`${ACCOUNT_SETTINGS} is missing — A1 cannot be evaluated`);
  } else {
    const settings = stripComments(rawSettings);

    if (!/setDeleteStep\(\s*data\?\.authRetained === true \? "retained" : "success"\s*\)/.test(settings)) {
      failures.push(
        `A1: ${ACCOUNT_SETTINGS} must branch the terminal step on the server's authRetained ` +
          `(setDeleteStep(data?.authRetained === true ? "retained" : "success")). ` +
          `An unconditional setDeleteStep("success") is the #2321 defect.`,
      );
    }

    const retainedBranch = sliceStepBranch(settings, "retained");
    const successBranch = sliceStepBranch(settings, "success");

    if (retainedBranch === null) {
      failures.push(`A1: ${ACCOUNT_SETTINGS} has no \`deleteStep === "retained"\` render branch`);
    } else {
      for (const key of SUCCESS_KEYS) {
        if (retainedBranch.includes(`settings:delete.${key}`)) {
          failures.push(
            `A1: the "retained" branch renders settings:delete.${key} — a retained login ` +
              `may never show the fully-deleted copy`,
          );
        }
      }
      for (const key of RETAINED_KEYS) {
        if (!retainedBranch.includes(`settings:delete.${key}`)) {
          failures.push(`A1: the "retained" branch must render settings:delete.${key}`);
        }
      }
    }

    if (successBranch === null) {
      failures.push(`A1: ${ACCOUNT_SETTINGS} has no \`deleteStep === "success"\` render branch`);
    } else {
      for (const key of RETAINED_KEYS) {
        if (successBranch.includes(`settings:delete.${key}`)) {
          failures.push(
            `A1: the "success" branch renders settings:delete.${key} — the two outcomes must not share copy`,
          );
        }
      }
    }
  }

  // ── A2 — every shipped locale carries the retained copy, and it is not the
  //         fully-deleted copy wearing a different key. ──────────────────────────
  const locales = readLocales();
  if (locales === null) {
    failures.push(`${LOCALES_DIR} is unreadable — A2 cannot be evaluated`);
  } else {
    if (locales.length !== EXPECTED_LOCALE_COUNT) {
      failures.push(
        `A2: expected ${EXPECTED_LOCALE_COUNT} shipped locales, found ${locales.length} ` +
          `(${locales.map((l) => l.locale).join(", ")}). A new locale must be added to this gate ` +
          `WITH its retained copy — never skipped.`,
      );
    }
    for (const { locale, json } of locales) {
      const del = json?.delete;
      if (del === undefined || del === null) {
        failures.push(`A2: ${locale}/settings.json has no "delete" object`);
        continue;
      }
      for (const key of RETAINED_KEYS) {
        const value = del[key];
        if (typeof value !== "string" || value.trim() === "") {
          failures.push(`A2: ${locale}/settings.json delete.${key} is missing or empty`);
        }
      }
      if (
        typeof del.retained_title === "string" &&
        typeof del.success_title === "string" &&
        del.retained_title === del.success_title
      ) {
        failures.push(
          `A2: ${locale}/settings.json delete.retained_title is identical to delete.success_title — ` +
            `the retained outcome would read as a completed deletion`,
        );
      }
    }
  }

  // ── A3/A4 — the side gate is falsifiable and the identity scrub is checked. ──
  const rawShared = readFile(SHARED);
  if (rawShared === null) {
    failures.push(`${SHARED} is missing — A3/A4 cannot be evaluated`);
  } else {
    const shared = stripComments(rawShared);

    const sideFns = [...shared.matchAll(/export\s+async\s+function\s+(userHasActive\w*Side)\s*\(/g)]
      .map((m) => m[1]);
    if (sideFns.length === 0) {
      failures.push(`A3: ${SHARED} exports no userHasActive*Side predicate — the gate has nothing to check`);
    }
    for (const fn of sideFns) {
      const terminal = terminalStatementOf(shared, fn);
      if (terminal === null) {
        failures.push(`A3: could not read the terminal statement of ${fn}()`);
      } else if (/^return\s+true$/.test(terminal)) {
        failures.push(
          `A3: ${fn}() ends in \`return true\` — a predicate that cannot return false is not a check. ` +
            `This exact shape made all six probes in userHasActiveExplorerSide decorative (#2321).`,
        );
      }
    }

    const businessSide = functionSourceOf(shared, "userHasActiveBusinessSide");
    if (businessSide === null) {
      failures.push(`A3: could not read userHasActiveBusinessSide() in ${SHARED}`);
    } else {
      for (const table of ["brands", "brand_team_members"]) {
        const escaped = table.replaceAll("_", "\\_");
        const failClosedProbe = new RegExp(
          `countOrThrow\\(\\s*"${escaped}"\\s*,\\s*adminClient\\s*\\.from\\("${escaped}"\\)`,
        );
        if (!failClosedProbe.test(businessSide)) {
          failures.push(
            `A3: userHasActiveBusinessSide() must route the ${table} count through countOrThrow. ` +
              `A failed Business probe may never be read as zero rows and authorize auth deletion.`,
          );
        }
      }
    }

    // The three probes that named columns production does not have. Matched on the
    // same source line as the table selector (`from("x")` or the `countRows("x")`
    // helper) so the window cannot bleed into the next probe.
    for (const col of ["boards.user_id", "pairings.user_id"]) {
      const [table, column] = col.split(".");
      const bad = new RegExp(`(?:from|countRows)\\("${table}"\\)[^\\n]{0,120}\\.eq\\("${column}"`);
      if (bad.test(shared)) {
        failures.push(
          `A3: ${SHARED} queries ${table} by "${column}", a column that does not exist in production — ` +
            `the probe 400s and is read as zero rows`,
        );
      }
    }
    if (/(?:from|countRows)\("preferences"\)[^\n]{0,120}\.(?:eq|select)\("id"/.test(shared)) {
      failures.push(`A3: ${SHARED} queries preferences by "id" — that table has no id column`);
    }

    const scrub = /\}\s*=\s*await adminClient\s*\n\s*\.from\("profiles"\)\s*\n\s*\.update\(\{[\s\S]{0,400}?explorer_deleted_at/;
    const bareScrub = /^\s*await adminClient\s*\n\s*\.from\("profiles"\)\s*\n\s*\.update\(\{[\s\S]*?explorer_deleted_at/m;
    if (bareScrub.test(shared)) {
      failures.push(
        `A4: the identity-scrub UPDATE in ${SHARED} discards its result. That single unchecked ` +
          `write is #2321: PostgREST rejected the whole statement and the user kept their name, ` +
          `username, avatar and onboarding flag while the app said the account was gone.`,
      );
    } else if (!scrub.test(shared)) {
      failures.push(`A4: could not find the identity-scrub UPDATE in ${SHARED}`);
    } else if (!/scrubError/.test(shared)) {
      failures.push(`A4: the identity-scrub UPDATE's error must be bound and inspected (scrubError)`);
    }
  }

  // ── A5 — the business mirror's retained headline exists and differs. ─────────
  const rawBusiness = readFile(BUSINESS_DELETE);
  if (rawBusiness === null) {
    failures.push(`${BUSINESS_DELETE} is missing — A5 cannot be evaluated`);
  } else {
    const business = stripComments(rawBusiness);
    if (!business.includes(BUSINESS_RETAINED_HEADLINE)) {
      failures.push(
        `A5: ${BUSINESS_DELETE} must render "${BUSINESS_RETAINED_HEADLINE}" when the auth login is retained`,
      );
    }
    if (!business.includes(BUSINESS_NON_RETAINED_HEADLINE)) {
      failures.push(
        `A5: ${BUSINESS_DELETE} lost its non-retained headline "${BUSINESS_NON_RETAINED_HEADLINE}"`,
      );
    }
    if (BUSINESS_RETAINED_HEADLINE === BUSINESS_NON_RETAINED_HEADLINE) {
      failures.push(`A5: the two business headlines must differ`);
    }
    if (!/retained\s*\?/.test(business)) {
      failures.push(`A5: ${BUSINESS_DELETE} must select its success copy on a \`retained\` branch`);
    }
  }

  return failures;
}

const readFile = (relative) => {
  const absolute = path.join(ROOT, relative);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
};

const readLocales = () => {
  const dir = path.join(ROOT, LOCALES_DIR);
  if (!fs.existsSync(dir)) return null;
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "settings.json");
    if (!fs.existsSync(file)) continue;
    out.push({ locale: entry.name, json: JSON.parse(fs.readFileSync(file, "utf8")) });
  }
  return out;
};

function selfTest() {
  const clean = validate(readFile, readLocales);
  if (clean.length > 0) {
    console.error("#2321 self-test: the clean tree unexpectedly failed:");
    for (const f of clean) console.error(`  - ${f}`);
    process.exit(1);
  }

  const mutate = (relative, fn) => (rel) => {
    const source = readFile(rel);
    return rel === relative && source !== null ? fn(source) : source;
  };
  const expect = (label, failures, needle) => {
    if (!failures.some((f) => f.includes(needle))) {
      console.error(`#2321 self-test: ${label} was NOT caught — this gate proves nothing`);
      console.error(`  saw: ${JSON.stringify(failures)}`);
      process.exit(1);
    }
  };

  // A1 — revert the handler conditional to the pre-#2321 unconditional success.
  expect(
    "the reverted setDeleteStep(\"success\") handler",
    validate(
      mutate(ACCOUNT_SETTINGS, (s) =>
        s.replace(
          /setDeleteStep\(data\?\.authRetained === true \? "retained" : "success"\)/,
          'setDeleteStep("success")',
        )),
      readLocales,
    ),
    "A1:",
  );

  // A1 — the retained branch reaching for the fully-deleted title.
  expect(
    "the retained branch rendering success_title",
    validate(
      mutate(ACCOUNT_SETTINGS, (s) =>
        s.replace("settings:delete.retained_title", "settings:delete.success_title")),
      readLocales,
    ),
    "may never show the fully-deleted copy",
  );

  // A2 — one locale losing retained_title.
  expect(
    "a locale with retained_title removed",
    validate(readFile, () => {
      const locales = readLocales();
      const copy = locales.map((l) => ({ locale: l.locale, json: structuredClone(l.json) }));
      const target = copy.find((l) => l.locale === "pl");
      delete target.json.delete.retained_title;
      return copy;
    }),
    "pl/settings.json delete.retained_title is missing or empty",
  );

  // A2 — a locale whose retained copy is just the success copy again.
  expect(
    "a locale whose retained_title equals success_title",
    validate(readFile, () => {
      const copy = readLocales().map((l) => ({ locale: l.locale, json: structuredClone(l.json) }));
      const target = copy.find((l) => l.locale === "de");
      target.json.delete.retained_title = target.json.delete.success_title;
      return copy;
    }),
    "identical to delete.success_title",
  );

  // A2 — the locale count drifting.
  expect(
    "a 30th locale added without retained copy",
    validate(readFile, () => [
      ...readLocales(),
      { locale: "xx", json: { delete: { success_title: "x" } } },
    ]),
    "expected 29 shipped locales",
  );

  // A3 — the trailing `return false` reverted to `return true`.
  expect(
    "userHasActiveExplorerSide reverted to a bare `return true`",
    validate(
      mutate(SHARED, (s) => {
        // The gate strips comments before reading the terminal statement, so the
        // mutation must land on the LAST `return false;` inside
        // userHasActiveExplorerSide — located by its own function slice.
        const start = s.indexOf("export async function userHasActiveExplorerSide(");
        const end = s.indexOf("export async function shouldDeleteAuthUser(");
        if (start === -1 || end === -1 || end < start) {
          console.error("#2321 self-test: could not slice userHasActiveExplorerSide to mutate");
          process.exit(1);
        }
        const slice = s.slice(start, end);
        const at = slice.lastIndexOf("return false;");
        if (at === -1) {
          console.error("#2321 self-test: could not locate the terminal `return false` to mutate");
          process.exit(1);
        }
        const mutated = slice.slice(0, at) + "return true;" + slice.slice(at + "return false;".length);
        return s.slice(0, start) + mutated + s.slice(end);
      }),
      readLocales,
    ),
    "A3:",
  );

  // A3 — a probe re-pointed at a column that does not exist.
  expect(
    "a pairings probe re-pointed at the non-existent user_id",
    validate(
      mutate(SHARED, (s) =>
        s.replace(
          'countRows("pairings").or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)',
          'countRows("pairings").eq("user_id", userId)',
        )),
      readLocales,
    ),
    'queries pairings by "user_id"',
  );

  // A3 — either Business count losing its fail-closed wrapper must be caught
  // independently. These are the two probes that authorized auth deletion when
  // PostgREST errored in the tester's P0 reproduction.
  for (const table of ["brands", "brand_team_members"]) {
    expect(
      `the ${table} Business probe dropping countOrThrow`,
      validate(
        mutate(SHARED, (s) => {
          const label = `    "${table}",\n`;
          return s.replace("await countOrThrow(\n" + label, "await Promise.resolve(\n" + label);
        }),
        readLocales,
      ),
      `route the ${table} count through countOrThrow`,
    );
  }

  // A4 — the identity scrub reverted to a discarded result.
  expect(
    "the identity scrub reverted to a discarded result",
    validate(
      mutate(SHARED, (s) =>
        s
          .replace("const { error: scrubError } = await adminClient", "await adminClient")
          .replace(/if \(scrubError\)[\s\S]*?\n  \}\n/, "")),
      readLocales,
    ),
    "A4:",
  );

  // A5 — the business mirror losing its retained headline.
  expect(
    "the business mirror losing its retained headline",
    validate(
      mutate(BUSINESS_DELETE, (s) => s.replace("Business Account Deleted", "Account deleted")),
      readLocales,
    ),
    "A5:",
  );

  console.log(
    "#2321 self-test passed (clean green; 11 reverted defects across A1/A2/A3/A4/A5 all caught).",
  );
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const failures = validate(readFile, readLocales);
  if (failures.length > 0) {
    console.error("#2321 retained-auth-cannot-claim-deleted gate FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\nA deletion that did not delete may not render the copy of one that did.");
    console.error("See I-2321-RETAINED-AUTH-CANNOT-CLAIM-DELETED and I-2321-SIDE-GATE-IS-FALSIFIABLE.");
    process.exit(1);
  }
  console.log(
    "#2321 gate: the retained-auth branch is distinct in both apps, all 29 locales carry honest copy, " +
      "and the side gate is falsifiable.",
  );
}

main();
