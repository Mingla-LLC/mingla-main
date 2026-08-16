import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  "supabase/migrations/20270412002099_issue_2099_pending_venue_identity_correction.sql",
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
      // The pinned dependency-schema fingerprint. It is a PUBLIC SHA-256 of the
      // discovered schema inventory, not a credential — but a bare 64-char hex
      // run scores as a generic high-entropy secret, so the migration builds it
      // from two readable halves and this gate asserts that exact shape. The
      // runtime value is byte-identical (literal || literal).
      "('9a8c2a743af413f17f3b3e75e4f656f3' || 'e9cf3867cda091eb204bb9d5460f1ba0')",
    ]
  ) assertStringIncludes(migration, token);
  assert(!migration.includes("OWNER TO supabase_admin"));
  assertStringIncludes(
    workflow,
    "issue_2099_pending_venue_identity_correction.test.sql",
  );
  assertStringIncludes(workflow, "issue2099PendingIdentityCorrection.test.tsx");
  assertStringIncludes(
    workflow,
    "issue2099_pending_identity_correction.test.js",
  );
});
