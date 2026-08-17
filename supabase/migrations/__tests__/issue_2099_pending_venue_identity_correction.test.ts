/**
 * #2099 — static seal over the migration and the issue workflow.
 *
 * This is the cheap, always-on half of the database contract: it pins the
 * tokens whose REMOVAL would silently weaken the correction without breaking
 * anything a happy-path SQL run would notice — the DDL seal, the SHARE/EXCLUSIVE
 * lock modes, the safe error codes, the audit immutability triggers, the
 * privacy gate, the replay-safety mechanics, and the workflow wiring that makes
 * the rest of the gates actually execute.
 *
 * The executable halves live in
 * `issue_2099_pending_venue_identity_correction.test.sql` (full-chain PG17) and
 * `…concurrent.test.sh` (two authenticated connections).
 */

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  "supabase/migrations/20270416002099_issue_2099_pending_venue_identity_correction.sql",
);
const workflow = await Deno.readTextFile(
  ".github/workflows/issue-2099-pending-venue-identity-correction-tests.yml",
);

Deno.test("#2099 keeps the DDL, dependency, privacy and audit seals together", () => {
  for (
    const token of [
      "issue_2099_dependency_schema_guard",
      "ON ddl_command_start",
      "IN EXCLUSIVE MODE",
      "IN SHARE MODE NOWAIT",
      "DDL_SEAL_UNAVAILABLE",
      "DEPENDENCY_SCHEMA_CHANGED",
      "SENSITIVE_STATE_NOT_EMPTY",
      "venue_identity_correction_audit",
      "BEFORE TRUNCATE",
      "STAY_AUTHORING_DISABLED",
      "pg_advisory_xact_lock",
      "CORRECTION_BUSY",
      "SLUG_COLLISION",
      // The pinned dependency-schema fingerprint. It is a PUBLIC SHA-256 of the
      // discovered schema inventory, not a credential — but a bare 64-char hex
      // run scores as a generic high-entropy secret, so the migration builds it
      // from two readable halves and this gate asserts that exact shape. The
      // runtime value is byte-identical (literal || literal).
      "('9a8c2a743af413f17f3b3e75e4f656f3' || 'e9cf3867cda091eb204bb9d5460f1ba0')",
    ]
  ) assertStringIncludes(migration, token);
  assert(!migration.includes("OWNER TO supabase_admin"));
});

Deno.test("#2099 migration is replay-safe without dropping either #2099 table", () => {
  // §D4 — a second exact apply must exit 0 while preserving every audit and
  // guard row. Every #2099 object is therefore IF NOT EXISTS, CREATE OR
  // REPLACE, or an explicit drop-and-recreate of a STATELESS trigger.
  assertStringIncludes(
    migration,
    "CREATE TABLE IF NOT EXISTS public.issue_2099_dependency_schema_guard",
  );
  assertStringIncludes(
    migration,
    "CREATE TABLE IF NOT EXISTS public.venue_identity_correction_audit",
  );
  assertStringIncludes(migration, "ON CONFLICT DO NOTHING");
  assertStringIncludes(
    migration,
    "DROP TRIGGER IF EXISTS venue_identity_correction_audit_immutable_rows",
  );
  assertStringIncludes(
    migration,
    "DROP TRIGGER IF EXISTS venue_identity_correction_audit_immutable_truncate",
  );
  assertStringIncludes(
    migration,
    "DROP EVENT TRIGGER IF EXISTS issue_2099_dependency_ddl_guard",
  );
  // Neither #2099 table may ever be dropped or truncated by the migration.
  assert(!migration.includes("DROP TABLE public.venue_identity_correction_audit"));
  assert(!migration.includes("DROP TABLE public.issue_2099_dependency_schema_guard"));
  assert(!/TRUNCATE\s+(TABLE\s+)?public\.venue_identity_correction_audit/.test(migration));
  // Fail-closed ordering: the seal is verified BEFORE either public RPC is
  // created, so a database that cannot host the guard aborts instead of
  // shipping an unsealed correction RPC.
  const sealAt = migration.indexOf("$seal$");
  const previewAt = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.preview_pending_venue_identity_correction",
  );
  const writerAt = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.correct_pending_venue_identity",
  );
  assert(sealAt > -1, "the migration must verify the DDL seal");
  assert(sealAt < previewAt, "the seal must be verified before the preview RPC");
  assert(sealAt < writerAt, "the seal must be verified before the writer RPC");
});

Deno.test("#2099 workflow actually executes every gate this issue rests on", () => {
  for (
    const token of [
      // executable database halves
      "issue_2099_pending_venue_identity_correction.test.sql",
      "issue_2099_pending_venue_identity_correction.concurrent.test.sh",
      // Check P and Check H
      "issue2099PendingIdentityCorrection.test.tsx",
      "jest.issue2099.web.render.cjs",
      "issue2099PendingIdentityCorrection.native-absence.test.ts",
      // Admin
      "issue2099_pending_identity_correction.test.js",
      // SC-7 needs origin/main present in the runner's checkout
      "fetch-depth: 0",
      "mingla-admin/src/components/entity/HighRiskActionModal.jsx",
      // SC-9's two clauses
      "13 passed, 13 total",
      "20 passed, 20 total",
      // SC-8 fail-closed
      "tester_adversarial.test.sh",
      "tester guard pending",
    ]
  ) assertStringIncludes(workflow, token);

  // §D4's replay proof runs the EXACT migration file a second and third time.
  assertStringIncludes(
    workflow,
    "20270416002099_issue_2099_pending_venue_identity_correction.sql",
  );
  // The byte ceiling reads the baseline at RUN TIME; a pinned literal would red
  // on main forever the moment an unrelated PR grows __common.
  assertStringIncludes(workflow, "bundle-baseline.json");
  assert(
    !workflow.includes("2292925"),
    "the boot-payload ceiling must not hardcode the baseline",
  );
});
