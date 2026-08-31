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
  "supabase/functions/brand-people-export-worker/index.ts",
  "supabase/functions/brand-people-export-worker/issue_1772_erasure_race.happy.test.ts",
  "mingla-business/src/services/peopleService.ts",
  "mingla-business/src/services/peopleMaintenanceService.ts",
  "mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts",
  "mingla-business/src/components/people/PersonMaintenanceFlow.tsx",
  "mingla-business/src/components/people/PersonDetailView.tsx",
  "mingla-business/src/components/people/PersonDetailSections.tsx",
  "mingla-business/src/components/people/PersonComparisonCard.tsx",
  "mingla-business/src/components/people/IdentityOperationReceipt.tsx",
  "mingla-business/app/(tabs)/people/[personId].tsx",
  "mingla-business/src/components/people/PeoplePage.tsx",
  "mingla-business/src/components/people/__tests__/PeoplePage.issue1772.conflict-deeplink.happy.test.tsx",
  "mingla-business/src/services/__tests__/peopleService.issue1772.happy.test.ts",
  "mingla-business/src/hooks/marketing/__tests__/useBrandPersonMaintenance.issue1772.happy.test.tsx",
  "mingla-business/src/components/people/__tests__/PersonDetailView.issue1772.happy.test.tsx",
  "mingla-business/src/components/people/__tests__/PersonMaintenanceFlow.issue1772.happy.test.tsx",
  ".github/workflows/postgres-contract-suites.yml",
  ".github/workflows/supabase-migrations-and-stripe-deno.yml",
  "docs/INVARIANT_REGISTRY.md",
  "docs/runbooks/B2_GDPR_ERASURE_RUNBOOK.md",
  "docs/runbooks/SUPABASE_SECRET_CAPACITY.md",
  ".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
  ".github/scripts/strict-grep/issue-1774-people-page.mjs",
  ".github/scripts/parity/l5-terminal-mutations.sql",
  "supabase/migrations/__tests__/issue_1773_preserves_1857_phone_authority.pg17.test.sql",
];

const mutations = [
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "CREATE OR REPLACE FUNCTION public.biz_guest_roster_set_rsvp_approval(", "", "legacy person-key RSVP projection"],
  ["supabase/migrations/__tests__/issue_1772_brand_person_maintenance.happy.pg17.test.sql", "legacy person-key RSVP wrapper lost projected roster DTO", "legacy person-key proof removed", "legacy RSVP runtime DTO proof"],
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
  [".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs", '  "marketing/useBrandPersonMaintenance.ts",', "", "A6 auth-readiness registration"],
  [".github/scripts/strict-grep/issue-1774-people-page.mjs", '"email", "phone", "displayName", "personId", "brandId", "contactValue"', '"safeEmail", "phone", "displayName", "personId", "brandId", "contactValue"', "A6 exact analytics key scan"],
  [".github/scripts/parity/l5-terminal-mutations.sql", "-- ===== M-1772-01 =====", "-- ===== M-1772-REMOVED =====", "A6 L-5 terminal mutation"],
  [".github/scripts/parity/l5-terminal-mutations.sql", "CREATE OR REPLACE FUNCTION public.l5_issue_1772_allow_novel_writer()", "CREATE OR REPLACE FUNCTION public.l5_issue_1772_allow_novel_writer_removed()", "A7 L-5 fixture-scoped trigger function"],
  [".github/scripts/parity/l5-terminal-mutations.sql", "PERFORM 1 FROM public.brand_people WHERE id=NEW.brand_person_id FOR UPDATE;", "PERFORM 1 FROM public.brand_people WHERE id=NEW.brand_person_id;", "A7 L-5 person-row serialization"],
  [".github/scripts/parity/l5-terminal-mutations.sql", "NEW.record_state:='retired';", "NEW.record_state:='active';", "A7 L-5 terminal survivor mutation"],
  [".github/scripts/parity/l5-terminal-mutations.sql", "CREATE TRIGGER a_l5_issue_1772_novel_writer", "CREATE TRIGGER z_l5_issue_1772_novel_writer", "A7 L-5 early trigger ordering"],
  [".github/scripts/parity/l5-terminal-mutations.sql", "-- @l5-verify: SELECT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE id='17720000-0000-4000-8000-000000000904'::uuid)", "-- @l5-verify: SELECT false", "A7 L-5 surviving-row witness"],
  ["supabase/migrations/__tests__/issue_1773_preserves_1857_phone_authority.pg17.test.sql", "9815b94c8ae402c9b81d2b6613be66f3", "00000000000000000000000000000000", "A6 #1773 writer fingerprint"],
  ["mingla-business/src/services/peopleMaintenanceService.ts", '"biz_list_brand_person_merge_candidates"', '"biz_list_brand_person_merge_candidates_removed"', "A6 lazy maintenance RPC owner"],
  ["mingla-business/src/services/peopleService.ts", "export class PeopleServiceError", 'export { mergeBrandPeople } from "./peopleMaintenanceService";\nexport class PeopleServiceError', "A6 no eager maintenance re-export"],
  ["mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts", 'import AsyncStorage from "@react-native-async-storage/async-storage"', 'const AsyncStorage = null as never', "A6 durable recovery owner"],
  ["mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts", "const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000", "const RECOVERY_TTL_MS = 60 * 1000", "A6 recovery TTL"],
  ["mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts", 'caught.code === "people_merge_stale"', "false", "A6 merge stale barrier"],
  ["mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts", 'caught.code === "people_split_stale"', "false", "A6 split stale barrier"],
  ["mingla-business/src/components/people/PersonMaintenanceFlow.tsx", 'import { ScrollView } from "../../wrappers/SmartScrollView"', 'import { ScrollView } from "react-native"', "A6 canonical SmartScrollView"],
  ["mingla-business/src/components/people/PersonMaintenanceFlow.tsx", "person.matchedContact", "null", "A6 visible matched alternate"],
  ["mingla-business/src/components/people/PersonMaintenanceFlow.tsx", "candidate.personId === mergeResult.survivorPersonId", "candidate.personId === survivorId", "A6 returned-survivor receipt"],
  ["mingla-business/src/components/people/PersonMaintenanceFlow.tsx", 'announce("Merging people…")', "", "A6 merge announcement"],
  ["mingla-business/src/components/people/PersonDetailSections.tsx", "No merge history yet.", "", "A6 first-page history empty state"],
  ["mingla-business/src/components/people/PersonComparisonCard.tsx", "fontScale >= 2", "false", "A6 200-percent comparison"],
  ["mingla-business/src/components/people/IdentityOperationReceipt.tsx", 'backgroundColor: Platform.OS === "android" ? androidOpaque.successFill', 'backgroundColor: glass.tint.profileBase', "A6 Android opaque receipt"],
  ["mingla-business/app/(tabs)/people/[personId].tsx", 'AccessibilityInfo.announceForAccessibility("Making primary…")', "", "A6 promote announcement"],
  ["mingla-business/src/components/people/PeoplePage.tsx", 'routeParams.review !== "conflicts"', "false", "A6 exact conflict signal"],
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "CREATE OR REPLACE FUNCTION public.issue_1772_lock_brand_person_address(\n  p_brand_id uuid", "CREATE OR REPLACE FUNCTION public.issue_1772_lock_brand_person_address_removed(\n  p_brand_id uuid", "A6 shared address lock"],
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "WHERE b.id=r.batch_id AND b.brand_id=v_challenge.brand_id", "WHERE b.id=r.batch_id", "A6 brand-scoped import scrub"],
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "actor_id uuid NOT NULL,", "actor_id uuid NOT NULL REFERENCES auth.users(id),", "A6 immutable actor snapshot"],
  ["supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql", "IF v_row.state='completed' THEN", "IF false THEN", "A6 absorbing cleanup"],
  ["supabase/functions/brand-people-export-worker/index.ts", 'observed?.status === "ready"', "false", "A6 ready completion ambiguity"],
  ["supabase/functions/brand-people-export-worker/index.ts", "if (removeError) continue;", "if (false) continue;", "A6 expiry Storage-error barrier"],
  ["supabase/functions/brand-people-export-worker/index.ts", "if (removeError) {", "if (false) {", "A6 completion Storage-error barrier"],
  ["supabase/functions/brand-people-export-worker/issue_1772_erasure_race.happy.test.ts", "failed/crashed cleanup cleared a durable marker", "unguarded cleanup", "A6 export cleanup happy proof"],
  ["supabase/functions/brand-people-export-worker/issue_1772_erasure_race.happy.test.ts", "const second = expiryService(rows, objects)", "const second = expiryService(rows)", "A6 idempotent absent-object convergence"],
  [".github/workflows/supabase-migrations-and-stripe-deno.yml", "supabase/functions/brand-people-export-worker/issue_1772_erasure_race.*.test.ts", "echo export-tests-skipped", "A6 export tests CI wiring"],
  [".github/workflows/supabase-migrations-and-stripe-deno.yml", '      - "supabase/functions/brand-people-export-worker/**"', "", "A6 export path filters"],
  [".github/workflows/postgres-contract-suites.yml", "L-5 subjects: 25", "L-5 subjects: 24", "A6 L-5 subject total"],
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
