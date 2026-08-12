#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  migration: "supabase/migrations/20270327001773_issue_1773_reservation_stay_ingest.sql",
  worker: "supabase/functions/brand-person-ingest-worker/index.ts",
  package: "packages/card-identity/package.json",
  sqlTest: "supabase/migrations/__tests__/issue_1773_reservation_stay_ingest.test.sql",
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
  need("migration", "EXCEPTION WHEN OTHERS", "fail-open exception handling");
  need("migration", "source=% table=%", "PII-free warning");
  need("migration", "biz_record_brand_person_suppression", "suppression reprojection");
  need("migration", "FROM public.reservations r ON CONFLICT DO NOTHING", "reservation backfill");
  need("migration", "FROM public.stay_reservation_groups g", "Stay backfill");
  need("migration", "REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon,authenticated", "service-only overload");
  if (/CREATE\s+TRIGGER[\s\S]{0,120}ON\s+public\.stay_reservation_groups/i.test(source.migration ?? "")) failures.push("Stay group trigger is forbidden");
  need("worker", 'import phoneAdapter from "../../../packages/card-identity/phone.js"', "canonical CommonJS namespace import");
  need("worker", "resolveUserPhoneE164(", "single canonical adapter call");
  need("worker", '"phone:guest_snapshot->>phone,phoneCountryIso:guest_snapshot->>phoneCountryIso"', "phone-only Stay projection");
  need("worker", '| "reservation"', "reservation worker kind");
  need("worker", '| "stay_reservation"', "Stay worker kind");
  if (/PHONE_PLANS|dial:\s*['"]|defaultCountry|DEFAULT_COUNTRY/.test(source.worker ?? "")) failures.push("copied or default phone plan in worker");
  need("package", '"type": "commonjs"', "CommonJS package type");
  need("sqlTest", "operational update enqueued", "operational no-op regression");
  need("sqlTest", "strict phone spoof was accepted", "anti-spoof regression");
  need("sqlTest", "unsupported ISO phone spoof was accepted", "unsupported-ISO regression");
  need("sqlTest", "lowercase ISO phone spoof was accepted", "lowercase-ISO regression");
  need("sqlTest", "twelfth failure did not become dead", "retry/dead regression");
  need("sqlTest", "suppression retry/replay failed", "suppression retry regression");
  need("sqlTest", "old source path % regressed", "four-kind legacy resolver regression");
  need("sqlTest", "backfill replay duplicated work", "behavioral backfill regression");
  need("workflow", "issue_1773_reservation_stay_ingest.test.sql", "SQL workflow registration");
  need("workflow", "--unstable-detect-cjs", "CommonJS runtime graph flag");
  need("workflow", "issue-1773-reservation-stay-ingest.mjs --self-test", "gate self-test wiring");
  need("invariant", "#1773 DRAFT extension", "DRAFT invariant extension");
  return failures;
}

function readSources() {
  return Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), "utf8")]));
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
    ["union", { ...source, worker: source.worker.replace('| "stay_reservation"', '| "reservation"') }],
    ["revision", { ...source, migration: source.migration.replace("'phoneCountryIso',NEW.guest_phone_country_iso", "'status',NEW.status") }],
    ["backfill", { ...source, migration: source.migration.replace("FROM public.reservations r ON CONFLICT DO NOTHING", "FROM public.reservations r WHERE false ON CONFLICT DO NOTHING") }],
  ];
  for (const [label, mutation] of mutations) {
    if (inspect(mutation).length === 0) throw new Error(`self-test did not catch ${label}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readSources();
  if (process.argv.includes("--self-test")) {
    selfTest(source);
    console.log("#1773 reservation/Stay ingest self-test PASS (11 true mutations)");
  } else {
    const failures = inspect(source);
    if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
    console.log("#1773 reservation/Stay ingest gate PASS");
  }
}
