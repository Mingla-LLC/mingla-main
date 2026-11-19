// #4453 website workspace — the runtime storage reader may read the section
// list Studio stores beside a private preview artifact
// (publications/<site>/preview-<32 hex>/<digest>.sections). Without it the
// runtime's read was refused, the draft was drawn with no section marks and
// nothing on the live draft could be clicked. Keys are built by the contract
// itself (previewSectionsKey), so the policy and the contract cannot drift;
// and nothing outside that grammar becomes readable (never a published
// artifact's folder).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(HERE, "../bootstrap-sites-cms.sql"), "utf8");
const { previewSectionsKey } = await import(path.join(HERE, "../../../packages/site-contracts/src/previewSections.ts"));

const POLICY = SQL.slice(
  SQL.indexOf("CREATE POLICY sites_runtime_reader_select"),
  SQL.indexOf("-- Execute PostgreSQL's real regex engine"),
);
const SELF_CHECK = SQL.slice(SQL.indexOf("WITH path_patterns AS ("), SQL.indexOf("AS sites_runtime_reader_path_semantics_valid"));
const sectionPatterns = (text) => [...text.matchAll(/'(\^publications\/[^']+\\\.sections\$)'/g)].map((match) => match[1]);

const SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NONCE = "c".repeat(32);
const DIGEST = "a".repeat(64);
const artifactKey = (site, nonce, digest) => `publications/${site}/preview-${nonce}/${digest}.json`;

test("#4453 the policy and its PostgreSQL self-check name one section-list grammar, in the artifacts bucket", () => {
  const policy = sectionPatterns(POLICY);
  assert.equal(policy.length, 1);
  assert.deepEqual(sectionPatterns(SELF_CHECK), policy);
  assert.ok(
    POLICY.includes(`bucket_id = 'sites-publication-artifacts'\n      AND name ~ '${policy[0]}'`),
    "the section-list grammar is bound to the private artifacts bucket",
  );
  assert.match(SELF_CHECK, /AS sections_pattern,/);
});

test("#4453 every key the contract builds is readable; near misses are not", () => {
  const grammar = new RegExp(sectionPatterns(POLICY)[0]);
  for (const [site, nonce, digest] of [
    [SITE, NONCE, DIGEST],
    ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "0".repeat(32), "f".repeat(64)],
    [SITE, "0123456789abcdef0123456789abcdef", "0123456789abcdef".repeat(4)],
  ]) {
    const key = previewSectionsKey(artifactKey(site, nonce, digest));
    assert.ok(key, "the contract builds a key");
    assert.ok(key.endsWith(".sections"));
    assert.ok(grammar.test(key), `policy accepts ${key}`);
  }
  const good = previewSectionsKey(artifactKey(SITE, NONCE, DIGEST));
  for (const bad of [
    // A published artifact's folder never holds a readable section list.
    `publications/${SITE}/11111111-1111-4111-8111-111111111111/${DIGEST}.sections`,
    `publications/${SITE}/preview-${"c".repeat(31)}/${DIGEST}.sections`,
    `publications/${SITE}/preview-${"c".repeat(33)}/${DIGEST}.sections`,
    `publications/${SITE}/preview-${"C".repeat(32)}/${DIGEST}.sections`,
    `publications/${SITE}/preview-${NONCE}/${"a".repeat(63)}.sections`,
    `publications/${SITE}/preview-${NONCE}/${DIGEST}.sectionsx`,
    `publications/${SITE}/preview-${NONCE}/${DIGEST}.json.sections`,
    `publications/${SITE}/preview-${NONCE}/../${DIGEST}.sections`,
    `publications/${SITE}/preview-${NONCE}/sub/${DIGEST}.sections`,
    `publications/../preview-${NONCE}/${DIGEST}.sections`,
    `publications/${SITE}x/preview-${NONCE}/${DIGEST}.sections`,
    `plan-previews/${SITE}/plan-${NONCE}/${DIGEST}.sections`,
    `exports/${SITE}/preview-${NONCE}/${DIGEST}.sections`,
    `${good}/x`,
    `x${good}`,
  ]) {
    assert.ok(!grammar.test(bad), `policy refuses ${bad}`);
  }
});

test("#4453 the PostgreSQL self-check exercises the section-list grammar both ways", () => {
  assert.ok(SELF_CHECK.includes(`AND ('publications/' || site_a || '/preview-' || repeat('c', 32) || '/' || repeat('a', 64) || '.sections') ~ sections_pattern`));
  const negatives = SELF_CHECK.match(/AND NOT \([^\n]*\) ~ sections_pattern/g) ?? [];
  assert.ok(negatives.length >= 8, `near misses checked in PostgreSQL: ${negatives.length}`);
  // A published artifact's folder is refused, and the artifact grammar does not reach a section list.
  assert.ok(SELF_CHECK.includes(`AND NOT ('publications/' || site_a || '/' || publication_id || '/' || repeat('a', 64) || '.sections') ~ sections_pattern`));
  assert.ok(SELF_CHECK.includes(`AND NOT ('publications/' || site_a || '/preview-' || repeat('c', 32) || '/' || repeat('a', 64) || '.sections') ~ artifact_pattern`));
});
