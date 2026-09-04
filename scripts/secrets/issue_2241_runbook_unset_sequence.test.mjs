/**
 * Issue #2241 — bind the operator runbook's production unset sequence to the
 * machine contract it claims to describe.
 *
 * The five names in `remediation.allowed_extra_live_names` are locked in three
 * places in code (the contract, the contract audit, and the strict readiness
 * gate). `docs/runbooks/SUPABASE_SECRET_CAPACITY.md` is the operator's ONLY
 * authority for the order and arithmetic of removing them from production, and
 * until this file existed nothing compared the two. That is the exact #2241 bug
 * class: a document and the system it describes drifting with no reader.
 *
 * Every expected number here is DERIVED from the manifest and the contract.
 * A literal count in this file would re-create the drift it exists to catch.
 *
 * This guard only ever ADDS assertions. It never authorises a live name that
 * the readiness gate rejects, never widens `allowed_extra_live_names`, and
 * never permits a sixth user-managed slot.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Whitespace-normalised so a reflow of the Markdown source cannot make a
 * sentence unfindable and silently turn this guard into a no-op.
 */
const RUNBOOK = readFileSync(
  resolve(REPO_ROOT, "docs", "runbooks", "SUPABASE_SECRET_CAPACITY.md"),
  "utf8",
).replace(/\s+/g, " ");
const manifest = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "supabase", "secrets.manifest.json"), "utf8"),
);
const contract = JSON.parse(
  readFileSync(
    resolve(REPO_ROOT, "supabase", "function-env.contract.json"),
    "utf8",
  ),
);

/** Declared top-level user-managed names. The finished state of the migration. */
const declaredCount = manifest.secrets.length;
/** Direct migration names production still carries while the rail is live. */
const extraNames = [...contract.remediation.allowed_extra_live_names].sort();
/** What live parity legitimately equals mid-remediation. */
const remediationCount = declaredCount + extraNames.length;

const SEQUENCE_ANCHOR =
  "may the five direct names be removed, one at a time, in this order:";
const SEQUENCE_TERMINATOR = "Stop on any fallback";

/**
 * Read the documented removal sequence as ordered (name, remaining-count)
 * pairs. Bounded by an explicit terminator so a later unrelated backticked
 * name can never silently join the sequence.
 */
function documentedUnsetSequence() {
  const start = RUNBOOK.indexOf(SEQUENCE_ANCHOR);
  assert.notEqual(
    start,
    -1,
    "runbook no longer documents the direct-name removal sequence",
  );
  const end = RUNBOOK.indexOf(SEQUENCE_TERMINATOR, start);
  assert.notEqual(
    end,
    -1,
    "runbook removal sequence is not terminated by its stop condition",
  );
  const span = RUNBOOK.slice(start + SEQUENCE_ANCHOR.length, end);
  // The final step reads "`ATTENDANCE_CLAIM_PEPPER` last (88)", so a word may
  // sit between the name and its remaining count. Backticks and parentheses
  // still bound the pair, so two steps can never merge into one.
  return [...span.matchAll(/`([A-Z][A-Z0-9_]*)`[^`()]*\((\d+)\)/g)].map((match) => ({
    name: match[1],
    remaining: Number(match[2]),
  }));
}

/**
 * Every governed bundle field declared anywhere in the manifest, lowercased.
 * `CHECKOUT_REVOCATION_EXECUTE` lands in `MINGLA_DELIVERY_FLAGS_JSON` as
 * `checkout_revocation_execute`, so the destination match is case-insensitive.
 */
function declaredBundleDestinations() {
  return new Set(
    manifest.secrets.flatMap((record) =>
      (record.bundle_fields ?? []).map((field) => field.name.toLowerCase())
    ),
  );
}

test("the runbook removes exactly the names the contract allows to be live", () => {
  const sequence = documentedUnsetSequence();
  assert.deepEqual(
    sequence.map((step) => step.name).sort(),
    extraNames,
    "runbook removal sequence and remediation.allowed_extra_live_names disagree",
  );
  assert.equal(
    new Set(sequence.map((step) => step.name)).size,
    sequence.length,
    "runbook removal sequence names a secret more than once",
  );
});

test("the runbook's remaining-count arithmetic descends to the declared state", () => {
  const sequence = documentedUnsetSequence();
  const expected = sequence.map((_, index) => remediationCount - index - 1);
  assert.deepEqual(
    sequence.map((step) => step.remaining),
    expected,
    "runbook counts do not descend one-per-unset from the remediation state",
  );
  assert.equal(
    sequence.at(-1).remaining,
    declaredCount,
    "the last documented unset does not land on the declared manifest count",
  );
});

test("the runbook's stated parity numbers are the derived ones", () => {
  assert.ok(
    RUNBOOK.includes(`${remediationCount}-name remediation parity`),
    `runbook does not state ${remediationCount}-name remediation parity`,
  );
  assert.ok(
    RUNBOOK.includes(`exact ${declaredCount}-name manifest`),
    `runbook does not state the exact ${declaredCount}-name manifest target`,
  );
  assert.ok(
    RUNBOOK.includes(
      `${manifest.policy.normal_ceiling}/${manifest.policy.absolute_ceiling} ceilings`,
    ),
    "runbook does not state the manifest's own capacity ceilings",
  );
});

test("the runbook's parity sentence lists exactly the allowed extra names", () => {
  const anchor = `live names equal the exact ${declaredCount}-name manifest plus`;
  const start = RUNBOOK.indexOf(anchor);
  assert.notEqual(start, -1, "runbook no longer states remediation parity");
  const span = RUNBOOK.slice(start, RUNBOOK.indexOf(".", start));
  assert.deepEqual(
    [...new Set([...span.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]))]
      .sort(),
    extraNames,
    "runbook parity sentence and the contract's allowed extras disagree",
  );
});

test("no name scheduled for removal is a top-level manifest record", () => {
  const declared = new Set(manifest.secrets.map((record) => record.name));
  for (const name of extraNames) {
    assert.equal(
      declared.has(name),
      false,
      `${name} is declared as a top-level secret; it is a governed bundle ` +
        "field and must never consume a user-managed slot",
    );
  }
  assert.equal(
    manifest.secrets.length,
    declaredCount,
    "declaring a removal-scheduled name would grow the user-managed budget",
  );
});

test("every name scheduled for removal has a declared bundle destination", () => {
  const destinations = declaredBundleDestinations();
  for (const step of documentedUnsetSequence()) {
    assert.ok(
      destinations.has(step.name.toLowerCase()),
      `${step.name} is scheduled for removal but has no declared bundle ` +
        "field to fall back to; removing it would strand a live reader",
    );
  }
});
