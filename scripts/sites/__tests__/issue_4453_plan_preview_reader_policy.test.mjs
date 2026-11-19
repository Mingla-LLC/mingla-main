// #4453 Fault 3 — the runtime storage reader may read Ari's style previews
// (plan-previews/<brand>/plan-<32 hex>/<digest>.json), or every style preview
// frame on preview.sites.usemingla.com answers 404; and still nothing outside
// that grammar. Keys are built by the contract itself (planPreviewKey), so the
// policy and PLAN_KEY in packages/site-contracts/src/planPreview.ts cannot drift.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(HERE, "../bootstrap-sites-cms.sql"), "utf8");
const CONTRACT_PATH = path.join(HERE, "../../../packages/site-contracts/src/planPreview.ts");
const CONTRACT = fs.readFileSync(CONTRACT_PATH, "utf8");
const { planPreviewKey, parsePlanPreviewKey, PLAN_PREVIEW_PREFIX } = await import(CONTRACT_PATH);

const POLICY = SQL.slice(
  SQL.indexOf("CREATE POLICY sites_runtime_reader_select"),
  SQL.indexOf("-- Execute PostgreSQL's real regex engine"),
);
const SELF_CHECK = SQL.slice(SQL.indexOf("WITH path_patterns AS ("), SQL.indexOf("AS sites_runtime_reader_path_semantics_valid"));
const policyPatterns = [...POLICY.matchAll(/'(\^plan-previews\/[^']+)'/g)].map((match) => match[1]);
const checkPatterns = [...SELF_CHECK.matchAll(/'(\^plan-previews\/[^']+)'/g)].map((match) => match[1]);

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NONCE = "c".repeat(32);
const DIGEST = "a".repeat(64);

test("#4453 the policy and its PostgreSQL self-check name one plan-preview grammar, in the artifacts bucket", () => {
  assert.equal(policyPatterns.length, 1);
  assert.deepEqual(checkPatterns, policyPatterns);
  assert.ok(
    POLICY.includes(`bucket_id = 'sites-publication-artifacts'\n      AND name ~ '${policyPatterns[0]}'`),
    "the plan grammar is bound to the private artifacts bucket",
  );
  assert.match(SQL, /AS plan_pattern,/);
  assert.match(SELF_CHECK, /AS plan_pattern/);
});

test("#4453 the policy grammar is the contract's PLAN_KEY exactly (capture groups aside)", () => {
  const source = /const PLAN_KEY = new RegExp\(`(.+)`\);/.exec(CONTRACT)?.[1];
  assert.ok(source, "PLAN_KEY found in the contract");
  const uuid = /const UUID = "([^"]+)";/.exec(CONTRACT)?.[1];
  assert.ok(uuid, "UUID found in the contract");
  const contractGrammar = source
    .replace("${UUID}", uuid)
    .replace(/\\\\/g, "\\")
    .replace(/\((?!\?)([^()|]+)\)/g, "$1");
  assert.equal(policyPatterns[0], contractGrammar);
  assert.ok(policyPatterns[0].startsWith(`^${PLAN_PREVIEW_PREFIX}`));
});

test("#4453 every key the contract builds is readable; near misses are not", () => {
  const grammar = new RegExp(policyPatterns[0]);
  for (const [brand, nonce, digest] of [
    [BRAND, NONCE, DIGEST],
    ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "0".repeat(32), "f".repeat(64)],
    [BRAND.toUpperCase(), "0123456789abcdef0123456789abcdef", "0123456789abcdef".repeat(4)],
  ]) {
    const key = planPreviewKey(brand, nonce, digest);
    assert.ok(parsePlanPreviewKey(key), `contract accepts ${key}`);
    assert.ok(grammar.test(key), `policy accepts ${key}`);
  }
  const good = planPreviewKey(BRAND, NONCE, DIGEST);
  for (const bad of [
    `plan-previews/${BRAND}/plan-${"c".repeat(31)}/${DIGEST}.json`,
    `plan-previews/${BRAND}/plan-${"c".repeat(33)}/${DIGEST}.json`,
    `plan-previews/${BRAND}/plan-${"C".repeat(32)}/${DIGEST}.json`,
    `plan-previews/${BRAND}/preview-${NONCE}/${DIGEST}.json`,
    `plan-previews/${BRAND}/${NONCE}/${DIGEST}.json`,
    `plan-previews/${BRAND}/plan-${NONCE}/${"a".repeat(63)}.json`,
    `plan-previews/${BRAND}/plan-${NONCE}/${DIGEST}.jsonx`,
    `plan-previews/${BRAND}/plan-${NONCE}/../${DIGEST}.json`,
    `plan-previews/../plan-${NONCE}/${DIGEST}.json`,
    `plan-previews/${BRAND}x/plan-${NONCE}/${DIGEST}.json`,
    `plan-previews/${BRAND}/plan-${NONCE}/sub/${DIGEST}.json`,
    `publications/${good}`,
    `${good}/x`,
    `x${good}`,
  ]) {
    assert.equal(parsePlanPreviewKey(bad), null, `contract refuses ${bad}`);
    assert.ok(!grammar.test(bad), `policy refuses ${bad}`);
  }
});

test("#4453 the PostgreSQL self-check exercises the plan grammar both ways", () => {
  assert.ok(SELF_CHECK.includes(`AND ('plan-previews/' || site_a || '/plan-' || repeat('c', 32) || '/' || repeat('a', 64) || '.json') ~ plan_pattern`));
  const negatives = SELF_CHECK.match(/AND NOT \([^\n]*\) ~ plan_pattern/g) ?? [];
  assert.ok(negatives.length >= 8, `near misses checked in PostgreSQL: ${negatives.length}`);
  // The artifact grammar does not reach plan previews (one branch, one shape).
  assert.ok(SELF_CHECK.includes(`AND NOT ('plan-previews/' || site_a || '/plan-' || repeat('c', 32) || '/' || repeat('a', 64) || '.json') ~ artifact_pattern`));
});
