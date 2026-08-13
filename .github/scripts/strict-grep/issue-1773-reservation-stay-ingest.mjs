#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APPROVED_PHONE_LOGIC_SHA256 = "6c3a054d92c93e9bcebc001a188fa4c2eebe711dbc98c68d65d2006956c2ec35";
const files = {
  migration: "supabase/migrations/20270327001773_issue_1773_reservation_stay_ingest.sql",
  worker: "supabase/functions/brand-person-ingest-worker/index.ts",
  adapter: "packages/card-identity/phone.mjs",
  sqlTest: "supabase/migrations/__tests__/issue_1773_reservation_stay_ingest.test.sql",
  phoneAuthoritySuccessor: "supabase/migrations/__tests__/issue_1773_preserves_1857_phone_authority.pg17.test.sql",
  artifactTest: "supabase/functions/brand-person-ingest-worker/issue_1773_worker_cjs_artifact.test.ts",
  workflow: ".github/workflows/issue-1773-reservation-stay-ingest-tests.yml",
  invariant: "docs/INVARIANT_REGISTRY.md",
};

export function inspect(source) {
  const failures = [];
  const need = (where, token, label) => {
    if (!source[where]?.includes(token)) failures.push(`missing ${label}`);
  };
  need("migration", "'reservation','stay_reservation'", "distinct source kinds");
  need("migration", "e.event_type='stay_reservation_confirmed'", "historical confirmation eligibility");
  need("migration", "AFTER INSERT ON public.stay_reservation_events", "confirmation event trigger");
  need("migration", "p_normalized_phone_e164 text", "three-argument phone seam");
  need("migration", "v_phone_country_iso !~ '^[A-Z]{2}$'", "explicit uppercase ISO guard");
  need("migration", "v_phone_country_iso NOT IN ('US','CA','GB','NG','FR','DE','BE','ES','PT')", "canonical supported-country boundary");
  need("migration", "'rawPhone',NULLIF(btrim(NEW.guest_phone_e164),'')", "reservation raw-phone revision");
  need("migration", "'phoneCountryIso',NEW.guest_phone_country_iso", "reservation ISO revision");
  need("migration", "r.guest_phone_country_iso,r.created_at", "retained RSVP ISO readback");
  need("migration", "SET phone_country_iso=v_phone_country_iso", "retained phone provenance ISO refresh");
  need("migration", "EXCEPTION WHEN OTHERS", "fail-open exception handling");
  need("migration", "source=% table=%", "PII-free warning");
  need("migration", "biz_record_brand_person_suppression", "suppression reprojection");
  need("migration", "FROM public.reservations r ON CONFLICT DO NOTHING", "reservation backfill");
  need("migration", "FROM public.stay_reservation_groups g", "Stay backfill");
  need("migration", "REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon,authenticated", "service-only overload");
  if (/CREATE\s+TRIGGER[\s\S]{0,120}ON\s+public\.stay_reservation_groups/i.test(source.migration ?? "")) failures.push("Stay group trigger is forbidden");
  need("worker", 'import { resolveUserPhoneE164 } from "../../../packages/card-identity/phone.mjs";', "exact named ESM adapter import");
  need("worker", "resolveUserPhoneE164(", "single canonical adapter call");
  need("worker", '"phone:guest_snapshot->>phone,phoneCountryIso:guest_snapshot->>phoneCountryIso"', "phone-only Stay projection");
  need("worker", '| "reservation"', "reservation worker kind");
  need("worker", '| "stay_reservation"', "Stay worker kind");
  if (/PHONE_PLANS|dial:\s*['"]|defaultCountry|DEFAULT_COUNTRY|createRequire|module\.exports|require\s*\(|globalThis/.test(source.worker ?? "")) failures.push("copied phone logic, CommonJS wrapper, or global bridge in worker");
  if ((source.worker ?? "").includes('packages/card-identity/package.json')) failures.push("worker relies on JSON side-effect import");
  if (source.adapterKind !== "regular") failures.push("phone.mjs is not one regular filesystem file");
  if (source.legacyJsExists || source.legacyCjsExists) failures.push("legacy phone.js/phone.cjs owner remains");
  if (source.logicSha256 !== APPROVED_PHONE_LOGIC_SHA256) failures.push("canonical phone logic region drifted from approved implementation");
  if ((source.adapter ?? "").includes("module.exports")) failures.push("phone.mjs contains CommonJS export");
  need("adapter", "export {\n  dialablePhone,\n  resolveUserPhoneE164,\n  supportedDialCountries,\n  PLANS as PHONE_PLANS,\n};", "exact named ESM exports");
  if (/export\s+default/.test(source.adapter ?? "")) failures.push("phone.mjs has a default export");
  if (/phone\.(?:js|cjs)|@mingla\/card-identity\/phone["']/.test(source.consumerImports ?? "")) failures.push("consumer retains a legacy or extensionless phone import");
  if (/createRequire|module\.exports|globalThis|unstable[^\n]*cjs/i.test(source.phoneScoped ?? "")) failures.push("phone graph retains forbidden CJS/global/unstable mechanism");
  need("artifactTest", 'const expectedUploadedFiles = [', "exact upload allowlist");
  need("artifactTest", 'if (!adapterInfo.isFile || adapterInfo.isSymlink)', "regular source .mjs assertion");
  need("artifactTest", 'gitMode.output.startsWith("100644 ")', "regular Git-mode assertion");
  need("artifactTest", 'if (!stagedInfo.isFile || stagedInfo.isSymlink)', "regular staged .mjs assertion");
  need("artifactTest", 'packages/card-identity/package.json', "staged package.json absence assertion");
  need("artifactTest", 'Supabase CLI did not upload canonical phone.mjs bytes', "CLI canonical-byte assertion");
  need("artifactTest", 'phoneModule.kind !== "esm" || phoneModule.mediaType !== "Mjs"', "Deno esm/Mjs graph assertion");
  need("artifactTest", 'bundleSource.includes("module.exports")', "bundle CommonJS absence assertion");
  need("artifactTest", 'decode(version.stdout).trim() !== "2.98.2"', "Supabase CLI version assertion");
  need("artifactTest", 'denoVersion.output.startsWith("deno 2.9.5 ")', "Deno version assertion");
  need("artifactTest", '["check", entrypoint]', "plain artifact check");
  need("artifactTest", 'worker did not load', "worker module load proof");
  need("artifactTest", '"+2348034821689"', "canonical adapter execution proof");
  need("sqlTest", "operational update enqueued", "operational no-op regression");
  need("sqlTest", "strict phone spoof was accepted", "anti-spoof regression");
  need("sqlTest", "unsupported ISO phone spoof was accepted", "unsupported-ISO regression");
  need("sqlTest", "lowercase ISO phone spoof was accepted", "lowercase-ISO regression");
  need("sqlTest", "twelfth failure did not become dead", "retry/dead regression");
  need("sqlTest", "suppression retry/replay failed", "suppression retry regression");
  need("sqlTest", "old source path % regressed", "four-kind legacy resolver regression");
  need("sqlTest", "backfill replay duplicated work", "behavioral backfill regression");
  need("phoneAuthoritySuccessor", "guest_phone_country_iso='CA'", "RSVP ISO-only correction");
  need("phoneAuthoritySuccessor", "count(DISTINCT revision_key)", "distinct ISO revision proof");
  need("phoneAuthoritySuccessor", "c.normalized_value='+19194199222'", "strict E.164 identity proof");
  need("phoneAuthoritySuccessor", "issue_1773_1857_national_phone_was_guessed_or_stored", "national-number refusal proof");
  need("phoneAuthoritySuccessor", "issue_1773_1857_invalid_country_was_accepted", "invalid-country refusal proof");
  need("phoneAuthoritySuccessor", "'event_rsvp','rsvp_plus_one','order','ticket_holder','reservation','stay_reservation'", "six source domains coexistence");
  need("phoneAuthoritySuccessor", "p.prosecdef", "SECURITY DEFINER proof");
  need("phoneAuthoritySuccessor", "search_path=public, pg_temp", "pinned search path proof");
  need("phoneAuthoritySuccessor", "issue_1773_1857_security_contract_drift", "service-only ACL proof");
  need("phoneAuthoritySuccessor", "ALTER FUNCTION ", "two-function deliberate drift proof");
  need("phoneAuthoritySuccessor", "ROLLBACK;", "rollback-only successor");
  need("workflow", "issue_1773_reservation_stay_ingest.test.sql", "SQL workflow registration");
  need("workflow", "issue_1773_worker_cjs_artifact.test.ts", "deployment artifact regression wiring");
  need("workflow", "issue_1773_preserves_1857_phone_authority.pg17.test.sql", "phone-authority successor wiring");
  if ((source.workflow ?? "").includes("--unstable-detect-cjs")) failures.push("workflow relies on unstable CommonJS detection");
  need("workflow", "deno-version: v2.9.5", "Deno 2.9.5 workflow pin");
  need("workflow", "supabase/setup-cli@v1", "Supabase CLI setup");
  need("workflow", "version: 2.98.2", "Supabase CLI 2.98.2 workflow pin");
  need("workflow", "issue-1773-reservation-stay-ingest.mjs --self-test", "gate self-test wiring");
  need("invariant", "#1773 ACTIVE extension", "ACTIVE invariant extension");
  return failures;
}

function readSources() {
  const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), "utf8")]));
  const adapterPath = path.join(root, files.adapter);
  source.adapterKind = fs.lstatSync(adapterPath).isFile() && !fs.lstatSync(adapterPath).isSymbolicLink() ? "regular" : "other";
  source.legacyJsExists = fs.existsSync(path.join(root, "packages/card-identity/phone.js"));
  source.legacyCjsExists = fs.existsSync(path.join(root, "packages/card-identity/phone.cjs"));
  const footer = source.adapter.lastIndexOf("\nexport {");
  const start = source.adapter.indexOf("'use strict';");
  source.logicSha256 = createHash("sha256").update(source.adapter.slice(start, footer)).digest("hex");
  const consumers = [
    "app-mobile/src/components/ExpandedCardModal.tsx",
    "app-mobile/src/components/expandedCard/ActionButtons.tsx",
    "app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx",
    "app-mobile/src/components/stay/ConsumerStayGuestExperience.tsx",
    "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    "mingla-business/src/components/event/useBusinessRsvpPhoneField.tsx",
    "mingla-business/src/components/stay/BuyerStayGuestExperience.tsx",
    "packages/card-identity/__tests__/issue_1703_dialable_phone.test.mjs",
    "packages/card-identity/__tests__/issue_1857_phone_country_authority.happy.test.mjs",
    "packages/card-identity/__tests__/issue_1857_phone_country_authority.tester.adversarial.test.mjs",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  source.consumerImports = consumers.join("\n");
  source.phoneScoped = [source.worker, source.adapter, source.consumerImports, source.workflow].join("\n");
  return source;
}

function selfTest(source) {
  const mutations = [
    ["Stay kind", { ...source, migration: source.migration.replaceAll("'reservation','stay_reservation'", "'reservation','reservation'") }],
    ["confirmation", { ...source, migration: source.migration.replaceAll("e.event_type='stay_reservation_confirmed'", "g.state='confirmed'") }],
    ["ISO", { ...source, migration: source.migration.replace("v_phone_country_iso !~ '^[A-Z]{2}$'", "false") }],
    ["supported ISO", { ...source, migration: source.migration.replace("v_phone_country_iso NOT IN ('US','CA','GB','NG','FR','DE','BE','ES','PT')", "false") }],
    ["fail-open", { ...source, migration: source.migration.replaceAll("EXCEPTION WHEN OTHERS", "") }],
    ["suppression", { ...source, migration: source.migration.replaceAll("biz_record_brand_person_suppression", "removed_suppression_owner") }],
    ["ACL", { ...source, migration: source.migration.replace("REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon,authenticated", "REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon") }],
    ["adapter", { ...source, worker: source.worker.replaceAll("resolveUserPhoneE164(", "copiedPhoneConverter(") }],
    ["adapter import", { ...source, worker: source.worker.replace('import { resolveUserPhoneE164 } from "../../../packages/card-identity/phone.mjs";', 'import phoneAdapter from "../../../packages/card-identity/phone.mjs";') }],
    ["JSON workaround", { ...source, worker: 'import "../../../packages/card-identity/package.json" with { type: "json" };\n' + source.worker }],
    ["regular owner", { ...source, adapterKind: "other" }],
    ["legacy CJS", { ...source, legacyCjsExists: true }],
    ["logic drift", { ...source, logicSha256: "0".repeat(64) }],
    ["ESM footer", { ...source, adapter: source.adapter.replace("PLANS as PHONE_PLANS", "PHONE_PLANS") }],
    ["consumer fallback", { ...source, consumerImports: source.consumerImports + '\nimport x from "@mingla/card-identity/phone";' }],
    ["CLI upload proof", { ...source, artifactTest: source.artifactTest.replace("Supabase CLI did not upload canonical phone.mjs bytes", "unverified upload bytes") }],
    ["phone authority successor", { ...source, phoneAuthoritySuccessor: source.phoneAuthoritySuccessor.replace("guest_phone_country_iso='CA'", "guest_phone_country_iso='US'") }],
    ["union", { ...source, worker: source.worker.replace('| "stay_reservation"', '| "reservation"') }],
    ["revision", { ...source, migration: source.migration.replace("'phoneCountryIso',NEW.guest_phone_country_iso", "'status',NEW.status") }],
    ["backfill", { ...source, migration: source.migration.replace("FROM public.reservations r ON CONFLICT DO NOTHING", "FROM public.reservations r WHERE false ON CONFLICT DO NOTHING") }],
    ["invariant activation", { ...source, invariant: source.invariant.replaceAll("#1773 ACTIVE extension", "#1773 DRAFT extension") }],
  ];
  for (const [label, mutation] of mutations) {
    if (inspect(mutation).length === 0) throw new Error(`self-test did not catch ${label}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readSources();
  if (process.argv.includes("--self-test")) {
    selfTest(source);
    console.log("#1773 reservation/Stay ingest self-test PASS (21 true mutations)");
  } else {
    const failures = inspect(source);
    if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
    console.log("#1773 reservation/Stay ingest gate PASS");
  }
}
