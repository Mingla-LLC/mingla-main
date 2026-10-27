// #2829 W2 — the runtime storage reader may read private PREVIEW artifacts
// (publications/<site>/preview-<32 hex>/<digest>.json), or every preview
// 404s; and still nothing outside the artifact grammar.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sql = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../bootstrap-sites-cms.sql"),
  "utf8",
);
const patterns = [...sql.matchAll(/'(\^publications\/[^']+)'/g)].map((match) => match[1]);
const SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIGEST = "a".repeat(64);

test("#2829 the policy and its self-check name the same artifact grammar", () => {
  assert.equal(patterns.length, 2);
  assert.equal(patterns[0], patterns[1]);
});

test("#2829 preview artifacts are readable, look-alikes are not", () => {
  const grammar = new RegExp(patterns[0]);
  assert.ok(grammar.test(`publications/${SITE}/preview-${"c".repeat(32)}/${DIGEST}.json`));
  assert.ok(grammar.test(`publications/${SITE}/11111111-1111-4111-8111-111111111111/${DIGEST}.json`));
  for (const bad of [
    `publications/${SITE}/preview-${"c".repeat(31)}/${DIGEST}.json`,
    `publications/${SITE}/preview-${"C".repeat(32)}/${DIGEST}.json`,
    `publications/${SITE}/drafts-${"c".repeat(32)}/${DIGEST}.json`,
    `publications/${SITE}/preview-${"c".repeat(32)}/../${DIGEST}.json`,
    `exports/${SITE}/preview-${"c".repeat(32)}.zip`,
  ]) assert.ok(!grammar.test(bad), bad);
});
