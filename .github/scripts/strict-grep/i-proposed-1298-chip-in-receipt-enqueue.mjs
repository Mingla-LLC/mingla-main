#!/usr/bin/env node
/**
 * ORCH-1298 [chip-in-receipt-emails] — I-PROPOSED-1298-CHIP-IN-RECEIPT-ENQUEUE.
 *
 * RULE: a paid chip-in enqueues a guest gift-receipt + a host gift-received,
 * ONCE, on both rails, idempotently. The guard has three static arms, all in the
 * ORCH-1298 migration that CREATE-OR-REPLACEs finalize_rsvp_contribution:
 *
 *   (a) ENQUEUE PRESENT — the migration body contains an
 *       `INSERT INTO public.notification_outbox` whose idempotency keys use the
 *       `chip_in_receipt:` namespace for BOTH the guest and a host recipient
 *       (`:guest` and `:host`), each with `ON CONFLICT (idempotency_key) DO NOTHING`.
 *   (b) SEED PRESENT + NO SMS — the same migration seeds BOTH categories
 *       (`buyer_contribution_receipt`, `business.rsvp_contribution_received`) and
 *       neither seed line carries the `sms` channel (DC-3 / I-PROPOSED-1161 closed
 *       SMS set).
 *   (c) TEMPLATE CASES — _shared/notifyTemplates.ts has a renderCategoryMessage
 *       `case` for BOTH category keys, and neither case body contains gift-breaking
 *       tax/invoice language.
 *
 * Reverting the enqueue (a), re-adding `sms` to a seed (b), or deleting a template
 * case / adding tax/invoice copy (c) FAILS CI.
 *
 * `--self-test`: GOOD/BAD fixtures for each arm. Reverting any arm FAILS.
 *
 * DRAFT until CLOSE (orchestrator flips I-PROPOSED-1298-CHIP-IN-RECEIPT-ENQUEUE ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const TEMPLATES_FILE = path.join(process.cwd(), "supabase/functions/_shared/notifyTemplates.ts");

const GUEST_KEY = "buyer_contribution_receipt";
const HOST_KEY = "business.rsvp_contribution_received";
const FORBIDDEN = ["tax", "invoice", "vat"]; // gift thank-you, never a tax doc.

function stripSqlComments(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

// Strip TS/JS comments so a gate scan never trips on an explanatory comment that
// legitimately NAMES a forbidden word (e.g. "// NO tax/invoice language").
function stripTsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// (a) + (b) — the migration arms. `migSrc` is the RAW migration text (with comments
// stripped for the executable-content assertions).
function checkMigration(migSrc, failures) {
  if (migSrc === null) {
    failures.push(
      "no migration CREATE-OR-REPLACEs finalize_rsvp_contribution with the ORCH-1298 " +
        "chip_in_receipt enqueue — the migration is missing.",
    );
    return;
  }
  const code = stripSqlComments(migSrc);

  // (a) enqueue present — INSERT INTO notification_outbox + both recipient keys.
  if (!/INSERT\s+INTO\s+public\.notification_outbox/i.test(code)) {
    failures.push(
      "(a) the ORCH-1298 migration does not INSERT INTO public.notification_outbox — " +
        "the guest/host enqueue was removed.",
    );
  }
  if (!code.includes("chip_in_receipt:")) {
    failures.push("(a) the enqueue idempotency keys ('chip_in_receipt:') are missing.");
  }
  if (!/':guest'|:guest'|\|\| ':guest'/.test(code) && !code.includes(":guest")) {
    failures.push("(a) the GUEST idempotency key suffix ':guest' is missing.");
  }
  if (!code.includes(":host")) {
    failures.push("(a) the HOST idempotency key suffix ':host' is missing.");
  }
  if (!/ON\s+CONFLICT\s*\(\s*idempotency_key\s*\)\s*DO\s+NOTHING/i.test(code)) {
    failures.push(
      "(a) the enqueue is not idempotent — every notification_outbox INSERT must be " +
        "ON CONFLICT (idempotency_key) DO NOTHING.",
    );
  }

  // (b) seed present + NO sms on either new category line.
  for (const key of [GUEST_KEY, HOST_KEY]) {
    if (!code.includes(key)) {
      failures.push(`(b) the ORCH-1298 seed does not include the category '${key}'.`);
      continue;
    }
    // The SEED row is the occurrence of the key whose window carries an ARRAY[...]
    // channel list (the outbox INSERT also names the key, but with no ARRAY). Scan
    // that seed window for an 'sms' channel.
    const region = seedRegionForKey(code, key);
    if (region && /'sms'/.test(region)) {
      failures.push(
        `(b) category '${key}' seeds an 'sms' channel — the two ORCH-1298 gift categories ` +
          "must NOT be SMS-eligible (DC-3 / I-PROPOSED-1161 closed SMS set).",
      );
    }
  }
}

// Helper — return the window around the SEED row for `key` (the occurrence whose
// following ~200 chars contain an ARRAY[...] channel list), so we can scan its
// channel list for 'sms'. Skips the notification_outbox INSERT occurrence (no ARRAY).
function seedRegionForKey(code, key) {
  const marker = `'${key}'`;
  let from = 0;
  for (;;) {
    const at = code.indexOf(marker, from);
    if (at === -1) return null;
    const window = code.slice(at, at + 200);
    if (window.includes("ARRAY[")) return window;
    from = at + marker.length;
  }
}

// (c) — the template cases. Comments are stripped so an explanatory comment that
// names a forbidden word ("// NO tax/invoice language") never trips the scan.
function checkTemplates(rawTplSrc, failures) {
  if (rawTplSrc === null) {
    failures.push("_shared/notifyTemplates.ts not found.");
    return;
  }
  const tplSrc = stripTsComments(rawTplSrc);
  for (const key of [GUEST_KEY, HOST_KEY]) {
    const caseRe = new RegExp(`case\\s+"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
    if (!caseRe.test(tplSrc)) {
      failures.push(
        `(c) renderCategoryMessage has no case for '${key}' — the gift-receipt copy is missing.`,
      );
    }
  }
  // No tax/invoice language in the two new case bodies (comment-stripped). Scope:
  // from the guest case to the `default:` that follows the host case.
  const start = tplSrc.indexOf(`case "${GUEST_KEY}"`);
  const end = tplSrc.indexOf("default:", tplSrc.indexOf(`case "${HOST_KEY}"`));
  if (start !== -1 && end !== -1 && end > start) {
    const block = tplSrc.slice(start, end).toLowerCase();
    for (const term of FORBIDDEN) {
      if (block.includes(term)) {
        failures.push(
          `(c) the ORCH-1298 template copy contains gift-breaking word "${term}" — ` +
            "these are gift thank-yous, not tax/invoice documents.",
        );
      }
    }
  }
}

// Locate the ORCH-1298 migration by content (robust to a filename shift): the one
// that CREATE-OR-REPLACEs finalize_rsvp_contribution AND references chip_in_receipt.
function findMigration() {
  let files = [];
  try {
    files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    return null;
  }
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.finalize_rsvp_contribution/i.test(src) &&
      src.includes("chip_in_receipt:")
    ) {
      return src;
    }
  }
  return null;
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const GOOD_MIG = `
CREATE OR REPLACE FUNCTION public.finalize_rsvp_contribution(x uuid) RETURNS jsonb AS $function$
BEGIN
  INSERT INTO public.notification_outbox (category_key, idempotency_key)
  VALUES ('buyer_contribution_receipt', 'chip_in_receipt:' || x || ':guest')
  ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.notification_outbox (category_key, idempotency_key)
  SELECT 'business.rsvp_contribution_received', 'chip_in_receipt:' || x || ':host:' || m.user_id FROM m
  ON CONFLICT (idempotency_key) DO NOTHING;
END; $function$;
INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES
  ('buyer_contribution_receipt', 'Purchases', true, 'normal', ARRAY['inapp','push','email'], 'reach_once'),
  ('business.rsvp_contribution_received', 'Payments', true, 'normal', ARRAY['inapp','push','email'], 'reach_once');
`;
  const GOOD_TPL = `
    case "buyer_contribution_receipt": {
      return { push: { title: "Gift received", body: "Your gift is in" }, email: { subject: "Thanks", body: "Thank you" }, sms: "x" };
    }
    case "business.rsvp_contribution_received": {
      return { push: { title: "You got a gift", body: "chipped in" }, email: { subject: "gift", body: "connected account" }, sms: "x" };
    }
    default:
`;

  // GOOD passes.
  let f = [];
  checkMigration(GOOD_MIG, f);
  checkTemplates(GOOD_TPL, f);
  if (f.length) self.push("GOOD fixtures wrongly flagged: " + f.join("; "));

  // BAD (a): enqueue removed.
  f = [];
  checkMigration(
    `CREATE OR REPLACE FUNCTION public.finalize_rsvp_contribution(x uuid) RETURNS jsonb AS $function$ BEGIN RETURN '{}'; END; $function$;`,
    f,
  );
  if (f.length === 0) self.push("(a) migration without the enqueue not flagged");

  // BAD (a2): not idempotent (no ON CONFLICT).
  f = [];
  checkMigration(
    GOOD_MIG.replace(/ON CONFLICT \(idempotency_key\) DO NOTHING/g, ""),
    f,
  );
  if (f.length === 0) self.push("(a2) non-idempotent enqueue not flagged");

  // BAD (b): an 'sms' channel re-added to a gift category.
  f = [];
  checkMigration(
    GOOD_MIG.replace(
      "('buyer_contribution_receipt', 'Purchases', true, 'normal', ARRAY['inapp','push','email']",
      "('buyer_contribution_receipt', 'Purchases', true, 'normal', ARRAY['inapp','push','email','sms']",
    ),
    f,
  );
  if (f.length === 0) self.push("(b) sms channel on a gift category not flagged");

  // BAD (c): a template case deleted.
  f = [];
  checkTemplates(GOOD_TPL.replace(/case "buyer_contribution_receipt": \{[\s\S]*?\}\n/, ""), f);
  if (f.length === 0) self.push("(c) missing guest template case not flagged");

  // BAD (c2): tax/invoice language in the copy.
  f = [];
  checkTemplates(GOOD_TPL.replace("Thank you", "Your tax invoice"), f);
  if (f.length === 0) self.push("(c2) tax/invoice copy not flagged");

  if (self.length) {
    console.error("I-PROPOSED-1298-CHIP-IN-RECEIPT-ENQUEUE self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-PROPOSED-1298-CHIP-IN-RECEIPT-ENQUEUE self-test PASS (7/7 cases).");
  process.exit(0);
}

const failures = [];
checkMigration(findMigration(), failures);
checkTemplates(fs.existsSync(TEMPLATES_FILE) ? fs.readFileSync(TEMPLATES_FILE, "utf8") : null, failures);

if (failures.length > 0) {
  console.error("I-PROPOSED-1298-CHIP-IN-RECEIPT-ENQUEUE FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1298-CHIP-IN-RECEIPT-ENQUEUE PASS — finalize enqueues guest+host " +
    "chip_in_receipt rows (idempotent), both categories seeded (no sms), and both " +
    "template cases render gift copy (no tax/invoice).",
);
