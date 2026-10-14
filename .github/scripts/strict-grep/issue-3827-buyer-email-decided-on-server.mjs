#!/usr/bin/env node
/**
 * issue #3827 — whether buyers are emailed about a live edit is decided on the
 * server, and nowhere else.
 * Invariant: I-PROPOSED-3827-LIVE-EDIT-BUYER-EMAIL-IS-DECIDED-ON-THE-SERVER.
 *
 * WHAT SHIPPED, AND WHY A GATE.
 *
 * The Host app used to tell a host that buyers "will be notified by email and
 * SMS" after a live edit while `services/eventChangeNotifier.ts` only wrote a
 * console line. Migration 20270903003827 gives the decision ONE owner: each of
 * the three live-edit functions calls `event_edit_notice_flush`, which records
 * the edit in `event_edit_notices` and decides whether, and when, an email
 * goes out. The app only repeats the server's answer.
 *
 * REQUIRE:
 *   S1. `mingla-business/src/services/eventChangeNotifier.ts` does not exist,
 *       and no product source under `mingla-business/src` or
 *       `mingla-business/app` names it, its entry point `notifyEventChanged`,
 *       or its `[email-stub]` / `[sms-stub]` console markers.
 *   S2. The files that hold the live-edit notice copy never say "SMS" or
 *       "push": no edit is sent by text message or push alert, so no screen
 *       may promise one. (Comments count: a claim in a comment is the next
 *       claim on screen.)
 *   S3. Reading migrations at or after 20270903003827 (SQL comments stripped,
 *       so a commented-out call never reads as present), the LAST definition
 *       of each live-edit function calls `event_edit_notice_flush(`. The floor
 *       migration exists and defines all three: a gate that discovers nothing
 *       FAILS.
 *   S4. No migration at or after the floor gives the buyer category
 *       `buyer_event_updated` any channel other than email.
 *
 * DOES NOT CATCH, stated rather than implied:
 *   - a promise worded without the words in S2 ("we'll text them");
 *   - copy for edits written in a file that is not in COPY_FILES;
 *   - a live-edit function that is not in LIVE_EDIT_FUNCTIONS;
 *   - whether the flush is REACHED on every path (the pg17 suite
 *     `issue_3827_live_edit_buyer_email.implementor.happy.pg17.test.sql`
 *     executes the functions and proves that).
 *
 * `--self-test` drives the pure core with fixtures: the compliant set passes
 * and each single violation is caught.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FLOOR = "20270903003827";
const MIGRATIONS_DIR = "supabase/migrations";
const STUB_PATH = "mingla-business/src/services/eventChangeNotifier.ts";
const PRODUCT_ROOTS = ["mingla-business/src", "mingla-business/app"];
const STUB_MARKERS = ["eventChangeNotifier", "notifyEventChanged", "[email-stub]", "[sms-stub]"];
const COPY_FILES = [
  "mingla-business/src/utils/buyerNoticeCopy.ts",
  "mingla-business/src/components/event/ChangeSummaryModal.tsx",
  "mingla-business/src/components/event/EditAfterPublishBanner.tsx",
  "mingla-business/src/components/trip/EditAfterPublishTripBanner.tsx",
  "mingla-business/src/components/experience/EditAfterPublishExperienceBanner.tsx",
];
// `x.push(` is the array method, not a promise of a push alert.
const FORBIDDEN_COPY = /\bSMS\b|\bpush\b(?!\s*\()/i;
const LIVE_EDIT_FUNCTIONS = [
  "business_update_live_event_atomic",
  "biz_update_live_rsvp",
  "biz_update_live_experience",
];
const FLUSH_CALL = "event_edit_notice_flush(";
const BUYER_CATEGORY = "buyer_event_updated";

// ---- pure core ----------------------------------------------------------

/** Remove `-- line` and block comments, leaving string literals alone. */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

/** Every definition of `name` in one migration, as its body text. */
export function functionBodies(sql, name) {
  const clean = stripSqlComments(sql);
  const header = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,
    "gi",
  );
  const bodies = [];
  let match;
  while ((match = header.exec(clean)) !== null) {
    const rest = clean.slice(match.index);
    const tag = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(rest);
    if (tag === null) {
      bodies.push("");
      continue;
    }
    const start = tag.index + tag[0].length;
    const end = rest.indexOf(tag[1], start);
    bodies.push(end === -1 ? rest.slice(start) : rest.slice(start, end));
  }
  return bodies;
}

/**
 * @param {{
 *   stubExists: boolean,
 *   productFiles: Array<{path: string, text: string}>,
 *   copyFiles: Array<{path: string, text: string | null}>,
 *   migrations: Array<{name: string, text: string}>,
 * }} input
 * @returns {string[]} violations
 */
export function check(input) {
  const violations = [];

  // S1
  if (input.stubExists) {
    violations.push(`S1 ${STUB_PATH} exists: the client stub that pretended to notify buyers is back`);
  }
  for (const file of input.productFiles) {
    for (const marker of STUB_MARKERS) {
      if (file.text.includes(marker)) {
        violations.push(`S1 ${file.path} names "${marker}"`);
      }
    }
  }

  // S2
  for (const file of input.copyFiles) {
    if (file.text === null) {
      violations.push(`S2 ${file.path} is missing: the notice copy moved and this gate no longer reads it`);
      continue;
    }
    file.text.split("\n").forEach((line, index) => {
      if (FORBIDDEN_COPY.test(line)) {
        violations.push(`S2 ${file.path}:${index + 1} mentions a text message or push alert for an edit: ${line.trim().slice(0, 120)}`);
      }
    });
  }

  // S3 + S4
  const scoped = input.migrations
    .filter((migration) => /^\d{14}_/.test(migration.name) && migration.name.slice(0, 14) >= FLOOR)
    .sort((a, b) => a.name.localeCompare(b.name));
  const floor = scoped.find((migration) => migration.name.startsWith(FLOOR));
  if (floor === undefined) {
    violations.push(`S3 the floor migration ${FLOOR}_* is missing`);
  }
  for (const fn of LIVE_EDIT_FUNCTIONS) {
    if (floor !== undefined && functionBodies(floor.text, fn).length === 0) {
      violations.push(`S3 the floor migration does not define ${fn}`);
    }
    let last = null;
    for (const migration of scoped) {
      for (const body of functionBodies(migration.text, fn)) {
        last = { migration: migration.name, body };
      }
    }
    if (last === null) {
      violations.push(`S3 no definition of ${fn} at or after ${FLOOR} was read`);
    } else if (!last.body.includes(FLUSH_CALL)) {
      violations.push(`S3 ${last.migration}: the last definition of ${fn} does not call ${FLUSH_CALL}…): a live edit would be saved with no edit notice`);
    }
  }
  for (const migration of scoped) {
    const clean = stripSqlComments(migration.text);
    let at = clean.indexOf(`'${BUYER_CATEGORY}'`);
    while (at !== -1) {
      const window = clean.slice(at, at + 400);
      const statementEnd = window.indexOf(";");
      const statement = statementEnd === -1 ? window : window.slice(0, statementEnd);
      if (/'(sms|push|inapp|in_app)'/i.test(statement) && /default_channels|ARRAY\s*\[/i.test(statement)) {
        violations.push(`S4 ${migration.name}: ${BUYER_CATEGORY} is given a channel other than email`);
      }
      at = clean.indexOf(`'${BUYER_CATEGORY}'`, at + 1);
    }
  }
  return violations;
}

// ---- self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const goodFn = (name) =>
    `CREATE OR REPLACE FUNCTION public.${name}(p_event_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $fn$\nBEGIN\n  v_notice := public.event_edit_notice_flush(p_event_id, 'r', 'event', false);\n  RETURN '{}'::jsonb;\nEND;$fn$;\n`;
  const badFn = (name) =>
    `CREATE OR REPLACE FUNCTION public.${name}(p_event_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $fn$\nBEGIN\n  -- v_notice := public.event_edit_notice_flush(p_event_id, 'r', 'event', false);\n  RETURN '{}'::jsonb;\nEND;$fn$;\n`;
  const category =
    "INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels) VALUES ('buyer_event_updated', 'Purchases', true, 'high', ARRAY['email']::text[]);\n";
  const good = () => ({
    stubExists: false,
    productFiles: [{ path: "mingla-business/src/store/liveEventStore.ts", text: "export const x = 1;" }],
    copyFiles: COPY_FILES.map((file) => ({ path: file, text: "We'll email your buyers what changed." })),
    migrations: [
      { name: "20270828003827_before_the_floor.sql", text: LIVE_EDIT_FUNCTIONS.map(badFn).join("") },
      { name: `${FLOOR}_issue_3827_live_edit_buyer_email.sql`, text: category + LIVE_EDIT_FUNCTIONS.map(goodFn).join("") },
    ],
  });
  const cases = [
    ["the compliant fixture passes", good(), 0],
    ["S1 the stub file is back", { ...good(), stubExists: true }, 1],
    ["S1 a product file imports the stub", {
      ...good(),
      productFiles: [{ path: "a.ts", text: 'import { notifyEventChanged } from "../services/eventChangeNotifier";' }],
    }, 2],
    ["S1 a stub console marker", { ...good(), productFiles: [{ path: "a.ts", text: 'console.log("[sms-stub]")' }] }, 1],
    ["S2 the footer promises SMS", {
      ...good(),
      copyFiles: [{ path: COPY_FILES[0], text: "Material changes notify your buyers by email and SMS." }, ...good().copyFiles.slice(1)],
    }, 1],
    ["S2 a banner promises a push alert", {
      ...good(),
      copyFiles: [...good().copyFiles.slice(0, 4), { path: COPY_FILES[4], text: "Buyers get a push alert." }],
    }, 1],
    ["S2 a copy file is missing", {
      ...good(),
      copyFiles: [{ path: COPY_FILES[0], text: null }, ...good().copyFiles.slice(1)],
    }, 1],
    ["S3 the floor migration is missing", { ...good(), migrations: [good().migrations[0]] }, 4],
    ["S3 a later migration re-creates a function without the flush (comment only)", {
      ...good(),
      migrations: [...good().migrations, { name: "20271001000000_later.sql", text: badFn("biz_update_live_rsvp") }],
    }, 1],
    ["S3 a later migration that keeps the flush passes", {
      ...good(),
      migrations: [...good().migrations, { name: "20271001000000_later.sql", text: goodFn("biz_update_live_rsvp") }],
    }, 0],
    ["S3 the floor does not define one of the three", {
      ...good(),
      migrations: [good().migrations[0], {
        name: `${FLOOR}_issue_3827_live_edit_buyer_email.sql`,
        text: category + LIVE_EDIT_FUNCTIONS.slice(0, 2).map(goodFn).join(""),
      }],
    }, 2],
    ["S4 the buyer category gains SMS", {
      ...good(),
      migrations: [...good().migrations, {
        name: "20271001000000_later.sql",
        text: "UPDATE public.notification_categories SET default_channels = ARRAY['email','sms'] WHERE key = 'buyer_event_updated';",
      }, {
        name: "20271002000000_later.sql",
        text: "INSERT INTO public.notification_categories (key, default_channels) VALUES ('buyer_event_updated', ARRAY['email','sms']);",
      }],
    }, 1],
  ];
  const failures = [];
  for (const [label, input, expected] of cases) {
    const got = check(input);
    if (got.length !== expected) {
      failures.push(`${label}: expected ${expected} violation(s), got ${got.length}: ${JSON.stringify(got)}`);
    }
  }
  if (stripSqlComments("a -- x\nb /* y */ c '--z'") !== "a \nb  c '--z'") {
    failures.push("stripSqlComments does not strip comments and keep string literals");
  }
  if (failures.length > 0) {
    console.error("#3827 buyer-email-decided-on-server self-test FAIL:");
    for (const failure of failures) console.error("  - " + failure);
    process.exit(1);
  }
  console.log(`#3827 buyer-email-decided-on-server self-test PASS (${cases.length} cases)`);
  process.exit(0);
}

// ---- plain run ----------------------------------------------------------
function walk(dir) {
  const out = [];
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return out;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...walk(relative));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(relative);
    }
  }
  return out;
}

const productFiles = PRODUCT_ROOTS.flatMap(walk).map((file) => ({
  path: file,
  text: fs.readFileSync(path.join(ROOT, file), "utf8"),
}));
if (productFiles.length < 500) {
  console.error(`#3827 buyer-email-decided-on-server FAIL: only ${productFiles.length} product files were read; the scan roots moved`);
  process.exit(1);
}
const migrationsDir = path.join(ROOT, MIGRATIONS_DIR);
const migrations = fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, text: fs.readFileSync(path.join(migrationsDir, name), "utf8") }))
  : [];

const violations = check({
  stubExists: fs.existsSync(path.join(ROOT, STUB_PATH)),
  productFiles,
  copyFiles: COPY_FILES.map((file) => ({
    path: file,
    text: fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), "utf8") : null,
  })),
  migrations,
});

if (violations.length > 0) {
  console.error("#3827 buyer-email-decided-on-server FAIL:");
  for (const violation of violations) console.error("  - " + violation);
  process.exit(1);
}
console.log(
  `#3827 buyer-email-decided-on-server PASS (${productFiles.length} product files, ${COPY_FILES.length} copy files, ` +
    `${migrations.filter((m) => m.name.slice(0, 14) >= FLOOR).length} migration(s) at or after ${FLOOR})`,
);
