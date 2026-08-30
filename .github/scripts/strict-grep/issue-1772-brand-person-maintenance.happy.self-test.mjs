#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./issue-1772-brand-person-maintenance.happy.mjs";

if (!process.argv.includes("--self-test")) {
  console.error("usage: issue-1772-brand-person-maintenance.happy.self-test.mjs --self-test");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tracked = [
  ".github/ci-batch/MANIFEST.json",
  ".github/scripts/ci-batch/validate-manifest-v2.mjs",
  ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
  "supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql",
  "supabase/migrations/__tests__/issue_1772_brand_person_maintenance.happy.pg17.test.sql",
  "supabase/secrets.manifest.json",
  "scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs",
  "supabase/functions/support-brand-person-erasure/erasureContract.ts",
  "supabase/functions/support-brand-person-erasure/index.ts",
  "supabase/functions/support-brand-person-erasure/issue_1772_non_user_erasure.happy.test.ts",
  "supabase/functions/brand-person-ingest-worker/index.ts",
  "supabase/functions/brand-person-ingest-worker/issue_1772_erasure_tombstone.happy.test.ts",
  "mingla-business/src/services/peopleService.ts",
  "mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts",
  "mingla-business/src/components/people/PersonMaintenanceFlow.tsx",
  "mingla-business/src/components/people/PersonDetailView.tsx",
  "mingla-business/src/services/__tests__/peopleService.issue1772.happy.test.ts",
  "mingla-business/src/hooks/marketing/__tests__/useBrandPersonMaintenance.issue1772.happy.test.tsx",
  "mingla-business/src/components/people/__tests__/PersonDetailView.issue1772.happy.test.tsx",
  "mingla-business/src/components/people/__tests__/PersonMaintenanceFlow.issue1772.happy.test.tsx",
  ".github/workflows/postgres-contract-suites.yml",
  ".github/workflows/supabase-migrations-and-stripe-deno.yml",
  "docs/INVARIANT_REGISTRY.md",
  "docs/runbooks/B2_GDPR_ERASURE_RUNBOOK.md",
  "docs/runbooks/SUPABASE_SECRET_CAPACITY.md",
];

const mutations = [
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "issue_1772_require_brand_rank(p_brand_id,50)", "issue_1772_require_brand_rank(p_brand_id,20)", "rank-50 authority"],
  ["mingla-business/src/components/people/PersonMaintenanceFlow.tsx", 'disabled={!props.online || props.preview?.state !== "ready" || survivorId === null}', 'disabled={!props.online || props.preview?.state !== "ready"}', "explicit survivor confirmation"],
  ["mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts", "const maintenanceRequestIdsRef = React.useRef<Map<string, string>>(new Map());", "const maintenanceRequestIdsRef = { current: new Map<string, string>() };", "stable mutation request ID"],
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "SET superseded_at=NULL,superseded_by=NULL,superseded_by_merge_event_id=NULL", "SET superseded_at=now()", "separation restoration"],
  ["supabase/functions/brand-person-ingest-worker/index.ts", 'message?.includes("people_erased_contact_suppressed")', "false", "terminal ingest tombstone mapping"],
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "SET delivery_state='dispatching'", "SET delivery_state='sent'", "one-shot DB dispatch claim"],
  ["supabase/secrets.manifest.json", "BRAND_PERSON_ERASURE_CHALLENGE_SECRET", "BRAND_PERSON_ERASURE_SHARED_SECRET", "bundle field"],
  ["supabase/secrets.manifest.json", "supabase/functions/support-brand-person-erasure/erasureContract.ts", "supabase/functions/support-brand-person-erasure/index.ts", "sole manifest reader"],
  ["supabase/secrets.manifest.json", '"name":"BRAND_PERSON_ERASURE_CHALLENGE_SECRET","owner":"Platform Security","source_type":"secure_vault"', '"name":"BRAND_PERSON_ERASURE_CHALLENGE_SECRET","owner":"Growth Engineering","source_type":"provider_dashboard"', "field ownership/source"],
  ["supabase/functions/support-brand-person-erasure/erasureContract.ts", "const bundle = readEnv(ERASURE_SECRET_BUNDLE);", "const bundle = readEnv(ERASURE_SECRET_FIELD) ?? readEnv(ERASURE_SECRET_BUNDLE);", "direct-name fallback"],
  ["supabase/functions/support-brand-person-erasure/erasureContract.ts", "if (btoa(binary) !== value) fail(\"field_invalid_base64\");", "// canonical round-trip removed", "canonical decoder"],
  ["supabase/functions/support-brand-person-erasure/index.ts", "key = deps.resolveKey();", "key = new Uint8Array(32);", "key-before-effects fail closed"],
  ["supabase/functions/support-brand-person-erasure/erasureContract.ts", "phase,\n  });", "phase,\n    raw: error.message,\n  });", "PII-free secret diagnostic"],
  [".github/workflows/supabase-migrations-and-stripe-deno.yml", "node --test scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs", "echo secret-proof-skipped", "secret proof CI order"],
  [".github/scripts/ci-batch/validate-manifest-v2.mjs", '      ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",', "", "A4 provider declaration path"],
  [".github/ci-batch/MANIFEST.json", '        "scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs",', '        "scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs",\n        "supabase/functions/support-brand-person-erasure/issue_1772_non_user_erasure.happy.test.ts",', "A4 false execution-only reference"],
  [".github/scripts/ci-batch/validate-manifest-v2.mjs", "c0813be9c105418cd60697b22be5ae5dbc2055b03895c2e5c77f68606a498a7f", "e131ad9049ef802559522d05b4dc177788c6e3252c25a6445e9b4cde7c1fd5dc", "frozen provider seal"],
  [".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs", "node .github/scripts/ci-batch/validate-manifest-v2.mjs", "node validator-command-removed.mjs", "exact validator command"],
];

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "issue-1772-self-test-"));
try {
  for (const relative of tracked) {
    const destination = path.join(temp, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, relative), destination);
  }
  const clean = audit(temp);
  if (clean.length > 0) throw new Error(`clean fixture failed: ${clean.join("; ")}`);
  for (const [relative, needle, replacement, label] of mutations) {
    const target = path.join(temp, relative);
    const original = fs.readFileSync(target, "utf8");
    if (!original.includes(needle)) throw new Error(`fixture needle missing: ${label}`);
    fs.writeFileSync(target, original.replace(needle, replacement));
    if (audit(temp).length === 0) throw new Error(`negative control stayed green: ${label}`);
    fs.writeFileSync(target, original);
    const restored = audit(temp);
    if (restored.length > 0) throw new Error(`restore stayed red (${label}): ${restored.join("; ")}`);
  }
  console.log(`[issue-1772 self-test] PASS — ${mutations.length} true mutations fail and restore cleanly.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
