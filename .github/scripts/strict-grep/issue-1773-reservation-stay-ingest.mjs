#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APPROVED_PHONE_JS_GIT_BLOB = "b39b337f1f6d7db400e1c14f783ac4e99a1470bb";
const APPROVED_PHONE_JS_SHA256 = "455644c187c718a3e61cc38972d3aa90d0d16596f3a2e59b20348eb2ff421e4e";
const APPROVED_PHONE_JS_BYTES = 7420;
const files = {
  migration: "supabase/migrations/20270327001773_issue_1773_reservation_stay_ingest.sql",
  worker: "supabase/functions/brand-person-ingest-worker/index.ts",
  adapter: "packages/card-identity/phone.cjs",
  canonicalAdapter: "packages/card-identity/phone.js",
  sqlTest: "supabase/migrations/__tests__/issue_1773_reservation_stay_ingest.test.sql",
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
  need("migration", "EXCEPTION WHEN OTHERS", "fail-open exception handling");
  need("migration", "source=% table=%", "PII-free warning");
  need("migration", "biz_record_brand_person_suppression", "suppression reprojection");
  need("migration", "FROM public.reservations r ON CONFLICT DO NOTHING", "reservation backfill");
  need("migration", "FROM public.stay_reservation_groups g", "Stay backfill");
  need("migration", "REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon,authenticated", "service-only overload");
  if (/CREATE\s+TRIGGER[\s\S]{0,120}ON\s+public\.stay_reservation_groups/i.test(source.migration ?? "")) failures.push("Stay group trigger is forbidden");
  need("worker", 'import phoneAdapter from "../../../packages/card-identity/phone.cjs";', "exact CommonJS adapter import");
  need("worker", "resolveUserPhoneE164(", "single canonical adapter call");
  need("worker", '"phone:guest_snapshot->>phone,phoneCountryIso:guest_snapshot->>phoneCountryIso"', "phone-only Stay projection");
  need("worker", '| "reservation"', "reservation worker kind");
  need("worker", '| "stay_reservation"', "Stay worker kind");
  if (/PHONE_PLANS|dial:\s*['"]|defaultCountry|DEFAULT_COUNTRY|createRequire|module\.exports|require\s*\(/.test(source.worker ?? "")) failures.push("copied phone logic or CommonJS wrapper in worker");
  if ((source.worker ?? "").includes('packages/card-identity/package.json')) failures.push("worker relies on JSON side-effect import");
  if ((source.worker ?? "").includes('from "../../../packages/card-identity/phone.js"')) failures.push("worker bypasses the .cjs adapter boundary");
  if (source.adapterKind !== "symlink") failures.push("phone.cjs is not a real filesystem symlink");
  if (source.adapterTarget !== "phone.js") failures.push("phone.cjs symlink target is not exactly phone.js");
  if (source.adapterMode !== "120000") failures.push("phone.cjs Git mode is not 120000");
  if (source.adapterBytes !== source.canonicalAdapter) failures.push("phone.cjs does not resolve to canonical phone.js bytes");
  if (source.canonicalBlob !== APPROVED_PHONE_JS_GIT_BLOB) failures.push("canonical phone.js Git blob drifted from approved main");
  if (source.canonicalSha256 !== APPROVED_PHONE_JS_SHA256) failures.push("canonical phone.js byte hash drifted from approved main");
  if (source.canonicalByteLength !== APPROVED_PHONE_JS_BYTES) failures.push("canonical phone.js byte length drifted from approved main");
  need("artifactTest", 'const expectedUploadedFiles = [', "exact upload allowlist");
  need("artifactTest", 'if (!adapterInfo.isSymlink)', "source symlink assertion");
  need("artifactTest", 'gitMode.output.startsWith("120000 ")', "Git symlink-mode assertion");
  need("artifactTest", 'if (!stagedInfo.isFile || stagedInfo.isSymlink)', "regular staged .cjs assertion");
  need("artifactTest", 'packages/card-identity/package.json', "staged package.json absence assertion");
  need("artifactTest", 'Supabase CLI did not upload canonical phone.js bytes as phone.cjs', "CLI dereference-byte assertion");
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
  need("workflow", "issue_1773_reservation_stay_ingest.test.sql", "SQL workflow registration");
  need("workflow", "issue_1773_worker_cjs_artifact.test.ts", "deployment artifact regression wiring");
  if ((source.workflow ?? "").includes("--unstable-detect-cjs")) failures.push("workflow relies on unstable CommonJS detection");
  need("workflow", "deno-version: v2.9.5", "Deno 2.9.5 workflow pin");
  need("workflow", "supabase/setup-cli@v1", "Supabase CLI setup");
  need("workflow", "version: 2.98.2", "Supabase CLI 2.98.2 workflow pin");
  need("workflow", "issue-1773-reservation-stay-ingest.mjs --self-test", "gate self-test wiring");
  need("invariant", "#1773 DRAFT extension", "DRAFT invariant extension");
  return failures;
}

function readSources() {
  const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), "utf8")]));
  const adapterPath = path.join(root, files.adapter);
  source.adapterKind = fs.lstatSync(adapterPath).isSymbolicLink() ? "symlink" : "regular";
  source.adapterTarget = fs.readlinkSync(adapterPath);
  source.adapterMode = execFileSync("git", ["ls-files", "-s", files.adapter], { cwd: root, encoding: "utf8" }).trim().split(/\s+/)[0];
  source.adapterBytes = fs.readFileSync(adapterPath, "utf8");
  source.canonicalBlob = execFileSync("git", ["hash-object", files.canonicalAdapter], { cwd: root, encoding: "utf8" }).trim();
  source.canonicalSha256 = createHash("sha256").update(source.canonicalAdapter).digest("hex");
  source.canonicalByteLength = Buffer.byteLength(source.canonicalAdapter);
  return source;
}

function gitBlobForText(value) {
  const bytes = Buffer.from(value);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function selfTest(source) {
  const driftedCanonical = `${source.canonicalAdapter}\n// one-byte-equivalent packaging drift`;
  const mutations = [
    ["Stay kind", { ...source, migration: source.migration.replaceAll("'reservation','stay_reservation'", "'reservation','reservation'") }],
    ["confirmation", { ...source, migration: source.migration.replaceAll("e.event_type='stay_reservation_confirmed'", "g.state='confirmed'") }],
    ["ISO", { ...source, migration: source.migration.replace("v_phone_country_iso !~ '^[A-Z]{2}$'", "false") }],
    ["supported ISO", { ...source, migration: source.migration.replace("v_phone_country_iso NOT IN ('US','CA','GB','NG','FR','DE','BE','ES','PT')", "false") }],
    ["fail-open", { ...source, migration: source.migration.replaceAll("EXCEPTION WHEN OTHERS", "") }],
    ["suppression", { ...source, migration: source.migration.replaceAll("biz_record_brand_person_suppression", "removed_suppression_owner") }],
    ["ACL", { ...source, migration: source.migration.replace("REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon,authenticated", "REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon") }],
    ["adapter", { ...source, worker: source.worker.replaceAll("resolveUserPhoneE164(", "copiedPhoneConverter(") }],
    ["adapter import", { ...source, worker: source.worker.replace('import phoneAdapter from "../../../packages/card-identity/phone.cjs";', 'import phoneAdapter from "../../../packages/card-identity/phone.js";') }],
    ["JSON workaround", { ...source, worker: 'import "../../../packages/card-identity/package.json" with { type: "json" };\n' + source.worker }],
    ["symlink kind", { ...source, adapterKind: "regular" }],
    ["symlink target", { ...source, adapterTarget: "copied-phone.js" }],
    ["Git mode", { ...source, adapterMode: "100644" }],
    ["adapter bytes", { ...source, adapterBytes: source.adapterBytes + "\n// drift" }],
    ["canonical blob/hash", {
      ...source,
      canonicalAdapter: driftedCanonical,
      adapterBytes: driftedCanonical,
      canonicalBlob: gitBlobForText(driftedCanonical),
      canonicalSha256: createHash("sha256").update(driftedCanonical).digest("hex"),
      canonicalByteLength: Buffer.byteLength(driftedCanonical),
    }],
    ["CLI upload proof", { ...source, artifactTest: source.artifactTest.replace("Supabase CLI did not upload canonical phone.js bytes as phone.cjs", "unverified upload bytes") }],
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
    console.log("#1773 reservation/Stay ingest self-test PASS (19 true mutations)");
  } else {
    const failures = inspect(source);
    if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
    console.log("#1773 reservation/Stay ingest gate PASS");
  }
}
