#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  migration: "supabase/migrations/20270611001772_issue_1772_brand_person_maintenance.sql",
  sqlTest: "supabase/migrations/__tests__/issue_1772_brand_person_maintenance.happy.pg17.test.sql",
  secretManifest: "supabase/secrets.manifest.json",
  secretTest: "scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs",
  secretContract: "supabase/functions/support-brand-person-erasure/erasureContract.ts",
  erasureHandler: "supabase/functions/support-brand-person-erasure/index.ts",
  erasureTest: "supabase/functions/support-brand-person-erasure/issue_1772_non_user_erasure.happy.test.ts",
  worker: "supabase/functions/brand-person-ingest-worker/index.ts",
  workerTest: "supabase/functions/brand-person-ingest-worker/issue_1772_erasure_tombstone.happy.test.ts",
  exportWorker: "supabase/functions/brand-people-export-worker/index.ts",
  exportWorkerTest: "supabase/functions/brand-people-export-worker/issue_1772_erasure_race.happy.test.ts",
  ciManifest: ".github/ci-batch/MANIFEST.json",
  validator: ".github/scripts/ci-batch/validate-manifest-v2.mjs",
  guard: ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
  service: "mingla-business/src/services/peopleService.ts",
  maintenanceService: "mingla-business/src/services/peopleMaintenanceService.ts",
  hook: "mingla-business/src/hooks/marketing/useBrandPersonMaintenance.ts",
  flow: "mingla-business/src/components/people/PersonMaintenanceFlow.tsx",
  detail: "mingla-business/src/components/people/PersonDetailView.tsx",
  sections: "mingla-business/src/components/people/PersonDetailSections.tsx",
  comparison: "mingla-business/src/components/people/PersonComparisonCard.tsx",
  receipt: "mingla-business/src/components/people/IdentityOperationReceipt.tsx",
  route: "mingla-business/app/(tabs)/people/[personId].tsx",
  peoplePage: "mingla-business/src/components/people/PeoplePage.tsx",
  peoplePageTest: "mingla-business/src/components/people/__tests__/PeoplePage.issue1772.conflict-deeplink.happy.test.tsx",
  serviceTest: "mingla-business/src/services/__tests__/peopleService.issue1772.happy.test.ts",
  hookTest: "mingla-business/src/hooks/marketing/__tests__/useBrandPersonMaintenance.issue1772.happy.test.tsx",
  detailTest: "mingla-business/src/components/people/__tests__/PersonDetailView.issue1772.happy.test.tsx",
  flowTest: "mingla-business/src/components/people/__tests__/PersonMaintenanceFlow.issue1772.happy.test.tsx",
  pgWorkflow: ".github/workflows/postgres-contract-suites.yml",
  denoWorkflow: ".github/workflows/supabase-migrations-and-stripe-deno.yml",
  invariant: "docs/INVARIANT_REGISTRY.md",
  erasureRunbook: "docs/runbooks/B2_GDPR_ERASURE_RUNBOOK.md",
  capacityRunbook: "docs/runbooks/SUPABASE_SECRET_CAPACITY.md",
  readinessGuard: ".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
  analyticsGuard: ".github/scripts/strict-grep/issue-1774-people-page.mjs",
  l5Mutations: ".github/scripts/parity/l5-terminal-mutations.sql",
  issue1773SqlTest: "supabase/migrations/__tests__/issue_1773_preserves_1857_phone_authority.pg17.test.sql",
};

function required(source, needle, label, failures) {
  if (!source.includes(needle)) failures.push(`missing ${label}`);
}

export function audit(base = repoRoot) {
  const failures = [];
  const read = (key) => {
    const relative = files[key];
    const target = path.join(base, relative);
    if (!fs.existsSync(target)) {
      failures.push(`${relative} missing`);
      return "";
    }
    return fs.readFileSync(target, "utf8");
  };

  const migration = read("migration");
  const sqlTest = read("sqlTest");
  const secretManifestText = read("secretManifest");
  const secretTest = read("secretTest");
  const secretContract = read("secretContract");
  const handler = read("erasureHandler");
  const erasureTest = read("erasureTest");
  const worker = read("worker");
  const workerTest = read("workerTest");
  const exportWorker = read("exportWorker");
  const exportWorkerTest = read("exportWorkerTest");
  const ciManifestText = read("ciManifest");
  const validator = read("validator");
  const guardSource = read("guard");
  const service = read("service");
  const maintenanceService = read("maintenanceService");
  const hook = read("hook");
  const flow = read("flow");
  const detail = read("detail");
  const sections = read("sections");
  const comparison = read("comparison");
  const receipt = read("receipt");
  const route = read("route");
  const peoplePage = read("peoplePage");
  const peoplePageTest = read("peoplePageTest");
  const pgWorkflow = read("pgWorkflow");
  const denoWorkflow = read("denoWorkflow");
  const invariant = read("invariant");
  const erasureRunbook = read("erasureRunbook");
  const capacityRunbook = read("capacityRunbook");
  const readinessGuard = read("readinessGuard");
  const analyticsGuard = read("analyticsGuard");
  const l5Mutations = read("l5Mutations");
  const issue1773SqlTest = read("issue1773SqlTest");
  read("serviceTest");
  read("hookTest");
  read("detailTest");
  read("flowTest");

  for (const needle of [
    "brand_person_maintenance_operations",
    "brand_person_erasure_challenges",
    "brand_person_erasure_keys",
    "brand_person_erasure_tombstones",
    "brand_person_erasure_operations",
    "brand_person_erasure_audit",
    "FORCE ROW LEVEL SECURITY",
    "issue_1772_brand_person_version",
    "issue_1772_merge_event_version",
    "biz_list_brand_person_merge_candidates",
    "biz_preview_brand_person_merge",
    "biz_merge_brand_people_manual",
    "biz_promote_brand_person_contact",
    "biz_list_brand_person_merge_history",
    "biz_preview_brand_person_split",
    "biz_reverse_brand_person_merge_manual",
    "biz_get_brand_person_maintenance_operation",
    "pg_advisory_xact_lock",
    "p_split_version IS DISTINCT FROM public.issue_1772_merge_event_version",
  ]) required(migration, needle, `migration contract ${needle}`, failures);
  if ((migration.match(/issue_1772_require_brand_rank\(p_brand_id,50\)/g) ?? []).length < 5) {
    failures.push("owner-only merge/split rank-50 gates missing");
  }
  for (const needle of [
    "'supersededSeparationIds'",
    "SET superseded_at=NULL,superseded_by=NULL,superseded_by_merge_event_id=NULL",
    "people_erased_contact_suppressed",
    "reason_code=''erased_contact''",
    "issue_1772_contact_tombstone_guard",
  ]) required(migration, needle, `identity restoration/tombstone ${needle}`, failures);
  for (const needle of [
    "delivery_state IN ('pending','dispatching','sent','failed')",
    "delivery_state IN('pending','dispatching','sent')",
    "issue_1772_claim_erasure_challenge_delivery",
    "SET delivery_state='dispatching'",
    "challenge_dispatch_claimed",
    "people_erasure_delivery_transition_invalid",
    "'state','delivery_unknown'",
  ]) required(migration, needle, `A3 dispatch contract ${needle}`, failures);
  if (!/jsonb_build_object\('caseReference',p_case_reference,[\s\S]{0,180}'contact',p_contact_method_id\)/.test(migration)) {
    failures.push("challenge intent hash does not bind the stable tuple");
  }
  const createHash = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1772_create_brand_person_erasure_challenge"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1772_claim_erasure_challenge_delivery"),
  );
  const hashExpression = createHash.slice(createHash.indexOf("v_hash:="), createHash.indexOf("PERFORM pg_advisory_xact_lock"));
  if (/p_challenge_id|p_code_hash/.test(hashExpression)) failures.push("challenge intent hash includes random challenge/code material");

  for (const needle of [
    "CREATE OR REPLACE FUNCTION public.issue_1772_lock_brand_person_address(\n  p_brand_id uuid",
    "other_contact.brand_person_id IS DISTINCT FROM target_contact.brand_person_id",
    "brand_contact_import_batches b",
    "WHERE b.id=r.batch_id AND b.brand_id=v_challenge.brand_id",
    "'matchedContact'",
    "IF v_row.state='completed' THEN",
    "prepared_storage_path",
    "safe_error_code='privacy_erasure'",
    "p_storage_path IN(storage_path,prepared_storage_path)",
  ]) required(migration, needle, `A6 integrity contract ${needle}`, failures);
  if (!/REVOKE ALL ON FUNCTION public\.issue_1772_lock_brand_person_address[\s\S]{0,160}FROM PUBLIC,anon,authenticated/.test(migration)) {
    failures.push("shared address lock is client executable");
  }
  for (const forbidden of [
    /superseded_by uuid[^;\n]*REFERENCES auth\.users/i,
    /brand_person_maintenance_operations[\s\S]{0,900}actor_id uuid[^;\n]*REFERENCES auth\.users/i,
    /brand_person_erasure_challenges[\s\S]{0,900}created_by uuid[^;\n]*REFERENCES auth\.users/i,
    /brand_person_erasure_operations[\s\S]{0,900}actor_id uuid[^;\n]*REFERENCES auth\.users/i,
    /brand_person_erasure_audit[\s\S]{0,900}actor_id uuid[^;\n]*REFERENCES auth\.users/i,
  ]) {
    if (forbidden.test(migration)) failures.push("immutable actor snapshot regained an auth lifecycle FK");
  }

  for (const rpc of [
    "biz_list_brand_person_merge_candidates",
    "biz_preview_brand_person_merge",
    "biz_merge_brand_people_manual",
    "biz_promote_brand_person_contact",
    "biz_list_brand_person_merge_history",
    "biz_preview_brand_person_split",
    "biz_reverse_brand_person_merge_manual",
    "biz_get_brand_person_maintenance_operation",
  ]) required(maintenanceService, `\"${rpc}\"`, `Business maintenance RPC ${rpc}`, failures);
  if (/\.from\s*\(/.test(service + maintenanceService)) failures.push("Business people service directly accesses a table");
  if (/peopleMaintenanceService/.test(service)) failures.push("eager People service imports or re-exports maintenance service");
  for (const rpc of [
    "biz_list_brand_person_merge_candidates",
    "biz_preview_brand_person_merge",
    "biz_merge_brand_people_manual",
    "biz_promote_brand_person_contact",
    "biz_list_brand_person_merge_history",
    "biz_preview_brand_person_split",
    "biz_reverse_brand_person_merge_manual",
    "biz_get_brand_person_maintenance_operation",
  ]) {
    if (service.includes(rpc)) failures.push(`maintenance RPC returned to eager peopleService: ${rpc}`);
  }
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test([service, maintenanceService, hook, flow, detail, route].join("\n"))) failures.push("Business maintenance surface contains service authority");
  for (const needle of ["stableMaintenanceRequestId", "maintenanceRequestIdsRef", "clientRequestId", "useInfiniteQuery", "cancelQueries", "removeQueries", "AsyncStorage", "RECOVERY_TTL_MS", "RECOVERY_MAX_PER_SCOPE", "storage_blocked", "retry_available", "check_again", 'invalidateMaintenance("none")', "retryRecoveredIntent"]) {
    required(hook, needle, `stable/offline hook contract ${needle}`, failures);
  }
  if ((hook.match(/stableMaintenanceRequestId\(/g) ?? []).length < 4) failures.push("mutations do not all use stable request IDs");
  for (const needle of [
    "const [survivorId, setSurvivorId] = React.useState<string | null>(null)",
    "label=\"Review merge\"",
    "survivorId === null",
    "disabled={!props.online || props.preview?.state !== \"ready\" || survivorId === null}",
    "<ConfirmDialog",
    "Every email and phone stays available.",
    "Past orders, tickets, RSVPs, bookings, payments, and sends do not change.",
    "Open Review",
    "Try again",
  ]) required(flow, needle, `approved maintenance UI ${needle}`, failures);
  for (const needle of [
    'import { ScrollView } from "../../wrappers/SmartScrollView"',
    "person.matchedContact",
    'announce("Merging people…")',
    'announce("Splitting merge…")',
    "fontScale >= 2",
    "androidOpaque",
    "result.survivorPersonId",
  ]) required(flow, needle, `A6 maintenance flow ${needle}`, failures);
  for (const needle of [
    "No merge history yet.",
    "initialError",
    "refreshError",
    "loadMoreError",
    "loadingMore",
    "hasNextPage",
    "fontScale >= 2",
  ]) required(sections, needle, `A6 history state ${needle}`, failures);
  for (const source of [comparison, receipt]) {
    required(source, "fontScale >= 2", "A6 200-percent text stacking", failures);
    required(source, "androidOpaque", "A6 Android opaque surface", failures);
  }
  required(receipt, 'backgroundColor: Platform.OS === "android" ? androidOpaque.successFill', "Android opaque receipt fill", failures);
  required(flow, "candidate.personId === mergeResult.survivorPersonId", "returned-survivor receipt facts", failures);
  for (const needle of [
    'AccessibilityInfo.announceForAccessibility("Making primary…")',
    'router.replace("/(tabs)/marketing/people?review=conflicts" as never)',
    "restoredMerge.survivorPersonId",
    "maintenance.acknowledgeRecovery()",
    "historyInitialError={historyFirstPageError}",
  ]) required(route, needle, `A6 route recovery ${needle}`, failures);
  for (const needle of [
    "routeParams.review !== \"conflicts\"",
    "consumedReviewSignalRef.current",
    "conflicts.kind === \"success\" && online && conflicts.openCount > 0",
    'capturePeople("people_conflict_queue_opened", { surface: "page" })',
    'router.replace("/(tabs)/marketing/people" as never)',
  ]) required(peoplePage, needle, `A6 conflict deep link ${needle}`, failures);
  required(peoplePageTest, "opens once, records once, and consumes the signal", "PeoplePage happy deep-link proof", failures);
  required(hook, "maintenanceRequestIdsRef.current,", "stable mutation request map", failures);
  required(hook, 'import AsyncStorage from "@react-native-async-storage/async-storage"', "durable recovery storage owner", failures);
  required(hook, "const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000", "24-hour recovery TTL", failures);
  required(hook, "const maintenanceRequestIdsRef = React.useRef<Map<string, string>>(new Map());", "stable request map lifetime", failures);
  required(hook, "await persistIntent", "storage-before-network mutation barrier", failures);
  required(hook, "await removePersistedIntent(recoveredIntentKey)", "explicit receipt acknowledgement clearing", failures);
  required(hook, "const enabledRead = isAuthReady && user !== null", "direct rank-20 auth authority", failures);
  required(hook, "const enabledMerge = isAuthReady && user !== null", "direct rank-50 auth authority", failures);
  required(hook, 'caught.code === "people_merge_stale"', "merge stale review barrier", failures);
  required(hook, 'caught.code === "people_split_stale"', "split stale review barrier", failures);
  if (/erase|erasure/i.test([flow, detail].join("\n"))) failures.push("erasure leaked into the Business UI");

  for (const needle of [
    "BRAND_PERSON_ERASURE_CHALLENGE_SECRET",
    "AD_CONVERSION_TOKENS",
    "Deno.env.get(name)",
    "btoa(binary) !== value",
    "decoded.byteLength < 32 || decoded.byteLength > 64",
    "bundle.byteLength >= MAX_BUNDLE_BYTES",
  ]) {
    const expected = needle === "bundle.byteLength >= MAX_BUNDLE_BYTES"
      ? "new TextEncoder().encode(bundle).byteLength >= MAX_BUNDLE_BYTES"
      : needle;
    required(secretContract, expected, `secret resolver ${needle}`, failures);
  }
  if ((secretContract.match(/Deno\.env\.get\(/g) ?? []).length !== 1) failures.push("secret resolver must have one environment read");
  required(secretContract, "const bundle = readEnv(ERASURE_SECRET_BUNDLE);", "sole credential-bundle read", failures);
  if (/readEnv\(ERASURE_SECRET_FIELD\)/.test(secretContract)) failures.push("direct field-name environment fallback is forbidden");
  if (/Deno\.env\.get\(["']BRAND_PERSON_ERASURE_CHALLENGE_SECRET["']\)/.test(secretContract + handler)) failures.push("direct secret fallback is forbidden");
  const diagnostic = secretContract.slice(secretContract.indexOf("export function erasureSecretDiagnostic"), secretContract.indexOf("export function createSixDigitCode"));
  if (/\b(?:raw|digest|prefix|length|value|secret|key)\s*:/.test(diagnostic)) failures.push("secret diagnostic exposes secret-derived material");
  const createHandler = handler.slice(handler.indexOf('if (body.action === "create_challenge")'), handler.indexOf('if (body.action === "execute")'));
  const createResolve = createHandler.indexOf("key = deps.resolveKey()");
  if (createResolve < 0 || ["deps.randomUuid()", "deps.randomCode()", "deps.hash(", "await deps.rpc(", "await deps.sendEmail(", "await deps.sendSms("].some((effect) => createResolve > createHandler.indexOf(effect))) {
    failures.push("create handler does not resolve the erasure key before side effects");
  }
  const executeHandler = handler.slice(handler.indexOf('if (body.action === "execute")'));
  const executeResolve = executeHandler.indexOf("key = deps.resolveKey()");
  if (executeResolve < 0 || ["deps.hash(", "await deps.rpc("].some((effect) => executeResolve > executeHandler.indexOf(effect))) {
    failures.push("execute handler does not resolve the erasure key before side effects");
  }
  for (const needle of ["beforeProviderIo", "issue_1772_claim_erasure_challenge_delivery", "claimState.outcome === \"unknown\"", "idempotencyKey,"]) {
    required(handler, needle, `A3 Edge dispatch ${needle}`, failures);
  }
  const smsCall = handler.slice(handler.indexOf(": await deps.sendSms({"), handler.indexOf("}).catch", handler.indexOf(": await deps.sendSms({")));
  if (smsCall.includes("idempotency")) failures.push("SMS dispatch gained a provider idempotency input");
  required(worker, 'message?.includes("people_erased_contact_suppressed")', "worker terminal tombstone mapping", failures);
  for (const needle of [
    "export async function expireFiles",
    "prepared_storage_path",
    "privacy_erasure",
    "observed?.status === \"ready\"",
    "import.meta.main",
  ]) required(exportWorker, needle, `A6 export cleanup ${needle}`, failures);
  if ((exportWorker.match(/if \(removeError\)/g) ?? []).length !== 2) {
    failures.push("both exact export deletion paths must retain markers only on Storage errors");
  }
  for (const needle of [
    "expireFiles",
    "prepared_storage_path",
    "privacy_erasure",
    "failed/crashed cleanup cleared a durable marker",
    "const second = expiryService(rows, objects)",
    'objects.has("brand/crash-window.csv")',
    "fake.erasurePass() !== 1",
    "prepare/upload erasure race did not converge without retry",
    "ambiguous completion deleted or retried an observed ready export",
  ]) required(exportWorkerTest, needle, `A6 export happy proof ${needle}`, failures);

  required(readinessGuard, '"marketing/useBrandPersonMaintenance.ts"', "ORCH-1004 registration", failures);
  required(analyticsGuard, "forbiddenAnalyticsKeys", "exact analytics forbidden-property scan", failures);
  required(analyticsGuard, '"email", "phone", "displayName", "personId", "brandId", "contactValue"', "exact forbidden analytics key set", failures);
  required(analyticsGuard, "contactValue?:string", "analytics self-test true mutation", failures);
  required(l5Mutations, "-- ===== M-1772-01 =====", "L-5 M-1772-01 section", failures);
  required(l5Mutations, "CREATE OR REPLACE FUNCTION public.l5_issue_1772_allow_novel_writer()", "L-5 fixture-scoped trigger function", failures);
  required(l5Mutations, "PERFORM 1 FROM public.brand_people WHERE id=NEW.brand_person_id FOR UPDATE;", "L-5 person-row serialization", failures);
  required(l5Mutations, "NEW.record_state:='retired';", "L-5 terminal survivor mutation", failures);
  required(l5Mutations, "CREATE TRIGGER a_l5_issue_1772_novel_writer", "L-5 early trigger ordering", failures);
  required(l5Mutations, "-- @l5-verify: SELECT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE id='17720000-0000-4000-8000-000000000904'::uuid)", "L-5 surviving-row witness", failures);
  required(pgWorkflow, "L-5 subjects: 25", "L-5 subject total", failures);
  required(pgWorkflow, 'psql call sites in the workflow: $call_sites', "L-5 call-site discovery", failures);
  required(issue1773SqlTest, "9815b94c8ae402c9b81d2b6613be66f3", "#1773 current writer fingerprint", failures);

  let secretManifest;
  try { secretManifest = JSON.parse(secretManifestText); } catch { failures.push("secret manifest is invalid JSON"); }
  const envelope = secretManifest?.secrets?.find((entry) => entry.name === "AD_CONVERSION_TOKENS");
  const field = envelope?.bundle_fields?.find((entry) => entry.name === "BRAND_PERSON_ERASURE_CHALLENGE_SECRET");
  if (!envelope?.readers?.includes(files.secretContract)) failures.push("secret manifest reader append missing");
  if (field?.owner !== "Platform Security" || field?.source_type !== "secure_vault") failures.push("secret field owner/source contract drifted");
  if ((secretManifest?.secrets ?? []).some((entry) => entry.name === "BRAND_PERSON_ERASURE_CHALLENGE_SECRET")) failures.push("standalone erasure secret name is forbidden");

  for (const needle of [
    "87-name envelope",
    "canonical standard Base64",
    "fail-closed handler ordering",
    "provider executes the Node proof before both happy Deno suites",
  ]) required(secretTest, needle, `secret proof ${needle}`, failures);
  for (const needle of ["beforeProviderIo", "dispatching", "erasure_challenge_state_unknown"]) required(erasureTest, needle, `Edge happy proof ${needle}`, failures);
  required(workerTest, "erased_contact_suppressed", "worker happy proof", failures);
  for (const needle of ["BEGIN;", "ROLLBACK;", "biz_merge_brand_people_manual", "biz_reverse_brand_person_merge_manual", "issue_1772_claim_erasure_challenge_delivery", "delivery_unknown"]) {
    required(sqlTest, needle, `PostgreSQL happy proof ${needle}`, failures);
  }
  required(pgWorkflow, "run_psql M-1772-01 suite_1772 supabase/migrations/__tests__/issue_1772_brand_person_maintenance.happy.pg17.test.sql", "PostgreSQL CI command", failures);
  const nodeCommand = "node --test scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs";
  required(denoWorkflow, nodeCommand, "secret CI command", failures);
  required(denoWorkflow, files.erasureTest, "erasure happy CI command", failures);
  required(denoWorkflow, files.workerTest, "worker happy CI command", failures);
  required(denoWorkflow, "supabase/functions/brand-people-export-worker/issue_1772_erasure_race.*.test.ts", "export happy/tester CI glob", failures);
  if ((denoWorkflow.match(/supabase\/functions\/brand-people-export-worker\/\*\*/g) ?? []).length !== 2) {
    failures.push("export worker push/pull path filters are not exact");
  }
  if (!(denoWorkflow.indexOf(nodeCommand) < denoWorkflow.indexOf(files.erasureTest) && denoWorkflow.indexOf(nodeCommand) < denoWorkflow.indexOf(files.workerTest))) {
    failures.push("secret proof must run before Edge happy tests");
  }
  for (const needle of ["I-PROPOSED-1772-IDENTITY-MAINTENANCE-ATOMIC", "I-PROPOSED-1772-NONUSER-ERASURE-TOMBSTONED", "I-PROPOSED-1772-NO-ERASURE-UI"]) {
    required(invariant, needle, `invariant ${needle}`, failures);
  }
  required(erasureRunbook, "erasure_challenge_state_unknown", "runbook unknown-delivery hold", failures);
  required(capacityRunbook, "BRAND_PERSON_ERASURE_CHALLENGE_SECRET", "capacity runbook field", failures);

  const postgresReferences = [
    ".github/scripts/strict-grep/issue-1397-fx-refresh-eol-cron.mjs",
    ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
    ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.self-test.mjs",
    "supabase/functions/payout-release-sweep/__tests__/issue_1172_stripe_payout_rework.test.ts",
    "supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts.test.ts",
    "supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts_adversarial.test.ts",
  ];
  const supabaseReferences = [
    ".gitguardian.yml",
    ".github/scripts/strict-grep/MANIFEST.json",
    ".github/scripts/strict-grep/issue-1424-stay-business-authoring.adversarial.test.mjs",
    ".github/scripts/strict-grep/issue-1424-stay-business-authoring.mjs",
    ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
    ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.self-test.mjs",
    ".github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs",
    ".github/scripts/strict-grep/issue-1977-ari-rsvp-lifecycle.mjs",
    ".github/scripts/strict-grep/issue-2013-ari-tenant-containment.mjs",
    "scripts/issue-1860/issue-1860-public-tables-rls.tester.adversarial.test.mjs",
    "scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs",
    "supabase/functions/__tests__/orch_1289_stop_footer_wire_preview_parity.tester.test.ts",
    "supabase/migrations/__tests__/issue_2725_competitor_intelligence_happy.test.js",
    "supabase/migrations/__tests__/issue_855_pr1_numbers_engine_rollups.test.sql",
    "supabase/migrations/__tests__/issue_855_pr2_source_tracking.test.sql",
    "supabase/migrations/__tests__/issue_865_attribution_conversion_schema.test.sql",
    "supabase/migrations/__tests__/issue_865_pr1_rollup_rls.test.sql",
  ];
  let ciManifest;
  try { ciManifest = JSON.parse(ciManifestText); } catch { failures.push("CI batch manifest is invalid JSON"); }
  const provider = (workflow) => ciManifest?.workflowProviders?.find((entry) => entry.workflow === workflow);
  if (JSON.stringify(provider("postgres-contract-suites.yml")?.referenceFiles) !== JSON.stringify(postgresReferences)) {
    failures.push("PostgreSQL provider reference inventory is not the exact A4 live discovery");
  }
  if (JSON.stringify(provider("supabase-migrations-and-stripe-deno.yml")?.referenceFiles) !== JSON.stringify(supabaseReferences)) {
    failures.push("Supabase provider reference inventory is not the exact A4 live discovery");
  }
  for (const falseReference of [
    "supabase/migrations/__tests__/issue_1772_brand_person_maintenance.happy.pg17.test.sql",
    "supabase/functions/brand-person-ingest-worker/issue_1772_erasure_tombstone.happy.test.ts",
    "supabase/functions/support-brand-person-erasure/issue_1772_non_user_erasure.happy.test.ts",
    "supabase/functions/brand-people-export-worker/issue_1772_erasure_race.happy.test.ts",
  ]) {
    if (postgresReferences.includes(falseReference) || supabaseReferences.includes(falseReference)
        || provider("postgres-contract-suites.yml")?.referenceFiles?.includes(falseReference)
        || provider("supabase-migrations-and-stripe-deno.yml")?.referenceFiles?.includes(falseReference)) {
      failures.push(`execution-only file falsely registered as provider reference: ${falseReference}`);
    }
  }

  for (const needle of [
    'const LOCKED_PROVIDER_DISCOVERY_SHA256 = "c0813be9c105418cd60697b22be5ae5dbc2055b03895c2e5c77f68606a498a7f";',
    'const LOCKED_PHASE3B_PROVIDER_DISCOVERY_SHA256 = "1676cbe80860ee0181cf95fcbd70dcb95a9d535066161e25f11348212264abc1";',
    "const expectedProviderCount = 91 + PROVIDERS_ADDED_SINCE_SEAL.length;",
    "sealedDiscovery.length !== 73",
    "issue: 2855",
    "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
    "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.tester_adversarial.test.sql",
    "issue: 1772",
    'workflow: "supabase-migrations-and-stripe-deno.yml"',
  ]) required(validator, needle, `A4 validator pin ${needle}`, failures);
  for (const reference of postgresReferences.slice(1, 3)) {
    if ((validator.split(reference).length - 1) !== 2) failures.push(`A4 validator must declare ${reference} exactly twice`);
  }
  if ((validator.split("scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs").length - 1) !== 1) {
    failures.push("A4 validator must declare the #1772 secret proof exactly once");
  }
  const validatorCommand = "node .github/scripts/ci-batch/validate-manifest-v2.mjs";
  required(guardSource, validatorCommand, "exact A4 validator command", failures);

  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = audit();
  if (failures.length > 0) {
    console.error(`[issue-1772] FAIL\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    process.exit(1);
  }
  console.log("[issue-1772] PASS — maintenance remains atomic, RPC-only, tombstoned, one-shot dispatched, and UI-bounded.");
}
